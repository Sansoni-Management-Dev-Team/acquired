import {afterEach,describe,expect,it,vi} from 'vitest';
import {installOperationTrace,traceOperation,updateOperationTrace} from './operation-trace';

let dispose:(()=>void)|undefined;
afterEach(()=>{dispose?.();dispose=undefined;});
describe('optional operation tracing',()=>{
 it('runs an effect exactly once when tracing fails before or after invoking it',async()=>{
  for(const after of [false,true]){
   const effect=vi.fn(async()=>({receipt:'original'}));
   dispose=installOperationTrace({async run(_name,_metadata,work){if(after)await work();throw Error('export unavailable');},update(){}});
   await expect(traceOperation('acquire.delivery.submit',{},effect)).resolves.toEqual({receipt:'original'});
   expect(effect).toHaveBeenCalledTimes(1);dispose();
  }
 });
 it('retains the exact application exception and never retries an uncertain send',async()=>{
  const error=Error('private provider detail'),effect=vi.fn(async()=>{throw error;});
  dispose=installOperationTrace({async run(_n,_m,work){try{await work();}finally{throw Error('trace failure');}},update(){}});
  await expect(traceOperation('acquire.delivery.submit',{},effect)).rejects.toBe(error);
  expect(effect).toHaveBeenCalledTimes(1);
 });
 it('omits content, credentials, unexpected keys and unsafe identifiers without reading getters',async()=>{
  const run=vi.fn(async(_n,_m,work)=>work()),getter=vi.fn(()=>{throw Error('secret');});
  dispose=installOperationTrace({run,update:vi.fn()});
  const metadata={conversationId:'48a30d6a-6c98-4b79-8a8b-e7ca68de1c01',email:'private@example.com',body:'secret',authorization:'Bearer secret',channel:'email',httpStatus:401,operation:'unsafe@example.com'};
  Object.defineProperty(metadata,'model',{get:getter});
  await traceOperation('acquire.history.read',metadata,async()=>true);
  expect(run.mock.calls[0][1]).toEqual({conversationId:metadata.conversationId,channel:'email',httpStatus:401});
  expect(getter).not.toHaveBeenCalled();
 });
 it('keeps tracing optional and isolates update failures',async()=>{
  const effect=vi.fn(async()=>42);expect(await traceOperation('acquire.test',{},effect)).toBe(42);
  dispose=installOperationTrace({run:async(_n,_m,work)=>work(),update(){throw Error('unavailable');}});
  expect(()=>updateOperationTrace({httpStatus:500})).not.toThrow();
 });
});
it('retains only reviewed provider accounting and failure categories',async()=>{const update=vi.fn();dispose=installOperationTrace({run:async(_n,_m,w)=>w(),update});updateOperationTrace({provider:'anthropic',cacheWrite5mTokens:12,cacheWrite1hTokens:3,failureCategory:'credits',body:'secret'});expect(update).toHaveBeenCalledWith({provider:'anthropic',cacheWrite5mTokens:12,cacheWrite1hTokens:3,failureCategory:'credits'});});
