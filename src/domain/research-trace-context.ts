/** Optional diagnostic identity only. Never provider admission or budget authority. */
export type ResearchTraceContext={jobId?:string;requestId?:string;logicalCallId?:string;mandateId?:string;runId?:string;operationId?:string};
const traceHeaders={jobId:'x-acquire-research-job',requestId:'x-request-id',logicalCallId:'x-acquire-research-call',mandateId:'x-acquire-mandate-id',runId:'x-acquire-research-run',operationId:'x-acquire-agent-operation'} as const;
const traceKeys=Object.keys(traceHeaders) as Array<keyof ResearchTraceContext>;
const traceId=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value)?value:undefined;
export function safeResearchTrace(value?:ResearchTraceContext):ResearchTraceContext{
 return Object.fromEntries(traceKeys.flatMap(key=>{const id=traceId(value?.[key]);return id?[[key,id]]:[];}));
}
export function researchTraceHeaders(headers:Pick<Headers,'get'>):ResearchTraceContext{return safeResearchTrace(Object.fromEntries(traceKeys.map(key=>[key,headers.get(traceHeaders[key])??undefined])));}
/** Internal service diagnostics only; never send these to upstream providers or
 * treat them as native execution/accounting authority. */
export function researchTraceRequestHeaders(context?:ResearchTraceContext):Record<string,string>{const safe=safeResearchTrace(context);return Object.fromEntries(traceKeys.flatMap(key=>safe[key]?[[traceHeaders[key],safe[key]!]]:[]));}
/** Error messages, stacks, arbitrary names and non-SQL error codes are private. */
export function safeResearchFailure(error:unknown):{errorName:string;databaseCode?:string}{
 const value=error&&typeof error==='object'?error as {name?:unknown;code?:unknown;cause?:unknown}:{};
 const names=new Set(['Error','TypeError','RangeError','SyntaxError','AbortError','TimeoutError','AggregateError','FirmableError','ServiceError','PostgresError','DatabaseError','ZodError','AgentReadinessUnavailableError']);
 const errorName=typeof value.name==='string'&&names.has(value.name)?value.name:'Error';
 let current:unknown=error;for(let depth=0;depth<3&&current&&typeof current==='object';depth++){
  const e=current as {code?:unknown;cause?:unknown};if(typeof e.code==='string'&&/^[0-9A-Z]{5}$/.test(e.code))return{errorName,databaseCode:e.code};current=e.cause;
 }
 return{errorName};
}
