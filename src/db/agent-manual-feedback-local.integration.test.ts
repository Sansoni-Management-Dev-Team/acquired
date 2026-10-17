import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';import {randomUUID} from 'node:crypto';
import {AgentGuidanceStore} from './agent-guidance-store';
import {initialAssessment} from '@/domain/acquisition';
const enabled=process.env.RUN_AGENT_MANUAL_FEEDBACK_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'}),org=randomUUID(),user=randomUUID(),mandate=randomUUID(),foreign=randomUUID(),target=randomUUID(),sequence=randomUUID(),actor={organizationId:org,userId:user};let store:AgentGuidanceStore,thread:string,foreignThread:string,sequenceRevision:string;
const input=()=>({source:{kind:'target_review' as const,targetId:target,revision:2},reason:'Installation-heavy project work dominates.',preference:'Prefer recurring maintenance businesses.',category:'qualification' as const});
describe.runIf(enabled)('manual feedback saved source provenance',()=>{
 beforeAll(async()=>{expect((await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
 const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);for(const id of[mandate,foreign])await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic manual feedback','{}','{}',$3)",[id,org,user]);await c.query("INSERT INTO targets(id,organization_id,mandate_id,company_name,domain,firmographics) VALUES($1,$2,$3,'Synthetic installation-heavy company','manual.example.invalid','{}')",[target,org,mandate]);await c.query('INSERT INTO mandate_targets(organization_id,mandate_id,target_id,assessment,version) VALUES($1,$2,$3,$4,2)',[org,mandate,target,JSON.stringify({...initialAssessment,stage:'rejected',reason:'Installation-heavy projects'})]);sequenceRevision=(await c.query("INSERT INTO campaign_sequences(id,organization_id,owner_user_id,mandate_id,name,draft) VALUES($1,$2,$3,$4,'Synthetic manual sequence',$5) RETURNING xmin::text AS revision",[sequence,org,user,mandate,JSON.stringify({steps:[{type:'email',body:'Literal original human draft'}]})])).rows[0].revision;await c.query('COMMIT');}finally{c.release();}
 store=new AgentGuidanceStore(pool,actor);thread=(await store.openThread(mandate)).id;foreignThread=(await store.openThread(foreign)).id;
 });
 afterAll(async()=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");for(const table of ['agent_runs','agent_events','agent_operations','agent_messages','agent_threads','campaign_sequences','mandate_targets','targets','mandates','member','communication_send_gates'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);await c.query('DELETE FROM organization WHERE id=$1',[org]);await c.query('DELETE FROM "user" WHERE id=$1',[user]);await c.query('COMMIT');}finally{c.release();}await pool.end();});
 it('records exact saved qualification feedback without starting supervision, then confirms/revokes independently',async()=>{
  const before=(await pool.query('SELECT assessment,version FROM mandate_targets WHERE target_id=$1',[target])).rows[0];
  const key=randomUUID(),op=await store.captureManualFeedback(thread,key,input());expect(op.state).toBe('proposed');expect(op.input.sourceEntity).toMatchObject({kind:'target_review',id:target,revision:2});expect(op.input.sourceEntity.digest).toMatch(/^[a-f0-9]{64}$/);
  expect(await store.relevantGuidance(thread,'maintenance')).toEqual([]);expect((await pool.query('SELECT count(*)::int AS n FROM agent_responsibilities WHERE thread_id=$1',[thread])).rows[0].n).toBe(0);
  const human=(await store.messages(thread)).find(m=>m.id===op.input.sourceMessageId);expect(human?.content.feedback.sourceSnapshot.preview).toContain('Installation-heavy projects');
  const approved=await store.decideGuidance(thread,op.id,op.revision,'approved');expect((await store.relevantGuidance(thread,'maintenance')).map(g=>g.id)).toContain(op.id);
  expect((await store.captureManualFeedback(thread,key,input())).revision).toBe(approved.revision);
  await store.decideGuidance(thread,op.id,approved.revision,'rejected');expect((await new AgentGuidanceStore(pool,actor).relevantGuidance(thread,'maintenance')).map(g=>g.id)).not.toContain(op.id);
  expect((await pool.query('SELECT assessment,version FROM mandate_targets WHERE target_id=$1',[target])).rows[0]).toEqual(before);
 });
 it('denies foreign mandate/stale source/forgery with no candidate or human feedback residue',async()=>{
  await expect(store.captureManualFeedback(foreignThread,randomUUID(),input())).rejects.toThrow(/unavailable/);
  await expect(store.captureManualFeedback(thread,randomUUID(),{...input(),source:{...input().source,revision:1}})).rejects.toThrow(/changed/);
  await expect(store.captureManualFeedback(thread,randomUUID(),{...input(),source:{...input().source,snapshot:{approved:true}}})).rejects.toThrow();
  expect(await store.listGuidance(foreignThread)).toEqual([]);
 });
 it('captures owner-only exact xmin manual sequence source, without changing literal draft/publication or n8n',async()=>{
  const before=(await pool.query('SELECT * FROM campaign_sequences WHERE id=$1',[sequence])).rows[0],key=randomUUID(),value={...input(),category:'tone',source:{kind:'sequence_draft',sequenceId:sequence,revision:sequenceRevision}};
  const op=await store.captureManualFeedback(thread,key,value);expect(op.input.sourceEntity).toMatchObject({kind:'sequence_draft',revision:sequenceRevision});
  expect((await store.messages(thread)).find(m=>m.id===op.input.sourceMessageId)?.content.feedback.sourceSnapshot.preview).toContain('Literal original human draft');
  expect((await pool.query('SELECT * FROM campaign_sequences WHERE id=$1',[sequence])).rows[0]).toEqual(before);
  await expect(store.captureManualFeedback(thread,randomUUID(),{...value,source:{...value.source,revision:'1'}})).rejects.toThrow(/changed/);
  await expect(store.captureManualFeedback(thread,key,{...value,preference:'Changed general preference'})).rejects.toThrow(/reused/);
 });
 it('rolls back source message/candidate when outbox fails',async()=>{
  const faulty=new AgentGuidanceStore({connect:async()=>{const c=await pool.connect();return{query:async(text:string,values?:unknown[])=>{if(text.includes('INSERT INTO agent_events'))throw new Error('Synthetic outbox unavailable');return c.query(text,values);},release:()=>c.release()};}} as unknown as Pool,actor),key=randomUUID();
  await expect(faulty.captureManualFeedback(thread,key,input())).rejects.toThrow(/outbox/);
  for(const table of['agent_messages','agent_operations'])expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE thread_id=$1 AND request_key=$2`,[thread,'manual-feedback:'+key])).rows[0].n).toBe(0);
 });
});
