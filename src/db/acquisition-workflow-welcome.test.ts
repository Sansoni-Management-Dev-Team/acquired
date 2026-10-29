import {expect,it,vi} from 'vitest';
import {emptyBrief} from '@/domain/acquisition';
import {savedAgentMessages} from '@/lib/agent-saved-messages';
import {agentRecordDigest} from '@/lib/agent-record-digest';
import {AcquisitionWorkflowStore} from './acquisition-workflow-store';
const actor={organizationId:'synthetic-org',userId:'synthetic-owner'};
const id='10000000-0000-4000-8000-000000000001',threadId='10000000-0000-4000-8000-000000000002';
const description='Commercial laundry companies in Queensland.';
const brief={...emptyBrief(),naturalLanguage:description};
const input={requestId:id,preset:'live-research-test' as const,presentation:'agent' as const,brief};
function fixture(failMessage=false){
 let committed=false,receipt:unknown,fail=failMessage;
 const source={description,missPrevious:false};
 const messages=new Map<string,Record<string,unknown>>();
 const row={id,mandate_id:id,organization_id:actor.organizationId,owner_user_id:actor.userId,preset:String(input.preset),presentation:'agent',state:'accepted',revision:1};
 const thread={id:threadId,organization_id:actor.organizationId,mandate_id:id,owner_user_id:actor.userId,revision:1};
 const query=vi.fn(async(sql:string,values:unknown[]=[]):Promise<{rows:Record<string,unknown>[];rowCount?:number}>=>{
  if(sql==='SELECT id FROM acquisition_workflow_executions WHERE id=$1')return{rows:committed&&!source.missPrevious?[{id}]:[]};
  if(sql.includes('SELECT id FROM member'))return{rows:[{id:'member'}],rowCount:1};
  if(sql.startsWith('SELECT organization_id,actor_id,action,entity_id,metadata FROM audit_events'))return{rows:committed?[{organization_id:actor.organizationId,actor_id:actor.userId,action:'workflow.mandate_created',entity_id:id,metadata:receipt}]:[]};
  if(sql.includes("'workflow.mandate_created'"))receipt=JSON.parse(String(values[3]));
  if(sql.includes('public.acquisition_workflow_start'))return{rows:[row]};
  if(sql.includes('SELECT natural_language'))return{rows:[{natural_language:source.description}]};
  if(sql.startsWith('SELECT * FROM agent_threads'))return{rows:[thread]};
  if(sql.includes('INSERT INTO agent_messages')){
   if(fail)throw Error('Synthetic message storage unavailable');
   const key=String(values[4]);if(!messages.has(key))messages.set(key,{id:'saved-welcome',request_key:key,role:values[5],content:JSON.parse(String(values[6])),content_digest:values[7]});
  }
  if(sql.startsWith('SELECT * FROM agent_messages'))return{rows:[messages.get(String(values[1]))!]};
  if(sql.startsWith('SELECT id FROM agent_messages'))return{rows:messages.has(String(values[1]))?[{id:'saved-welcome'}]:[]};
  if(sql==='COMMIT')committed=true;
  return{rows:[]};
 });
 const store=new AcquisitionWorkflowStore({connect:vi.fn(async()=>({query,release:vi.fn()}))} as never,actor);
 return{store,query,messages,row,source,committed:()=>committed,recoverMessageStorage:()=>{fail=false;},seedLegacy:()=>{committed=true;receipt={inputDigest:agentRecordDigest(input)};}};
}
it('saves the welcome and original brief as one visible assistant message before admission commits',async()=>{
 const f=fixture();await f.store.start(input);
 const key=`initial-welcome:v1:${id}`,message=f.messages.get(key)!;
 expect(message).toBeDefined();
 const content=message.content as {text:string};
 expect(content.text).toContain('Hi, I’m Acquire.');expect(content.text).toContain('You’re looking for Commercial laundry companies in Queensland.');expect(content.text).toContain('research-only run; no outreach is sent');
 expect(content.text).not.toMatch(/Ready to begin|Starting|Start research/);
 expect(message.content_digest).toBe(agentRecordDigest({role:'assistant',content}));
 expect(savedAgentMessages([message])).toEqual([{id:'saved-welcome',role:'assistant',content:content.text,noticeKind:'welcome'}]);
 const sql=f.query.mock.calls.map(call=>call[0]);
 expect(sql.findIndex(text=>text.includes('INSERT INTO agent_messages'))).toBeGreaterThan(sql.findIndex(text=>text.includes('public.acquisition_workflow_start')));
 expect(sql.findIndex(text=>text.includes('INSERT INTO agent_messages'))).toBeLessThan(sql.indexOf('COMMIT'));
 expect(f.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO agent_messages'),[threadId,actor.organizationId,id,actor.userId,key,'assistant',JSON.stringify(content),message.content_digest]);
});
it('replays the original admitted request without duplicating or rewriting its saved welcome',async()=>{
 const f=fixture();await f.store.start(input);const original=[...f.messages.values()];
 await f.store.start(input);
 expect(f.messages.size).toBe(1);expect([...f.messages.values()]).toEqual(original);
 expect(f.query.mock.calls.filter(([sql])=>sql.includes('INSERT INTO agent_messages'))).toHaveLength(1);
});
it('rolls back admission if the welcome cannot be stored, so retry can admit the same identity',async()=>{
 const f=fixture(true);await expect(f.store.start(input)).rejects.toThrow('Synthetic message storage unavailable');
 expect(f.committed()).toBe(false);expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
 f.recoverMessageStorage();await f.store.start(input);expect(f.committed()).toBe(true);expect(f.messages.size).toBe(1);
});
it('preserves the first opening when a concurrent replay saw no execution before the admission fence',async()=>{
 const f=fixture();await f.store.start(input);const original=[...f.messages.values()];
 f.source.missPrevious=true;f.source.description='A subsequently edited brief must not rewrite the original opening.';
 await f.store.start(input);
 expect([...f.messages.values()]).toEqual(original);expect(f.query.mock.calls.filter(([sql])=>sql.includes('INSERT INTO agent_messages'))).toHaveLength(1);
});
it('does not retrofit a historical admission receipt with a new welcome on replay',async()=>{
 const f=fixture();f.seedLegacy();expect(await f.store.start(input)).toMatchObject({replayed:true});
 expect(f.messages.size).toBe(0);expect(f.query.mock.calls.some(([sql])=>/agent_threads|agent_messages/.test(sql))).toBe(false);
});
it('keeps ordinary workspace admission free of chat thread or message writes',async()=>{
 const f=fixture();f.row.presentation='workspace';await f.store.start({...input,presentation:'workspace'});
 expect(f.messages.size).toBe(0);expect(f.query.mock.calls.some(([sql])=>/agent_threads|agent_messages/.test(sql))).toBe(false);
});
it('saves the matching live-agent introduction without turning it into research-only copy',async()=>{
 const f=fixture();f.row.preset='live';await f.store.start({...input,preset:'live'});
 const content=f.messages.get(`initial-welcome:v1:${id}`)?.content as {text:string};
 expect(content.text).toContain('help reach out by email, WhatsApp and LinkedIn');expect(content.text).toContain(description);
 expect(content.text).not.toContain('research-only');
});
it('keeps reading saved workflow status free of welcome backfills or other writes',async()=>{
 const f=fixture();await f.store.read(id);
 expect(f.query).toHaveBeenCalledWith('BEGIN READ ONLY');expect(f.query.mock.calls.some(([sql])=>/INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
});
