import {nativeWorkerMandateScope} from './agent-worker-scope';
import type {AgentEvent} from '@/db/agent-store';
import {AgentRunLimitError,agentEventOutcomeSchema,type AgentEventOutcome} from '@/domain/agent-events';
import {safeResearchFailure,safeResearchTrace} from '@/domain/research-trace-context';
import {withResearchDatabaseContext} from './research-request-observability';
export interface AgentEventWorkerPort{
 claimEvent(workerId:string,leaseMs?:number,mandateId?:string):Promise<AgentEvent|undefined>;
 beginEventRun(event:AgentEvent):Promise<{kind:'started';runId:string}|{kind:'busy'}|{kind:'lost'}>;
 eventRunCurrent(runId:string,event:AgentEvent):Promise<boolean>;
 finishEventRun(runId:string,event:AgentEvent,outcome:AgentEventOutcome):Promise<boolean>;
 deferEvent(event:AgentEvent,wakeAt:string):Promise<boolean>;
}
export type AgentEventHandler=(input:{event:AgentEvent;runId:string;signal:AbortSignal;assertCurrent:()=>Promise<void>})=>Promise<AgentEventOutcome>;
/** Native wake-up driver. Handlers must use stable persisted operations and the
 * final shared admission gate. A lease check is not an external send permit.
 * Unexpected failures/timeouts request review; they never blindly retry effects. */
export async function runAgentEvent(options:{store:AgentEventWorkerPort;workerId:string;handlers:Record<string,AgentEventHandler>;deadlineMs?:number;maxAttempts?:number;mandateId?:string}){
 const began=Date.now();
 const {store}=options,mandateId=nativeWorkerMandateScope({mandateId:options.mandateId}),event=mandateId?await store.claimEvent(options.workerId,60000,mandateId):await store.claimEvent(options.workerId,60000);
 if(!event)return 'idle' as const;
 if(mandateId&&event.mandate_id!==mandateId)throw Error('Claimed event differs from the required native mandate scope');
 const {jobId:eventId,requestId:threadId,...trace}=safeResearchTrace({jobId:event.id,requestId:event.thread_id,mandateId:event.mandate_id});
 const eventKind=(event.kind==='agent.review_required'||Object.hasOwn(options.handlers,event.kind))&&/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,3}$/.test(event.kind)&&event.kind.length<=100?event.kind:'unknown';
 let diagnosticRunId:string|undefined;
 const log=(stage:string,fields:Record<string,unknown>={})=>console.info('agent-event-worker',JSON.stringify({module:'agent-event-worker',stage,timestamp:new Date().toISOString(),...trace,eventId,threadId,...(diagnosticRunId?{runId:diagnosticRunId}:{}),eventKind,elapsedMs:Math.min(86400000,Math.max(0,Date.now()-began)),...fields}));
 log('event_claimed');
 try{
 const run=await store.beginEventRun(event);
 if(run.kind==='lost'){log('run_lost',{outcome:'lost',reason:'begin_not_current'});return 'lost' as const;}
 if(run.kind==='busy'){const deferred=await store.deferEvent(event,new Date(Date.now()+2000).toISOString());log(deferred?'run_deferred':'run_lost',{outcome:deferred?'defer':'lost',reason:'thread_busy'});return deferred?'defer' as const:'lost' as const;}
 const runId=run.runId;
 diagnosticRunId=safeResearchTrace({runId}).runId;log('run_started');
 if(!await store.eventRunCurrent(runId,event)){log('run_lost',{outcome:'lost',reason:'run_not_current'});return 'lost' as const;}
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 let outcome:AgentEventOutcome;
 try{
  const handler=options.handlers[event.kind],attempts=Math.max(1,Math.min(5,options.maxAttempts??5));
  if(event.kind==='agent.review_required')outcome={kind:'complete'};
  else if(!handler||event.attempts>attempts){log('review_failure',{outcome:'review',reason:!handler?'handler_missing':'attempt_limit'});outcome={kind:'review',message:'Background work needs review before it can continue. No automatic retry was started.'};}
  else{
   const deadline=Math.max(1,Math.min(45000,options.deadlineMs??45000));
   const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new AgentRunLimitError('run_duration_limit'));},deadline);});
   const work=Promise.resolve().then(()=>withResearchDatabaseContext({mandateId:trace.mandateId,runId:diagnosticRunId,stage:'native-event',action:eventKind},()=>handler({event,runId,signal:controller.signal,assertCurrent:async()=>{if(controller.signal.aborted||!await store.eventRunCurrent(runId,event))throw new Error('Agent event authority lost');}})));
   outcome=agentEventOutcomeSchema.parse(await Promise.race([work,timeout]));
  }
 }catch(error){log('review_failure',{outcome:'review',...safeResearchFailure(error)});outcome=error instanceof AgentRunLimitError?{kind:'review',stopReason:error.stopReason,message:error.stopReason==='run_step_limit'?'The background run reached its tool step limit. Review saved work before continuing.':'The background run reached its duration limit. Review saved work before continuing.'}:{kind:'review',message:'Background work was interrupted. Review its saved operations before retrying; a provider outcome may need reconciliation.'};}
 finally{if(timer)clearTimeout(timer);controller.abort();}
 const finished=await store.finishEventRun(runId,event,outcome);log(finished?'run_terminal':'run_lost',{outcome:finished?outcome.kind:'lost'});return finished?outcome.kind:'lost' as const;
 }catch(error){log('run_failed',safeResearchFailure(error));throw error;}
}
