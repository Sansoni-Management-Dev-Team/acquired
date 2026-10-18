import {it,expect,vi} from 'vitest';
import type {NativeResearchRequestPort} from './agent-research-provider-request';
import {createNativeResearchProviderFetch} from './agent-research-provider-fetch';
const scope={threadId:'a7cb06d3-2f07-4426-bb94-708cd425177c',researchOperationId:'700ea5af-232a-41b4-8f3e-d5e25dc75eab',researchJobId:'a1a639c7-169c-4bcd-893a-991470047023',provider:'firmable' as const,requestKeyPrefix:'stable-enrichment-step'};
it('meters each physical retry individually without retaining credentials',async()=>{
 const order:string[]=[],store={beginNativeResearchAttempt:vi.fn<NativeResearchRequestPort['beginNativeResearchAttempt']>(async()=>{order.push('reserve');return {kind:'started' as const,operationId:'attempt',fence:'1'};}),finishNativeResearchAttempt:vi.fn(async()=>{order.push('receipt');})};
 const physical=vi.fn(async()=>{order.push('HTTP');return Response.json({company:'Synthetic fixture'});});
 const fetcher=createNativeResearchProviderFetch({...scope,store,fetch:physical,estimateCost:()=>({actualCostMicroUsd:'10',costBasis:'configured_rate_estimate'})});
 for(let n=0;n<2;n++)expect(await (await fetcher('https://api.example.invalid/company',{headers:{authorization:'secret-test-value'}})).json()).toEqual({company:'Synthetic fixture'});
 expect(order).toEqual(['reserve','HTTP','receipt','reserve','HTTP','receipt']);expect(physical).toHaveBeenCalledTimes(2);
 expect(store.beginNativeResearchAttempt.mock.calls[0]?.[1]).not.toBe(store.beginNativeResearchAttempt.mock.calls[1]?.[1]);
 expect(JSON.stringify(store.beginNativeResearchAttempt.mock.calls)).not.toContain('secret-test-value');expect(JSON.stringify(store.finishNativeResearchAttempt.mock.calls)).not.toContain('secret-test-value');
});
it('reconstructs an exact saved response without another HTTP request',async()=>{
 const store={beginNativeResearchAttempt:vi.fn().mockResolvedValue({kind:'cached',response:{status:429,headers:{'retry-after':'2'},body:'{"error":"rate_limited"}'}}),finishNativeResearchAttempt:vi.fn()},physical=vi.fn();
 const fetcher=createNativeResearchProviderFetch({...scope,store,fetch:physical});
 const result=await fetcher('https://api.example.invalid/company');expect(result.status).toBe(429);expect(result.headers.get('retry-after')).toBe('2');expect(await result.json()).toEqual({error:'rate_limited'});expect(physical).not.toHaveBeenCalled();
});
it('retains unknown cost when bounded response storage cannot safely persist the result',async()=>{
 const store={beginNativeResearchAttempt:vi.fn().mockResolvedValue({kind:'started',operationId:'attempt',fence:'1'}),finishNativeResearchAttempt:vi.fn()},physical=vi.fn().mockResolvedValue(new Response('x'.repeat(45000)));
 const fetcher=createNativeResearchProviderFetch({...scope,store,fetch:physical});
 await expect(fetcher('https://api.example.invalid/company')).rejects.toThrow(/bounded/);expect(physical).toHaveBeenCalledOnce();expect(store.finishNativeResearchAttempt).toHaveBeenCalledWith(scope.threadId,'attempt','1',expect.objectContaining({actualCostMicroUsd:null,costBasis:'unknown'}));
});
