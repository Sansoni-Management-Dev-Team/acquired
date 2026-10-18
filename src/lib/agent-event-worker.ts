import {nativeWorkerMandateScope} from './agent-worker-scope';
import type {AgentEvent} from '@/db/agent-store';
import {AgentRunLimitError,agentEventOutcomeSchema,type AgentEventOutcome} from '@/domain/agent-events';
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
 const {store}=options,mandateId=nativeWorkerMandateScope({mandateId:options.mandateId}),event=mandateId?await store.claimEvent(options.workerId,60000,mandateId):await store.claimEvent(options.workerId,60000);
 if(!event)return 'idle' as const;
 if(mandateId&&event.mandate_id!==mandateId)throw Error('Claimed event differs from the required native mandate scope');
 const run=await store.beginEventRun(event);
 if(run.kind==='lost')return 'lost' as const;
 if(run.kind==='busy')return await store.deferEvent(event,new Date(Date.now()+2000).toISOString())?'defer' as const:'lost' as const;
 const runId=run.runId;
 if(!await store.eventRunCurrent(runId,event))return 'lost' as const;
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 let outcome:AgentEventOutcome;
 try{
  const handler=options.handlers[event.kind],attempts=Math.max(1,Math.min(5,options.maxAttempts??5));
  if(event.kind==='agent.review_required')outcome={kind:'complete'};
  else if(!handler||event.attempts>attempts)outcome={kind:'review',message:'Background work needs review before it can continue. No automatic retry was started.'};
  else{
   const deadline=Math.max(1,Math.min(45000,options.deadlineMs??45000));
   const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new AgentRunLimitError('run_duration_limit'));},deadline);});
   const work=Promise.resolve().then(()=>handler({event,runId,signal:controller.signal,assertCurrent:async()=>{if(controller.signal.aborted||!await store.eventRunCurrent(runId,event))throw new Error('Agent event authority lost');}}));
   outcome=agentEventOutcomeSchema.parse(await Promise.race([work,timeout]));
  }
 }catch(error){outcome=error instanceof AgentRunLimitError?{kind:'review',stopReason:error.stopReason,message:error.stopReason==='run_step_limit'?'The background run reached its tool step limit. Review saved work before continuing.':'The background run reached its duration limit. Review saved work before continuing.'}:{kind:'review',message:'Background work was interrupted. Review its saved operations before retrying; a provider outcome may need reconciliation.'};}
 finally{if(timer)clearTimeout(timer);controller.abort();}
 return await store.finishEventRun(runId,event,outcome)?outcome.kind:'lost' as const;
}
