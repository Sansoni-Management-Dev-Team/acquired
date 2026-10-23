/** Optional process-local tracing port. Shared communications code has no SDK,
 * framework, network exporter or credential dependency. */
export type TraceMetadata=Record<string,string|number|boolean>;
export interface OperationTrace {
 run<T>(name:string,metadata:TraceMetadata,work:()=>Promise<T>):Promise<T>;
 update(metadata:TraceMetadata):void;
}
const slot=Symbol.for('acquire.operation-trace.v1');
const registry=globalThis as typeof globalThis & {[slot]?:OperationTrace};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ids=new Set(['mandateId','threadId','conversationId','eventId','runId','operationId','intentId','bindingId','routeId','requestId','jobId']);
const codes=new Set(['40001','40P01','55P03','57014','42501','unauthorized','forbidden','internal','transport','request_timeout','context_changed']);
export function safeTraceMetadata(raw:object):TraceMetadata {
 const result:TraceMetadata={};
 try{for(const key of Object.keys(raw)){
  const d=Object.getOwnPropertyDescriptor(raw,key);if(!d||!('value'in d))continue;const v=d.value;
  if(ids.has(key)&&typeof v==='string'&&uuid.test(v))result[key]=v;
  else if(['latencyMs','httpStatus','attempt','inputTokens','outputTokens','cachedInputTokens','cacheWriteTokens','cacheWrite5mTokens','cacheWrite1hTokens','reasoningTokens','messageCount','sourceCount','inputBytes','outputBytes'].includes(key)&&Number.isSafeInteger(v)&&v>=0&&v<=100000000)result[key]=v;
  else if(key==='provider'&&['openai','anthropic','openrouter','openrouter-free'].includes(v))result[key]=v;
  else if(key==='failureCategory'&&['authentication','credits','rate_limit','unsupported_request','timeout','transport','invalid_json','incomplete_response','usage_invalid','schema_validation','cancelled','unknown'].includes(v))result[key]=v;
  else if(key==='channel'&&['email','whatsapp','linkedin'].includes(v))result[key]=v;
  else if(key==='kind'&&['agent','tool','span','generation'].includes(v))result[key]=v;
  else if(key==='outcome'&&['complete','error','wait','review','unknown','submitted','lost','denied','cached'].includes(v))result[key]=v;
  else if(key==='decisionAction'&&['draft','wait','handoff','stop','review'].includes(v))result[key]=v;
  else if(key==='failureCode'&&codes.has(v))result[key]=v;
  else if(key==='model'&&typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,99}$/.test(v))result[key]=v;
  else if(key==='promptVersion'&&typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(v))result[key]=v;
  else if(key==='eventKind'&&typeof v==='string'&&/^(conversation\.(reassess|reminder|history_changed)|channel\.due|review\.(approved|rejected)|control\.changed|email\.(proposed|reconcile)|whatsapp\.(proposed|reconcile)|linkedin\.(proposed|reconcile))$/.test(v))result[key]=v;
  else if(['historyComplete','authorityReady','allowed'].includes(key)&&typeof v==='boolean')result[key]=v;
 }}catch{/* Opaque objects are never required for tracing. */}
 return result;
}
export function installOperationTrace(observer:OperationTrace):()=>void {
 const previous=registry[slot];registry[slot]=observer;
 return()=>{if(registry[slot]===observer)registry[slot]=previous;};
}
export async function traceOperation<T>(name:string,metadata:object,work:()=>Promise<T>):Promise<T> {
 const observer=registry[slot];if(!observer||!/^acquire\.[a-z][a-z0-9_.-]{0,99}$/.test(name))return work();
 let execution:Promise<T>|undefined;
 const once=()=>execution??=Promise.resolve().then(work);
 try{await observer.run(name,safeTraceMetadata(metadata),once);}catch{/* Exporter failure never retries or changes the original effect. */}
 return once();
}
export function updateOperationTrace(metadata:object):void {
 try{registry[slot]?.update(safeTraceMetadata(metadata));}catch{/* Optional telemetry cannot affect application work. */}
}
