import {AsyncLocalStorage} from 'node:async_hooks';
import {LangfuseSpanProcessor} from '@langfuse/otel';
import {NodeSDK} from '@opentelemetry/sdk-node';
import {startActiveObservation,updateActiveObservation,propagateAttributes} from '@langfuse/tracing';
import {installOperationTrace,safeTraceMetadata,type OperationTrace,type TraceMetadata} from '../../communications/packages/core/src/operation-trace';

const scope=new AsyncLocalStorage<TraceMetadata>();
/** Only our explicit, bounded observations are exported. No automatic HTTP,
 * database, prompt, response, cookie, header or exception-body capture. */
export function maskTraceData({data}:{data:unknown}):unknown {
 if(typeof data==='number'&&Number.isFinite(data)||typeof data==='boolean')return data;
 if(data&&typeof data==='object'&&!Array.isArray(data))return safeTraceMetadata(data);
 if(typeof data==='string'){
  try{const value=JSON.parse(data);if(value&&typeof value==='object'&&!Array.isArray(value))return JSON.stringify(safeTraceMetadata(value));}catch{}
  return /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,100}$/.test(data)&&!/(?:sk-|pk-|bearer|password|token|secret)/i.test(data)?data:'[redacted]';
 }
 return '[redacted]';
}
function attributes(metadata:TraceMetadata){
 const error=metadata.outcome==='error'||typeof metadata.httpStatus==='number'&&metadata.httpStatus>=400;
 return {metadata,output:metadata,...(error?{level:'ERROR' as const,statusMessage:'Operation failed; inspect stage and fixed outcome metadata'}:{})};
}
export function createLangfuseOperationTrace():OperationTrace {
 return {
  async run(name,metadata,work){
   const captured={...scope.getStore(),...metadata},kind=metadata.kind;
   const run=async()=>scope.run(captured,async()=>{
    // Catch application exceptions inside the observation so the SDK cannot
    // automatically export their potentially sensitive message or stack.
    let result:unknown,error:unknown,failed=false;
    const execute=async()=>{try{result=await work();}catch(value){failed=true;error=value;captured.outcome='error';const d=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'code'):undefined;Object.assign(captured,safeTraceMetadata({failureCode:d&&'value'in d?d.value:undefined}));}};
    await execute();
    if(!captured.outcome)captured.outcome='complete';
    try{updateActiveObservation(attributes(captured));}catch{}
    // Return an envelope: rethrow only after the SDK has ended the span.
    return {result,error,failed};
   });
   const sessionId=String(metadata.conversationId??metadata.threadId??scope.getStore()?.conversationId??scope.getStore()?.threadId??'');
   const callback=async()=>{
    updateActiveObservation({input:captured,metadata:captured});
    if(kind==='generation'&&typeof metadata.model==='string')updateActiveObservation({model:metadata.model},{asType:'generation'});
    return run();
   };
   const observe=()=>kind==='generation'?startActiveObservation(name,callback,{asType:'generation'}):kind==='agent'?startActiveObservation(name,callback,{asType:'agent'}):kind==='tool'?startActiveObservation(name,callback,{asType:'tool'}):startActiveObservation(name,callback,{asType:'span'});
   const settled=await propagateAttributes({...(sessionId?{sessionId}:{}),tags:['acquire','content-redacted']},observe);
   if(settled.failed)throw settled.error;
   return settled.result as Awaited<ReturnType<typeof work>>;
  },
  update(metadata){
   const current=scope.getStore();if(!current)return;Object.assign(current,metadata);
   if(typeof current.httpStatus==='number'&&current.httpStatus>=400)current.outcome='error';
   if('inputTokens'in metadata||'outputTokens'in metadata){
    const input=Number(metadata.inputTokens??0),cached=Number(metadata.cachedInputTokens??0),output=Number(metadata.outputTokens??0);
    updateActiveObservation({...(typeof metadata.model==='string'?{model:metadata.model}:{}),usageDetails:{input:Math.max(0,input-cached),input_cached:cached,output},metadata:current},{asType:'generation'});
   }else updateActiveObservation(attributes(current));
  },
 };
}
type Runtime={sdk:NodeSDK;processor:LangfuseSpanProcessor;dispose:()=>void};
const key=Symbol.for('acquire.langfuse.runtime.v1');
const state=globalThis as typeof globalThis & {[key]?:Runtime};
export function initializeAcquireTelemetry(env:Record<string,string|undefined>=process.env):boolean {
 if(state[key])return true;
 if(env.LANGFUSE_ENABLED==='false'||env.NEXT_PHASE==='phase-production-build'||!env.LANGFUSE_PUBLIC_KEY||!env.LANGFUSE_SECRET_KEY)return false;
 try{
  const url=new URL(env.LANGFUSE_BASE_URL??'https://cloud.langfuse.com');
  if(url.protocol!=='https:'||url.origin!==url.href.replace(/\/$/,'')||url.username||url.password)throw Error();
  const processor=new LangfuseSpanProcessor({publicKey:env.LANGFUSE_PUBLIC_KEY,secretKey:env.LANGFUSE_SECRET_KEY,baseUrl:url.origin,environment:env.LANGFUSE_TRACING_ENVIRONMENT??(env.NODE_ENV==='production'?'production':'development'),...(env.LANGFUSE_RELEASE?{release:env.LANGFUSE_RELEASE}:{}),timeout:5,flushInterval:1,mask:maskTraceData,shouldExportSpan:({otelSpan})=>otelSpan.name.startsWith('acquire.')&&otelSpan.instrumentationScope.name==='langfuse-sdk'});
  const sdk=new NodeSDK({serviceName:'acquire',spanProcessors:[processor],instrumentations:[],autoDetectResources:false});
  sdk.start();const dispose=installOperationTrace(createLangfuseOperationTrace());state[key]={sdk,processor,dispose};
  return true;
 }catch{console.warn('Acquire telemetry unavailable; application work continues.');return false;}
}
export async function flushAcquireTelemetry():Promise<void>{try{await state[key]?.processor.forceFlush();}catch{/* Non-authoritative exporter. */}}
export async function shutdownAcquireTelemetry():Promise<void>{const runtime=state[key];if(!runtime)return;delete state[key];runtime.dispose();try{await runtime.sdk.shutdown();}catch{}}
