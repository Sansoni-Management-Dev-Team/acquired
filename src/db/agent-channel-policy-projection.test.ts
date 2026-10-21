import {beforeEach,expect,it,vi} from 'vitest';
import type {Pool,PoolClient} from 'pg';
const m=vi.hoisted(()=>({defaults:vi.fn()}));
vi.mock('@/lib/communications-bindings',()=>({readManagedDefaults:m.defaults}));
import {AgentChannelStore} from './agent-channel-store';
const mandate='00000000-0000-4000-8000-000000000001',actor={organizationId:'org',userId:'owner'};
const binding={id:'00000000-0000-4000-8000-000000000002',organization_id:'org',owner_user_id:'owner',application_id:'acquire',service_connection_id:'current-connection',service_account_id:'current-account',generation:2,channel:'email',platform:'gmail',backend:'unipile',eligible_for_new_work:true};
function fixture(){
 const calls:string[]=[],query=vi.fn(async(text:string,values?:unknown[])=>{void values;calls.push(text);return{rowCount:1,rows:text.includes('to_regclass')?[{installed:true}]:text.includes('FROM mandates')?[{id:mandate}]:text.includes('FROM agent_threads')?[]:text.includes('FROM communication_bindings')?[binding,{...binding,id:'old',generation:1,eligible_for_new_work:false}]:[]};});
 class Harness extends AgentChannelStore{protected override async nativeTransaction<T>(work:(c:PoolClient)=>Promise<T>){expect(m.defaults).toHaveBeenCalled();return work({query} as unknown as PoolClient);}}
 return {query,calls,store:new Harness({} as Pick<Pool,'connect'>,actor)};
}
beforeEach(()=>{vi.resetAllMocks();m.defaults.mockResolvedValue([{channel:'email',connectionId:'current-connection',accountId:'current-account',generation:2}]);});
it('marks only the exact allowed recorded default and current generation without changing accounts or authority',async()=>{
 const f=fixture(),result=await f.store.channelPolicyForMandate(mandate);
 expect(m.defaults).toHaveBeenCalledExactlyOnceWith(actor);
 expect(result.accounts).toEqual([expect.objectContaining({bindingId:binding.id,isDefault:true,eligibleForNewWork:true}),expect.objectContaining({bindingId:'old',isDefault:false,eligibleForNewWork:false})]);
 const [sql,params]=f.query.mock.calls.find(([text])=>text.includes('FROM communication_bindings'))!;
 for(const value of ['agent_allowed_mandate_binding','newer.generation>b.generation','newer.service_connection_id=b.service_connection_id'])expect(sql).toContain(value);
 expect(params).toEqual(['org','owner',mandate]);expect(f.calls.every(sql=>sql.startsWith('SELECT'))).toBe(true);
});
it('does not project another account generation or a real default absent from the mandate scope as selected',async()=>{
 m.defaults.mockResolvedValue([{channel:'email',connectionId:'real-unrelated',accountId:'real-account',generation:2},{channel:'email',connectionId:'current-connection',accountId:'current-account',generation:99}]);
 expect((await fixture().store.channelPolicyForMandate(mandate)).accounts.every(account=>account.isDefault===false)).toBe(true);
});

it('derives demo defaults from one immutable prepared recipient run using owned read-only queries',async()=>{
 const senders=(['email','whatsapp','linkedin']as const).map((channel,i)=>({channel,bindingId:`00000000-0000-4000-8000-00000000000${i+3}`,bindingDigest:'a'.repeat(64),accountId:'private-service-reference'}));
 const query=vi.fn(async(sql:string)=>({rows:sql.includes('SELECT DISTINCT run.id,run.senders')?[{id:mandate,senders}]:[]}));
 class Harness extends AgentChannelStore{protected override async nativeTransaction<T>(work:(c:PoolClient)=>Promise<T>){return work({query}as unknown as PoolClient);}protected override async thread(){return{id:mandate,mandate_id:mandate,organization_id:'org',owner_user_id:'owner'} as never;}}
 const store=new Harness({}as Pick<Pool,'connect'>,actor);expect(await store.demoOutreachAccounts(mandate)).toEqual(senders.map(({channel,bindingId,bindingDigest})=>({channel,bindingId,bindingDigest})));
 const [sql,params]=query.mock.calls[0] as unknown as [string,string[]];expect(params).toEqual([mandate,'org','owner']);for(const guard of ["mode.mode='demo'",'mode.created_by=$3','mapping.created_by=$3','mapping.organization_id=$2'])expect(sql).toContain(guard);expect(sql.startsWith('SELECT')).toBe(true);
 query.mockResolvedValueOnce({rows:[]});await expect(store.demoOutreachAccounts(mandate)).rejects.toThrow('One saved demo');
 query.mockResolvedValueOnce({rows:[{id:mandate,senders},{id:'other',senders}]});await expect(store.demoOutreachAccounts(mandate)).rejects.toThrow('One saved demo');
});
