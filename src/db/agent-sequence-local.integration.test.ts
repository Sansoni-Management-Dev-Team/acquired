import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {agentOutboxFailurePool} from '@/test/agent-pg-fault';
import {AgentSequenceStore} from './agent-sequence-store';
const enabled=process.env.RUN_AGENT_SEQUENCE_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentSequenceStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('reviewed agent sequence drafts (approved0026/0027/0032 schema required)',()=>{
 beforeAll(async()=>{
  const identity=(await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
  expect(identity).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic conversation test','{}','{}',$3)",[mandate,org,user]);
  await c.query('COMMIT');}finally{c.release();}
  store=new AgentSequenceStore(pool,actor);thread=(await store.openThread(mandate)).id;
 });
 afterAll(async()=>{
  // Delete only this suite's synthetic tenant; never use a pilot user's thread.
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const table of ['agent_sink_messages','agent_authority_uses','agent_handoffs','agent_person_claims','agent_budget_reservations','agent_budget_accounts','agent_review_batches','agent_authority_grants','agent_operations','agent_conversations','agent_responsibilities','agent_runs','agent_events','agent_messages','agent_threads','campaign_sequences','contacts','mandates','member','audit_events','communication_send_gates'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
  await c.query('DELETE FROM organization WHERE id=$1',[org]);
  await c.query('DELETE FROM "user" WHERE id=$1',[user]);
  await c.query('COMMIT');}finally{c.release();}
  await pool.end();
 });

 async function start(){const state=await store.executionState(thread);return store.controlResponsibility(thread,randomUUID(),{action:'start',expectedRevision:state.responsibility?.revision??0,mandateRevision:state.mandateRevision});}

 const definition={schemaVersion:1 as const,steps:[{id:randomUUID(),kind:'email' as const,title:'Introduction',subject:'Business enquiry',body:'Synthetic draft only',position:{x:120,y:240}}],disconnectedConnections:[{source:'start' as const,target:''}]};
 async function propose(input:unknown={name:'Reviewed synthetic draft',definition:{...definition,disconnectedConnections:[{source:'start',target:definition.steps[0].id}]}}){await start();const proposal=await store.proposeSequenceDraft(thread,randomUUID(),input);const batch=(await store.listReviewBatches(thread)).find(b=>b.id===proposal.reviewBatchId)!;return {proposal,batch};}
 it('saves the complete approved draft exactly once, keeps published state unchanged and makes it readable by the old builder',async()=>{
  const {proposal,batch}=await propose();await expect(store.saveApprovedSequenceDraft(thread,proposal.id)).rejects.toThrow('approval');expect((await pool.query('SELECT count(*)::int n FROM campaign_sequences WHERE organization_id=$1',[org])).rows[0].n).toBe(0);
  await store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved');const saved=await store.saveApprovedSequenceDraft(thread,proposal.id);expect(saved).toMatchObject({published:false,enrolled:false,providerCalled:false});
  expect(await new AgentSequenceStore(pool,actor).saveApprovedSequenceDraft(thread,proposal.id)).toEqual(saved);const oldBuilder=(await pool.query('SELECT * FROM campaign_sequences WHERE id=$1',[saved.sequenceId])).rows[0];expect(oldBuilder.published_version).toBe(0);expect(oldBuilder.draft.steps[0].position).toEqual({x:120,y:240});expect(oldBuilder.draft.disconnectedConnections).toHaveLength(1);
  await pool.query("UPDATE campaign_sequences SET name='Later human edit' WHERE id=$1",[saved.sequenceId]);expect(await store.saveApprovedSequenceDraft(thread,proposal.id)).toEqual(saved);expect((await pool.query('SELECT name FROM campaign_sequences WHERE id=$1',[saved.sequenceId])).rows[0].name).toBe('Later human edit');
 });
 it('preserves human changes after an agent update proposal and marks its exact review stale',async()=>{
  const first=await propose();await store.decideReviewBatch(thread,first.batch.id,first.batch.revision,first.batch.manifest,'approved');const saved=await store.saveApprovedSequenceDraft(thread,first.proposal.id),revision=(await store.sequenceDrafts(thread)).find(row=>row.id===saved.sequenceId)!.revision;
  const update=await propose({name:'Agent proposed edit',definition:{schemaVersion:1,steps:definition.steps},sequenceId:saved.sequenceId,expectedRevision:revision});await pool.query("UPDATE campaign_sequences SET name='New human version' WHERE id=$1",[saved.sequenceId]);expect((await store.listReviewBatches(thread)).find(b=>b.id===update.batch.id)?.stale).toBe(true);await expect(store.decideReviewBatch(thread,update.batch.id,update.batch.revision,update.batch.manifest,'approved')).rejects.toThrow('changed');expect((await pool.query('SELECT name FROM campaign_sequences WHERE id=$1',[saved.sequenceId])).rows[0].name).toBe('New human version');
 });
 it('does not grant the agent role permission to publish versions or enrol contacts',async()=>{
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE acquire_agent_user');expect((await c.query("SELECT has_table_privilege(current_user,'campaign_sequence_versions','INSERT') published,has_table_privilege(current_user,'campaign_enrolments','INSERT') enrolled")).rows[0]).toEqual({published:false,enrolled:false});await c.query('ROLLBACK');}finally{c.release();}
 });
 async function audit(id:string){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE acquire_agent_user');await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);await c.query('SELECT agent_lock_send_gate()');const result=(await c.query('SELECT agent_audit_completed_sequence($1::uuid) AS id',[id])).rows[0];await c.query('COMMIT');return result.id as string;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}
 it('writes only a server-derived completed reviewed sequence audit and deduplicates exact receipt replay without broad audit grants',async()=>{const {proposal,batch}=await propose();await expect(audit(proposal.id)).rejects.toThrow('completed owned');await store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved');await store.saveApprovedSequenceDraft(thread,proposal.id);const first=await audit(proposal.id);expect(await audit(proposal.id)).toBe(first);expect((await pool.query("SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND actor_id=$2 AND action='agent.sequence_draft_saved' AND metadata->>'operationId'=$3",[org,user,proposal.id])).rows[0].n).toBe(1);await expect(audit(randomUUID())).rejects.toThrow('completed owned');const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE acquire_agent_user');expect((await c.query("SELECT has_table_privilege(current_user,'audit_events','INSERT') inserted")).rows[0].inserted).toBe(false);await c.query('ROLLBACK');}finally{c.release();}});
 it('rolls draft, receipt, audit and chat back together when the final event fails, then recovers once on replay',async()=>{const {proposal,batch}=await propose();await store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved');const sequenceId=batch.operations[0].input.sequenceId;await expect(new AgentSequenceStore(agentOutboxFailurePool(pool),actor).saveApprovedSequenceDraft(thread,proposal.id)).rejects.toThrow('Injected agent outbox failure');expect((await pool.query('SELECT count(*)::int n FROM campaign_sequences WHERE id=$1',[sequenceId])).rows[0].n).toBe(0);expect((await pool.query("SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND metadata->>'operationId'=$2",[org,proposal.id])).rows[0].n).toBe(0);expect((await pool.query('SELECT state,result FROM agent_operations WHERE id=$1',[proposal.id])).rows[0]).toMatchObject({state:'approved',result:null});await store.saveApprovedSequenceDraft(thread,proposal.id);expect((await pool.query("SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND metadata->>'operationId'=$2",[org,proposal.id])).rows[0].n).toBe(1);});

});
