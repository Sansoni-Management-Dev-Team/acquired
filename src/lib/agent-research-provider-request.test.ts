import {it,expect,vi} from 'vitest';
import {performNativeResearchProviderRequest} from './agent-research-provider-request';
const threadId='a7cb06d3-2f07-4426-bb94-708cd425177c',request={researchOperationId:'700ea5af-232a-41b4-8f3e-d5e25dc75eab',researchJobId:'a1a639c7-169c-4bcd-893a-991470047023',provider:'search' as const,payload:{query:'Synthetic company'}};
it('executes one physical request only after persisted reservation, then saves usage',async()=>{
 const order:string[]=[],store={beginNativeResearchAttempt:vi.fn(async()=>{order.push('reserve');return {kind:'started' as const,operationId:'attempt',fence:'1'};}),finishNativeResearchAttempt:vi.fn(async()=>{order.push('receipt');})};
 const execute=vi.fn(async()=>{order.push('physical-request');return {response:{rows:[]},actualCostMicroUsd:'0',costBasis:'configured_rate_estimate' as const};});
 expect(await performNativeResearchProviderRequest({store,threadId,key:'attempt-1',request,execute})).toEqual({rows:[]});expect(order).toEqual(['reserve','physical-request','receipt']);expect(execute).toHaveBeenCalledOnce();
});
it('never invokes a provider when budget admission fails or the result is cached',async()=>{
 const execute=vi.fn(),store={beginNativeResearchAttempt:vi.fn().mockRejectedValue(new Error('Budget exhausted')),finishNativeResearchAttempt:vi.fn()};
 await expect(performNativeResearchProviderRequest({store,threadId,key:'attempt-1',request,execute})).rejects.toThrow('Budget exhausted');expect(execute).not.toHaveBeenCalled();
 store.beginNativeResearchAttempt.mockResolvedValue({kind:'cached',response:{rows:[]}});await performNativeResearchProviderRequest({store,threadId,key:'attempt-1',request,execute});expect(execute).not.toHaveBeenCalled();
});
it('records unknown cost on network failure and never performs a hidden retry',async()=>{
 const store={beginNativeResearchAttempt:vi.fn().mockResolvedValue({kind:'started',operationId:'attempt',fence:'1'}),finishNativeResearchAttempt:vi.fn()},execute=vi.fn().mockRejectedValue(new Error('Network timeout'));
 await expect(performNativeResearchProviderRequest({store,threadId,key:'attempt-1',request,execute})).rejects.toThrow('Network timeout');expect(execute).toHaveBeenCalledOnce();expect(store.finishNativeResearchAttempt).toHaveBeenCalledWith(threadId,'attempt','1',{actualCostMicroUsd:null,costBasis:'unknown',reason:'request_outcome_unknown'});
});
