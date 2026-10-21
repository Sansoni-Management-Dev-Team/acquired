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
it('inherits sanitized operation correlation while keeping the explicit native job and independent authority headers',async()=>{
 const {createNativeFirmableTransport}=await import('./agent-research-firmable'),{observeResearchOperation,withResearchDatabaseContext}=await import('./research-request-observability');
 vi.stubEnv('FIRMABLE_TRANSPORT','cloudflare-session');vi.stubEnv('FIRMABLE_SERVICE_URL','https://service.example.invalid');vi.stubEnv('FIRMABLE_SERVICE_SECRET','synthetic-test-secret');
 const explicitJob='a1a639c7-169c-4bcd-893a-991470047023',transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({id:'f123'}));
 await withResearchDatabaseContext({mandateId:'mandate-12345',runId:'run-12345',jobId:'outer-job-12345',operationId:'operation-12345'},()=>observeResearchOperation('request-12345',async()=>createNativeFirmableTransport({jobId:explicitJob,stepKey:'profile-step',targetId:'target-12345',fetch:transport}).enrichCompany({id:'f123'},{includePeople:false})));
 const headers=new Headers(transport.mock.calls[0][1]?.headers);for(const[name,value]of Object.entries({'x-acquire-mandate-id':'mandate-12345','x-acquire-research-run':'run-12345','x-acquire-research-job':explicitJob,'x-acquire-agent-operation':'operation-12345','x-request-id':'request-12345','x-acquire-native-research-job':explicitJob,'x-acquire-native-research-key':'profile-step','x-acquire-native-research-target':'target-12345'}))expect(headers.get(name)).toBe(value);expect(transport).toHaveBeenCalledOnce();
});
