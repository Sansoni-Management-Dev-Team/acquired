import {it,expect,vi} from 'vitest';
import {nativeFirmableBudgetFetch} from './native-firmable-budget';
const context={jobId:'a1a639c7-169c-4bcd-893a-991470047023',key:'company:f1'},env={APP_ORIGIN:'https://app.example.invalid',SERVICE_SECRET:'synthetic-callback-secret'};
it('reserves before EACH actual upstream and persists no tokens/cookies/body in receipts',async()=>{
 const calls:Record<string,unknown>[]=[],order:string[]=[],callback=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{const value=JSON.parse(String(init?.body));calls.push(value);order.push(value.action);return Response.json(value.action==='native-provider-begin'?{kind:'started',operationId:'attempt',fence:'1'}:{ok:true});});
 const physical=vi.fn(async()=>{order.push('UPSTREAM');return Response.json({jwt:'secret-jwt',company:'Sensitive fixture'});}),fetcher=nativeFirmableBudgetFetch(env,context,physical,callback);
 const result=await fetcher('https://clerk.firmable.com/v1/token',{method:'POST',headers:{Cookie:'secret-cookie'},body:'token=secret-token'});expect(await result.json()).toMatchObject({jwt:'secret-jwt'});
 expect(order).toEqual(['native-provider-begin','UPSTREAM','native-provider-finish']);expect(JSON.stringify(calls)).not.toMatch(/secret-cookie|secret-token|secret-jwt|Sensitive fixture/);
 expect(calls[1]).toMatchObject({outcome:{actualCostMicroUsd:null,costBasis:'unknown',response:{status:200}}});
});
it('denies upstream on missing budget, stale metadata or a previously uncertain attempt',async()=>{
 const physical=vi.fn(),callback=vi.fn().mockResolvedValue(Response.json({error:'No budget'},{status:409})),fetcher=nativeFirmableBudgetFetch(env,context,physical,callback);
 await expect(fetcher('https://api.firmable.com/internal/company/f1')).rejects.toThrow('native_budget_admission_required');expect(physical).not.toHaveBeenCalled();
 callback.mockResolvedValue(Response.json({kind:'cached',response:{status:200}}));await expect(fetcher('https://api.firmable.com/internal/company/f1')).rejects.toThrow('native_provider_reconciliation_required');expect(physical).not.toHaveBeenCalled();
});
it('HTTP auth retries have distinct attempt keys and network uncertainty is retained without retrying',async()=>{
 const keys:string[]=[],callback=vi.fn(async(_input:RequestInfo|URL,init?:RequestInit)=>{const p=JSON.parse(String(init?.body));if(p.action==='native-provider-begin'){keys.push(p.key);return Response.json({kind:'started',operationId:'attempt',fence:'1'});}return Response.json({ok:true});}),physical=vi.fn().mockResolvedValueOnce(new Response('',{status:401})).mockRejectedValueOnce(new Error('Network lost')),fetcher=nativeFirmableBudgetFetch(env,context,physical,callback);
 await fetcher('https://api.firmable.com/internal/company/f1');await expect(fetcher('https://api.firmable.com/internal/company/f1')).rejects.toThrow('Network lost');expect(keys).toHaveLength(2);expect(keys[0]).not.toBe(keys[1]);expect(physical).toHaveBeenCalledTimes(2);
 const receipt=JSON.parse(String(callback.mock.calls.at(-1)?.[1]?.body));expect(receipt.outcome).toEqual({actualCostMicroUsd:null,costBasis:'unknown',reason:'request_outcome_unknown'});
});
