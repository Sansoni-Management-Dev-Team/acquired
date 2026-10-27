import {expect,it,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {AgentStore} from './agent-store';
import {agentRecordDigest} from '@/lib/agent-record-digest';

const actor={organizationId:'synthetic-org',userId:'synthetic-owner'};
const mandateId='10000000-0000-4000-8000-000000000001';
const thread={id:'10000000-0000-4000-8000-000000000002',organization_id:actor.organizationId,mandate_id:mandateId,owner_user_id:actor.userId,revision:1};
function fixture(){
 const messages=new Map<string,Record<string,unknown>>();
 const query=vi.fn(async(sql:string,values:unknown[]=[]):Promise<{rows:Record<string,unknown>[]}>=>{
  if(sql.includes('SELECT current_user'))return{rows:[{name:'acquire_agent_user',rolsuper:false,rolbypassrls:false}]};
  if(sql.includes('AS installed'))return{rows:[{installed:false}]};
  if(sql.includes('agent_lock_member()'))return{rows:[{allowed:true}]};
  if(sql.startsWith('SELECT * FROM agent_threads'))return{rows:[thread]};
  if(sql.includes('INSERT INTO agent_messages')){const request=String(values[4]);if(!messages.has(request))messages.set(request,{id:'saved-message',role:values[5],content:JSON.parse(String(values[6])),content_digest:values[7]});}
  if(sql.startsWith('SELECT * FROM agent_messages'))return{rows:[messages.get(String(values[1]))!]};
  return{rows:[]};
 });
 const release=vi.fn(),connect=vi.fn(async()=>({query,release}) as unknown as PoolClient);
 return{store:new AgentStore({connect},actor),query,connect,messages};
}
it('keeps owned thread and message persistence idempotent with its existing canonical content digest',async()=>{
 const f=fixture(),key='welcome:'+mandateId,content={text:'Original welcome and brief',details:{executionId:mandateId}};
 expect(await f.store.openThread(mandateId)).toEqual(thread);
 await f.store.appendMessage(thread.id,key,'assistant',content);
 await f.store.appendMessage(thread.id,key,'assistant',content);
 expect(f.messages.size).toBe(1);
 expect(f.messages.get(key)).toMatchObject({content,content_digest:agentRecordDigest({role:'assistant',content})});
 expect(f.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO agent_threads'),[actor.organizationId,mandateId,actor.userId]);
 expect(f.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO agent_messages'),[thread.id,actor.organizationId,mandateId,actor.userId,key,'assistant',JSON.stringify(content),agentRecordDigest({role:'assistant',content})]);
 expect(f.query).toHaveBeenCalledWith('SET LOCAL ROLE acquire_agent_user');
 expect(f.query).toHaveBeenCalledWith(expect.stringContaining("set_config('app.acquire_org'"),[actor.organizationId,actor.userId]);
});
it('rejects a reused message key with different original content without overwriting the saved message',async()=>{
 const f=fixture(),key='welcome:'+mandateId;
 await f.store.appendMessage(thread.id,key,'assistant',{text:'Original brief'});
 await expect(f.store.appendMessage(thread.id,key,'assistant',{text:'Edited brief'})).rejects.toThrow('Idempotency key reused');
 expect(f.messages.get(key)?.content).toEqual({text:'Original brief'});
 expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
});
