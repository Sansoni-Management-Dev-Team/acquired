import {afterEach,expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
vi.mock('server-only',()=>({}));
import {AgentChannelStore} from './agent-channel-store';
const ids={thread:'11111111-1111-4111-8111-111111111111',mandate:'22222222-2222-4222-8222-222222222222',person:'33333333-3333-4333-8333-333333333333',command:'44444444-4444-4444-8444-444444444444',binding:'55555555-5555-4555-8555-555555555555'};
const input={expectedRevision:1,channelOrder:['email'],delaySeconds:10,acceleratedSimulation:true,bindings:[{channel:'email',bindingId:ids.binding}]};
afterEach(()=>vi.restoreAllMocks());
function fixture(options:{reject?:boolean;empty?:boolean}={}){
 const store=new AgentChannelStore({}as never,{organizationId:'fixture-org',userId:'fixture-owner'});
 const saved=new Map<string,{name:string;input_digest:string;state:string;result?:unknown}>();let current:string;
 const query=vi.fn(async(sql:string,values:unknown[]=[])=>{
  if(sql.startsWith('SELECT * FROM agent_operations')){const prior=saved.get(String(values[1]));return{rows:prior?[prior]:[]};}
  if(sql.startsWith('INSERT INTO agent_operations')){current=String(values[4]);saved.set(current,{name:String(values[5]),input_digest:String(values[7]),state:'running'});return{rows:[{id:ids.command}]};}
  if(sql.startsWith("UPDATE agent_operations SET state='complete'")){const row=saved.get(current)!;row.state='complete';row.result=JSON.parse(String(values[1]));return{rows:[]};}
  if(sql.startsWith('SELECT public.agent_save_channel_policy')){if(options.reject)throw new Error('Channel policy changed; review again');return{rows:[{policy:{revision:2}}]};}
  if(sql.startsWith('SELECT v.id'))return{rows:options.empty?[]:[{id:ids.person,epoch:'7',reminder_generation:8}]};
  return{rows:[]};
 });
 const internal=store as unknown as{nativeTransaction:<T>(fn:(c:PoolClient)=>Promise<T>)=>Promise<T>;lockThread:()=>Promise<unknown>;assertExecutionFence:()=>Promise<void>};
 vi.spyOn(internal,'nativeTransaction').mockImplementation(fn=>fn({query}as unknown as PoolClient));
 vi.spyOn(internal,'lockThread').mockResolvedValue({id:ids.thread,mandate_id:ids.mandate,organization_id:'fixture-org',owner_user_id:'fixture-owner'});
 vi.spyOn(internal,'assertExecutionFence').mockResolvedValue();
 return{store,query};
}
it('queues fresh reassessment after exact policy save using post-invalidation epochs and eligible owned conversations only',async()=>{
 const f=fixture();expect(await f.store.saveChannelPolicy(ids.thread,'reviewed-policy',input)).toMatchObject({status:'channel_policy_saved',revision:2});
 const index=f.query.mock.calls.findIndex(([sql])=>sql.startsWith('SELECT v.id'));
 expect(index).toBeGreaterThan(f.query.mock.calls.findIndex(([sql])=>sql.startsWith('SELECT public.agent_save_channel_policy')));
 const [sql,params]=f.query.mock.calls[index];
 for(const guard of ["v.thread_id=$1","v.organization_id=$2","v.owner_user_id=$3","v.driver_kind='agent'","v.phase='active'","v.pending_driver IS NULL","r.state IN('ready','waiting')","r.mandate_revision=m.xmin::text","v.engagement NOT IN('stopped','handoff')","agent_handoffs","agent_mandate_person_has_unresolved_sends"])expect(sql).toContain(guard);
 expect(params).toEqual([ids.thread,'fixture-org','fixture-owner']);
 const event=f.query.mock.calls.find(([statement,values])=>statement.startsWith('INSERT INTO agent_events')&&values?.[5]==='conversation.reassess');
 expect(event?.[1]?.[4]).toBe('channel-policy:2:reassess:'+ids.person);
 expect(JSON.parse(String(event?.[1]?.[6]))).toEqual({conversationId:ids.person,epoch:7,reminderGeneration:8});
 expect(f.query.mock.calls.some(([statement])=>/^UPDATE agent_(events|review_batches)/.test(statement))).toBe(false);
 expect(f.query.mock.calls.some(([statement])=>/communication_dispatch|agent_sink_messages/.test(statement))).toBe(false);
});
it('replays an identical successful policy command without another save or another reassessment',async()=>{
 const f=fixture(),first=await f.store.saveChannelPolicy(ids.thread,'same-human-policy-request',input);
 expect(await f.store.saveChannelPolicy(ids.thread,'same-human-policy-request',input)).toEqual(first);
 expect(f.query.mock.calls.filter(([sql])=>sql.startsWith('SELECT public.agent_save_channel_policy'))).toHaveLength(1);
 expect(f.query.mock.calls.filter(([sql,values])=>sql.startsWith('INSERT INTO agent_events')&&values?.[5]==='conversation.reassess')).toHaveLength(1);
});
it('never wakes conversations after a rejected or stale policy save',async()=>{
 const f=fixture({reject:true});await expect(f.store.saveChannelPolicy(ids.thread,'stale-policy',input)).rejects.toThrow('policy changed');
 expect(f.query.mock.calls.some(([sql])=>sql.startsWith('SELECT v.id')||sql.startsWith('INSERT INTO agent_events'))).toBe(false);
});
it('does not emit a person wake when no current eligible agent conversation remains',async()=>{
 const f=fixture({empty:true});await f.store.saveChannelPolicy(ids.thread,'policy-without-eligible-people',input);
 expect(f.query.mock.calls.filter(([sql,values])=>sql.startsWith('INSERT INTO agent_events')&&values?.[5]==='conversation.reassess')).toHaveLength(0);
});
