import{it,expect,vi}from'vitest';
import type{PoolClient}from'pg';
import{AgentOutreachStore}from'./agent-outreach-store';
import type{AgentThread}from'./agent-store';
const id='10000000-0000-4000-8000-000000000001';
it.each([{expired:false,has_intent:false},{expired:true,has_intent:true}])('never settles an early30s lookup while authority or an intent exists (%j)',async condition=>{
 const query=vi.fn(async(sql:string)=>{void sql;return{rows:[{state:'running',...condition}]};});
 class Store extends AgentOutreachStore{
  protected override async nativeTransaction<T>(work:(client:PoolClient)=>Promise<T>){return work({query}as unknown as PoolClient);}
  protected override async lockThread(){return{id}as AgentThread;}
  protected override async assertExecutionFence(){}
 }
 const store=new Store({connect:vi.fn()}as never,{organizationId:'org',userId:'owner'});
 expect(await store.abandonUnpreparedNativeEmail(id,id,{runId:id,eventId:id,leaseOwner:id,fence:'1'})).toBe(false);
 expect(query).toHaveBeenCalledOnce();expect(query.mock.calls.some(call=>String(call[0]).includes('SELECT agent_communications_no_submission('))).toBe(false);
});
