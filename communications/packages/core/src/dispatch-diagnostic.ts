import {types} from 'node:util';
import {AsyncLocalStorage} from 'node:async_hooks';
import {traceOperation,updateOperationTrace} from './operation-trace';
export type DispatchDiagnosticStage='coordinator.claim'|'coordinator.record'|'coordinator.ready'|'coordinator.preflight'|'coordinator.begin'|'coordinator.admitted_record'|'coordinator.persist'|'admission.open'|'admission.permit'|'admission.service_commit'|'admission.app_commit'|'application.session'|'application.commit'|'application.binding'|'application.source'|'application.intent'|'application.coverage'|'application.policy'|'application.permit'|'service.grant'|'service.generation'|'service.sql';
export type DispatchDiagnostic={stage:DispatchDiagnosticStage;outcome:'error'|'blocked';sqlState?:'40001'|'40P01'|'55P03'|'57014'|'42501'};
export type DispatchDiagnosticPort=(event:DispatchDiagnostic)=>void;
/** Fixed metadata only. Never read error messages/details, query values or getters.
 * Diagnostics cannot change admission outcomes, even if a logger fails. */
export function reportDispatchDiagnostic(port:DispatchDiagnosticPort|undefined,stage:DispatchDiagnosticStage,outcome:'error'|'blocked',error?:unknown){
 if(!port)return;let code:unknown;try{if(error&&typeof error==='object'){const d=Object.getOwnPropertyDescriptor(error,'code');if(d&&'value'in d)code=d.value;}}catch{/*opaque errors remain private*/}
 const sqlState=typeof code==='string'&&['40001','40P01','55P03','57014','42501'].includes(code)?code as DispatchDiagnostic['sqlState']:undefined;
 try{port({stage,outcome,...(sqlState?{sqlState}:{})});}catch{/*no authority/effect changes from logging*/}
}

// The existing diagnostic boundary also carries opt-in stage observations. It
// never serializes a result, error message, request, binding or caller object.
export type DispatchObservationContext=Partial<Record<'mandateId'|'threadId'|'conversationId'|'eventId'|'runId'|'operationId'|'intentId'|'bindingId'|'routeId'|'attemptId'|'jobId',string>>&{runtimeId?:string;configurationId?:string;eventKind?:string;channel?:'email'|'whatsapp'|'linkedin';attempt?:number;decisionAction?:'draft'|'wait'|'handoff'|'stop'|'review'};
const observationScope=new AsyncLocalStorage<DispatchObservationContext>();
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const idKeys=['mandateId','threadId','conversationId','eventId','runId','operationId','intentId','bindingId','routeId','attemptId','jobId']as const;
function safeObservation(raw:DispatchObservationContext){const result:DispatchObservationContext={};try{
 const own=(key:string)=>{const d=Object.getOwnPropertyDescriptor(raw,key);return d&&'value'in d?d.value:undefined;};
 for(const key of idKeys){const value=own(key);if(typeof value==='string'&&uuid.test(value))result[key]=value;}
 const runtime=own('runtimeId');if(typeof runtime==='string'&&/^[a-z][a-z0-9-]{2,99}$/.test(runtime))result.runtimeId=runtime;
 const configuration=own('configurationId');if(typeof configuration==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(configuration))result.configurationId=configuration;
 const kind=own('eventKind');if(typeof kind==='string'&&/^(conversation\.(reassess|reminder|history_changed)|channel\.due|review\.(approved|rejected)|chat\.plan_requested|mandate\.supervise|research\.(dispatch|completed|proposed|provider_accounted)|fields\.(dispatch|proposed)|people\.(dispatch|proposed)|target\.(proposed|allocated)|sequence\.[a-z_]+|human\.[a-z_]+|email\.(proposed|reconcile|simulated)|whatsapp\.(proposed|reconcile)|linkedin\.(proposed|reconcile|invitation_proposed)|authority\.changed|ownership\.changed|control\.changed|model\.accounted|guidance\.(proposed|edited|approved|rejected))$/.test(kind))result.eventKind=kind;
 const channel=own('channel');if(['email','whatsapp','linkedin'].includes(channel))result.channel=channel;
 const action=own('decisionAction');if(['draft','wait','handoff','stop','review'].includes(action))result.decisionAction=action;
 const attempt=own('attempt');if(Number.isSafeInteger(attempt)&&attempt>=0&&attempt<=100000)result.attempt=attempt;
 }catch{/*Opaque metadata is omitted.*/}return result;}
export function withDispatchObservation<T>(context:DispatchObservationContext,work:()=>T):T{return observationScope.run({...observationScope.getStore(),...safeObservation(context)},work);}
export type ObservedDispatchStage='native.scope'|'native.handler'|'native.decision'|'delivery.lookup'|'delivery.prepare'|'delivery.submit'|'delivery.capture'|'ports.original_account'|'ports.client'|'ports.status'|'ports.admission'|'dispatch.ports'|'dispatch.recover'|'refresh.ports'|'refresh.save_identity'|'refresh.read_history'|'refresh.ingest'|'dispatch.begin'|'dispatch.source'|'refresh.coverage_revalidate';
export async function observeDispatchStage<T>(stage:ObservedDispatchStage,work:()=>Promise<T>,context:DispatchObservationContext={}):Promise<T>{
 const metadata=safeObservation({...observationScope.getStore(),...safeObservation(context)});
 return traceOperation('acquire.'+stage,{...metadata,kind:stage==='native.scope'||stage==='native.handler'?'agent':'span'},async()=>{
  try{const result=await observeLoggedDispatchStage(stage,work,context);let outcome='complete';try{if(result&&typeof result==='object'){const d=Object.getOwnPropertyDescriptor(result,'kind')??Object.getOwnPropertyDescriptor(result,'status'),state=d&&'value'in d?d.value:undefined;if(['review','unknown','submitted','lost'].includes(state))outcome=state;else if(['defer','waiting'].includes(state))outcome='wait';}}catch{}updateOperationTrace({outcome});return result;}
  catch(error){let code:unknown;try{const d=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'code'):undefined;code=d&&'value'in d?d.value:undefined;}catch{}updateOperationTrace({outcome:'error',...(typeof code==='string'?{failureCode:code}:{})});throw error;}
 });
}
async function observeLoggedDispatchStage<T>(stage:ObservedDispatchStage,work:()=>Promise<T>,context:DispatchObservationContext={}):Promise<T>{
 const enabled=process.env.AGENT_VERBOSE_LOGGING==='true'||process.env.AGENT_VERBOSE_LOGGING!=='false'&&process.env.NODE_ENV==='development';
 if(!enabled)return work();const started=performance.now(),metadata=safeObservation({...observationScope.getStore(),...safeObservation(context)});
 const emit=(outcome:string,error?:unknown)=>{try{let sqlState:string|undefined,errorClass:string|undefined,failureCode:string|undefined;
  if(error&&typeof error==='object'){const d=Object.getOwnPropertyDescriptor(error,'code');if(d&&'value'in d){if(['40001','40P01','55P03','57014','42501'].includes(d.value))sqlState=d.value;if(['unauthorized','forbidden','binding_changed','connection_unavailable','operation_conflict','invalid_binding','receipt_mismatch','contract_version','unsupported','request_too_large','request_timeout','not_found','internal','transport'].includes(d.value))failureCode=d.value;}const n=Object.getOwnPropertyDescriptor(error,'name');errorClass=n&&'value'in n&&['ZodError','ReplyProcessingPendingError','HistoryRefreshBusyError','CommunicationsClientError','AgentDecisionReviewError','AgentPreBeginHistoryError','AgentRunLimitError','AbortError'].includes(n.value)?n.value:error instanceof TypeError?'TypeError':error instanceof RangeError?'RangeError':error instanceof Error?'Error':'opaque';}
  console.info('agent-pipeline',JSON.stringify({stage,outcome,...metadata,...(outcome==='start'?{}:{durationMs:Math.min(86400000,Math.max(0,Math.round(performance.now()-started)))}),...(sqlState?{sqlState}:{}),...(errorClass?{errorClass}:{}),...(failureCode?{failureCode}:{})}));
 }catch{/*Logging never changes work, errors, authority or retries.*/}};
 emit('start');try{const value=await work();let outcome='complete';try{if(value&&typeof value==='object'){const d=Object.getOwnPropertyDescriptor(value,'kind')??Object.getOwnPropertyDescriptor(value,'status'),state=d&&'value'in d?d.value:undefined;if(state==='defer'||state==='waiting')outcome='wait';else if(state==='review')outcome='review';else if(state==='unknown')outcome='unknown';else if(state==='submitted')outcome='submitted';else if(state==='lost')outcome='lost';}}catch{}emit(outcome);return value;}catch(error){emit('error',error);throw error;}
}

/** Preparation never invokes a provider. This says nothing about an earlier
 * attempt or existing intent; recovery must inspect the original operation. */
export function reportAdmissionPreparationFailure(stage:DispatchDiagnosticStage|'application.prepare',error:unknown){
 try{
  const own=(key:string)=>{if(!error||typeof error!=='object'||types.isProxy(error))return;const d=Object.getOwnPropertyDescriptor(error,key);return d&&'value'in d?d.value:undefined;};
  const code=own('code'),message=own('message');
  const sqlState=typeof code==='string'&&['P0001','40001','40P01','55P03','57014','42501','23503','23505','23514'].includes(code)?code:undefined;
  const category=code==='P0001'&&message==='Exact active outreach workflow required for new dispatch'?'workflow_dispatch_guard_rejected'
   :code==='P0001'?'database_guard_rejected':code==='42501'?'authorization_rejected':code==='40001'||code==='40P01'||code==='55P03'?'database_contention':code==='57014'?'database_timeout':code==='23503'||code==='23505'||code==='23514'?'stored_state_conflict':'unclassified_preparation_failure';
  console.warn('communications-admission-failure',JSON.stringify({module:'communications.application_admission',timestamp:new Date().toISOString(),stage,outcome:'error',...safeObservation(observationScope.getStore()??{}),...(sqlState?{sqlState}:{}),category,submission:'not_attempted_by_this_prepare',intentPersistence:'not_confirmed',recovery:'reconcile_original_operation',automaticResend:false}));
 }catch{/* Diagnostic failures never alter admission or recovery. */}
}

/** Ingress shares the caller's receipt transaction. Failure never grants an
 * acknowledgement; the normal consumer retains rollback/retry ownership. */
export function reportIncomingApplicationFailure(error:unknown,context:{bindingId:string;serviceEventId:string}){
 try{
  const own=(key:string)=>{if(!error||typeof error!=='object'||types.isProxy(error))return;const d=Object.getOwnPropertyDescriptor(error,key);return d&&'value'in d?d.value:undefined;};
  const code=own('code'),message=own('message');
  const sqlState=typeof code==='string'&&['P0001','40001','40P01','55P03','57014','42501','23503','23505','23514'].includes(code)?code:undefined;
  const category=code==='P0001'&&message==='Explicit workflow-capable writer required'?'workflow_writer_rejected':code==='P0001'?'database_guard_rejected':code==='42501'?'authorization_rejected':code==='40001'||code==='40P01'||code==='55P03'?'database_contention':code==='57014'?'database_timeout':'unclassified_incoming_failure';
  const serviceEventId=uuid.test(context.serviceEventId)||/^[0-9]{1,19}$/.test(context.serviceEventId)?context.serviceEventId:undefined;
  console.warn('communications-incoming-failure',JSON.stringify({module:'communications.application_consumer',timestamp:new Date().toISOString(),stage:'application.incoming',outcome:'error',...safeObservation(observationScope.getStore()??{}),...(uuid.test(context.bindingId)?{bindingId:context.bindingId}:{}),...(serviceEventId?{serviceEventId}:{}),...(sqlState?{sqlState}:{}),category,acknowledgement:'not_confirmed',automaticAcknowledgement:false,recovery:'normal_consumer_retry'}));
 }catch{/* Logging must not mask the original transaction failure. */}
}
