import {afterEach,it,expect,vi} from 'vitest';
import {createNativeResearchFirmableClient} from './agent-research-firmable';
afterEach(()=>vi.unstubAllEnvs());
it('routes real Firmable search client HTTP through durable provider admission and disables hidden retries',async()=>{
 vi.stubEnv('FIRMABLE_TRANSPORT','cloudflare-session');vi.stubEnv('FIRMABLE_SERVICE_URL','https://service.example.invalid');vi.stubEnv('FIRMABLE_SERVICE_SECRET','synthetic-test-secret');
 const order:string[]=[],store={beginNativeResearchAttempt:vi.fn(async()=>{order.push('reserve');return {kind:'started' as const,operationId:'attempt',fence:'1'};}),finishNativeResearchAttempt:vi.fn(async()=>{order.push('receipt');})};
 const transport=vi.fn(async()=>{order.push('HTTP');return Response.json({error:'unavailable'},{status:500});});
 const client=createNativeResearchFirmableClient({store,threadId:'a7cb06d3-2f07-4426-bb94-708cd425177c',researchOperationId:'700ea5af-232a-41b4-8f3e-d5e25dc75eab',researchJobId:'a1a639c7-169c-4bcd-893a-991470047023',requestKeyPrefix:'search-page-0',fetch:transport});
 await expect(client.searchCompaniesPage('Synthetic refrigeration QLD',0,10)).rejects.toThrow(/500/);
 expect(order).toEqual(['reserve','HTTP','receipt']);expect(transport).toHaveBeenCalledOnce();expect(store.finishNativeResearchAttempt).toHaveBeenCalledWith(expect.any(String),'attempt','1',expect.objectContaining({actualCostMicroUsd:null,costBasis:'unknown'}));
});
