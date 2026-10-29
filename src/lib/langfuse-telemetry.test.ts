import {afterEach,describe,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({observations:[]as Array<{name:string;type:string;updates:unknown[]}>,updates:[]as unknown[],processor:vi.fn(),start:vi.fn(),shutdown:vi.fn(),flush:vi.fn()}));
vi.mock('@langfuse/tracing',()=>({
 startActiveObservation:async(name:string,work:(o:unknown)=>Promise<unknown>,options:{asType:string})=>{const item={name,type:options.asType,updates:[]as unknown[]};f.observations.push(item);return work({update:(value:unknown)=>item.updates.push(value)});},
 updateActiveObservation:(value:unknown)=>f.updates.push(value),
 propagateAttributes:async(_attributes:unknown,work:()=>unknown)=>work(),
}));
vi.mock('@langfuse/otel',()=>({LangfuseSpanProcessor:class{constructor(options:unknown){f.processor(options);}forceFlush=f.flush;}}));
vi.mock('@opentelemetry/sdk-node',()=>({NodeSDK:class{start=f.start;shutdown=f.shutdown;}}));
import {createLangfuseOperationTrace,initializeAcquireTelemetry,maskTraceData,shutdownAcquireTelemetry} from './langfuse-telemetry';
import {installOperationTrace,traceOperation,updateOperationTrace} from '../../communications/packages/core/src/operation-trace';
afterEach(async()=>{await shutdownAcquireTelemetry();vi.clearAllMocks();f.observations.length=0;f.updates.length=0;});
describe('Langfuse instrumentation',()=>{
 it('is disabled without complete credentials and never starts a network SDK during builds',()=>{
  expect(initializeAcquireTelemetry({})).toBe(false);
  expect(initializeAcquireTelemetry({LANGFUSE_PUBLIC_KEY:'public',LANGFUSE_SECRET_KEY:'secret',NEXT_PHASE:'phase-production-build'})).toBe(false);
  expect(f.start).not.toHaveBeenCalled();
 });
 it('keeps original thrown objects outside SDK error capture and exposes only fixed failure metadata',async()=>{
  const dispose=installOperationTrace(createLangfuseOperationTrace()),error=Object.assign(Error('private@example.com Bearer SECRET'),{code:'55P03'}),effect=vi.fn(async()=>{throw error;});
  try{await expect(traceOperation('acquire.delivery.submit',{},effect)).rejects.toBe(error);expect(effect).toHaveBeenCalledOnce();
   const serialized=JSON.stringify([...f.observations,...f.updates]);expect(serialized).toContain('55P03');expect(serialized).not.toContain('private@example.com');expect(serialized).not.toContain('SECRET');
  }finally{dispose();}
 });
 it('records one generation per model call with actual usage, and does not count cached tokens twice',async()=>{
  const dispose=installOperationTrace(createLangfuseOperationTrace());
  try{await traceOperation('acquire.native.handler',{kind:'agent'},()=>traceOperation('acquire.model.completion',{kind:'generation',model:'gpt-6-luna'},async()=>{updateOperationTrace({model:'gpt-6-luna',inputTokens:100,cachedInputTokens:30,outputTokens:10});return'private output';}));
   expect(f.observations.map(o=>o.type)).toEqual(['agent','generation']);
   expect(f.updates.some(v=>JSON.stringify(v).includes('"usageDetails":{"input":70,"input_cached":30,"output":10}'))).toBe(true);
   expect(JSON.stringify(f.updates)).not.toContain('private output');
  }finally{dispose();}
 });
 it('preserves an HTTP failure outcome when the HTTP function returns a response',async()=>{
  const dispose=installOperationTrace(createLangfuseOperationTrace());try{
   const response=await traceOperation('acquire.hosted.rpc.history.read',{},async()=>{updateOperationTrace({httpStatus:401});return new Response('{}',{status:401});});
   expect(response.status).toBe(401);expect(f.updates.some(v=>(v as {level?:string}).level==='ERROR')).toBe(true);
   expect((f.updates.at(-1) as {output:unknown}).output).toMatchObject({httpStatus:401,outcome:'error'});
  }finally{dispose();}
 });
 it('starts once, uses explicit credentials and drops non-Acquire spans',()=>{
  const env={LANGFUSE_PUBLIC_KEY:'test-public',LANGFUSE_SECRET_KEY:'test-secret',LANGFUSE_BASE_URL:'https://cloud.langfuse.com',LANGFUSE_TRACING_ENVIRONMENT:'test'};
  expect(initializeAcquireTelemetry(env)).toBe(true);expect(initializeAcquireTelemetry(env)).toBe(true);expect(f.start).toHaveBeenCalledOnce();
  const options=f.processor.mock.calls[0][0];expect(options.publicKey).toBe('test-public');
  expect(options.shouldExportSpan({otelSpan:{name:'next.server',instrumentationScope:{name:'next'}}})).toBe(false);
 });
 it('masks raw content while retaining safe structured identifiers and counts',()=>{
  expect(maskTraceData({data:{conversationId:'48a30d6a-6c98-4b79-8a8b-e7ca68de1c01',inputTokens:5,body:'private',Authorization:'Bearer SECRET'}})).toEqual({conversationId:'48a30d6a-6c98-4b79-8a8b-e7ca68de1c01',inputTokens:5});
  expect(maskTraceData({data:'private@example.com'})).toBe('[redacted]');expect(maskTraceData({data:'sk-lf-private'})).toBe('[redacted]');
 });
});
