import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentGuidanceStore} from './agent-guidance-store';
const enabled=process.env.RUN_AGENT_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentGuidanceStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('explicit scoped guidance',()=>{
 beforeAll(async()=>{
  const identity=(await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
  expect(identity).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic conversation test','{}','{}',$3)",[mandate,org,user]);
  await c.query('COMMIT');}finally{c.release();}
  store=new AgentGuidanceStore(pool,actor);thread=(await store.openThread(mandate)).id;
 });
 afterAll(async()=>{
  // Delete only this suite's synthetic tenant; never use a pilot user's thread.
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const table of ['agent_runs','agent_events','agent_operations','agent_messages','agent_threads','mandates','member'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
  await c.query('DELETE FROM organization WHERE id=$1',[org]);
  await c.query('DELETE FROM "user" WHERE id=$1',[user]);
  await c.query('COMMIT');}finally{c.release();}
  await pool.end();
 });

 async function source(){return store.appendMessage(thread,randomUUID(),'user',{text:'Prefer maintenance businesses.'});}
 const data=(sourceMessageId:string)=>({text:'Prefer maintenance businesses.',category:'qualification',sourceMessageId,triggerTerms:['maintenance']});
 it('keeps a feedback candidate out of retrieval until an exact explicit human confirmation',async()=>{
  const message=await source(),candidate=await store.proposeGuidance(thread,randomUUID(),data(message.id));
  expect(await store.relevantGuidance(thread,'maintenance')).toEqual([]);
  const approved=await store.decideGuidance(thread,candidate.id,candidate.revision,'approved');
  expect(approved.revision).toBe(2);
  expect((await store.relevantGuidance(thread,'maintenance')).map(i=>i.id)).toContain(candidate.id);
  expect((await store.decideGuidance(thread,candidate.id,1,'approved')).revision).toBe(2);
 });
 it('requires a real user message in this thread and rejects forged provenance or grant fields',async()=>{
  const bot=await store.appendMessage(thread,randomUUID(),'assistant',{text:'Do not learn this automatically'});
  await expect(store.proposeGuidance(thread,randomUUID(),data(bot.id))).rejects.toThrow('human');
  await expect(store.proposeGuidance(thread,randomUUID(),data(randomUUID()))).rejects.toThrow('human');
  const message=await source();await expect(store.proposeGuidance(thread,randomUUID(),{...data(message.id),approved:true})).rejects.toThrow();
 });
 it('revokes current guidance across restart and denies stale reapproval',async()=>{
  const message=await source(),candidate=await store.proposeGuidance(thread,randomUUID(),data(message.id));
  const approved=await store.decideGuidance(thread,candidate.id,1,'approved');
  await store.decideGuidance(thread,candidate.id,approved.revision,'rejected');
  const current=await new AgentGuidanceStore(pool,actor).relevantGuidance(thread,'maintenance');expect(current.some(i=>i.id===candidate.id)).toBe(false);
  await expect(store.decideGuidance(thread,candidate.id,1,'approved')).rejects.toThrow('changed');
 });
 it('edits invalidate approved guidance until a new human confirmation',async()=>{
  const message=await source(),candidate=await store.proposeGuidance(thread,randomUUID(),data(message.id));
  const approved=await store.decideGuidance(thread,candidate.id,1,'approved');
  const edited=await store.editGuidance(thread,candidate.id,approved.revision,{...data(message.id),text:'New explicit preference'});
  expect(edited.state).toBe('proposed');expect((await store.relevantGuidance(thread,'maintenance')).some(i=>i.id===candidate.id)).toBe(false);
  await expect(store.decideGuidance(thread,candidate.id,approved.revision,'approved')).rejects.toThrow('changed');
  await store.decideGuidance(thread,candidate.id,edited.revision,'approved');
  expect((await store.relevantGuidance(thread,'maintenance')).find(i=>i.id===candidate.id)?.input.text).toBe('New explicit preference');
 });
 it('does not commit a response based on guidance revoked during model generation',async()=>{
  const message=await source(),candidate=await store.proposeGuidance(thread,randomUUID(),data(message.id));
  const approved=await store.decideGuidance(thread,candidate.id,1,'approved');
  const turn=await store.beginConversationTurn(thread,randomUUID(),'Use the guidance');
  await store.decideGuidance(thread,candidate.id,approved.revision,'rejected');
  await expect(store.finishConversationTurn(turn.operationId,'Stale answer',[{id:candidate.id,revision:approved.revision}])).rejects.toThrow('Guidance changed');
  await store.failConversationTurn(turn.operationId,'failed');
 });

 it('captures exact entity feedback as a proposed candidate atomically and replays without duplication',async()=>{
  const op=await store.proposeOperation(thread,randomUUID(),'target.select',{selected:[],notice:'Synthetic qualification result'});
  const key=randomUUID(),input={source:{kind:'operation' as const,id:op.id,revision:op.revision},reason:'Installation work dominates this company.',preference:'Prefer recurring maintenance businesses.',category:'qualification' as const};
  const candidate=await store.captureFeedback(thread,key,input);
  expect(candidate.state).toBe('proposed');expect(candidate.input.sourceEntity).toMatchObject(input.source);
  expect(candidate.input.sourceEntity.digest).toMatch(/^[a-f0-9]{64}$/);
  const sourceMessage=(await store.messages(thread)).find(m=>m.id===candidate.input.sourceMessageId);
  expect(sourceMessage).toMatchObject({role:'user',content:{text:input.reason,feedback:{sourceEntity:candidate.input.sourceEntity}}});
  expect((await store.captureFeedback(thread,key,input)).id).toBe(candidate.id);
  expect((await store.listGuidance(thread)).filter(g=>g.id===candidate.id)).toHaveLength(1);
  expect((await store.relevantGuidance(thread,'maintenance')).some(g=>g.id===candidate.id)).toBe(false);
  await store.decideGuidance(thread,candidate.id,candidate.revision,'approved');
  expect((await store.captureFeedback(thread,key,input)).id).toBe(candidate.id);
  const {sourceEntity:originalEntity,...stripped}=candidate.input;expect(originalEntity).toBeDefined();
  await expect(store.editGuidance(thread,candidate.id,2,stripped)).rejects.toThrow('provenance');
  const plain=await source();await expect(store.editGuidance(thread,candidate.id,2,{...stripped,sourceMessageId:plain.id})).rejects.toThrow('provenance');
  expect((await store.relevantGuidance(thread,'maintenance')).some(g=>g.id===candidate.id)).toBe(true);
  await expect(store.captureFeedback(thread,key,{...input,reason:'Different correction'})).rejects.toThrow('reused');
 });
 it('rejects stale or missing feedback entities and forged source provenance',async()=>{
  const op=await store.proposeOperation(thread,randomUUID(),'email.reply',{body:'Synthetic draft'});
  const input={source:{kind:'operation' as const,id:op.id,revision:op.revision+1},reason:'This reply is too pushy.',preference:'Use a conversational tone.',category:'tone' as const};
  await expect(store.captureFeedback(thread,randomUUID(),input)).rejects.toThrow('changed');
  await expect(store.captureFeedback(thread,randomUUID(),{...input,source:{...input.source,id:randomUUID(),revision:1}})).rejects.toThrow();
  const message=await source();
  await expect(store.proposeGuidance(thread,randomUUID(),{...data(message.id),sourceEntity:{kind:'operation',id:op.id,revision:op.revision,digest:'a'.repeat(64)}})).rejects.toThrow();
 });

 it('rolls back the correction message and candidate when its outbox cannot commit',async()=>{
  const op=await store.proposeOperation(thread,randomUUID(),'email.reply',{body:'A synthetic draft'}),key=randomUUID();
  const faulty=new AgentGuidanceStore({connect:async()=>{const c=await pool.connect();return {query:async(text:string,values?:unknown[])=>{if(text.includes('INSERT INTO agent_events'))throw new Error('Synthetic outbox unavailable');return c.query(text,values);},release:()=>c.release()};}} as unknown as Pool,actor);
  const input={source:{kind:'operation' as const,id:op.id,revision:op.revision},reason:'The question was not answered.',preference:'Answer questions before follow-ups.',category:'follow_up' as const};
  await expect(faulty.captureFeedback(thread,key,input)).rejects.toThrow('outbox');
  for(const table of ['agent_messages','agent_operations'])expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE thread_id=$1 AND request_key=$2`,[thread,'entity-feedback:'+key])).rows[0].n).toBe(0);
  const saved=await store.captureFeedback(thread,key,input);expect(saved.state).toBe('proposed');
  const message=(await store.messages(thread)).find(m=>m.id===saved.input.sourceMessageId);expect(message?.content.feedback.sourceSnapshot.preview).toContain('A synthetic draft');
 });

});
