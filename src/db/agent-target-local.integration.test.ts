import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {emptyBrief,initialAssessment} from '@/domain/acquisition';
import {vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {AgentTargetStore} from './agent-target-store';
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentTargetStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('reviewed cached target selection (migration0020 required)',()=>{
 beforeAll(async()=>{
  const identity=(await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
  expect(identity).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic target test',$4,'{}',$3)",[mandate,org,user,JSON.stringify({brief:emptyBrief()})]);
  await c.query('COMMIT');}finally{c.release();}
  vi.stubEnv('AGENT_LOCAL_SIMULATION_ENABLED','true');store=new AgentTargetStore(pool,actor);thread=(await store.openThread(mandate)).id;
 });
 afterAll(async()=>{
  // Delete only this suite's synthetic tenant; never use a pilot user's thread.
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const table of ['agent_sink_messages','agent_authority_uses','agent_handoffs','agent_person_claims','agent_budget_reservations','agent_budget_accounts','agent_review_batches','agent_authority_grants','agent_operations','agent_conversations','agent_responsibilities','agent_runs','agent_events','agent_messages','agent_threads','campaign_reply_identities','contacts','mandate_targets','targets','mandates','member','audit_events','communication_send_gates'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
  await c.query('DELETE FROM organization WHERE id=$1',[org]);
  await c.query('DELETE FROM "user" WHERE id=$1',[user]);
  await c.query('COMMIT');}finally{c.release();}
  await pool.end();vi.unstubAllEnvs();
 });

 async function start(){const state=await store.executionState(thread);return store.controlResponsibility(thread,randomUUID(),{action:'start',expectedRevision:state.responsibility?.revision??0,mandateRevision:state.mandateRevision});}

 async function contact(email=randomUUID()+'@example.invalid'){
  const id=randomUUID(),target=randomUUID(),c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query("INSERT INTO targets(id,organization_id,company_name,firmographics) VALUES($1,$2,'Synthetic refrigeration','{}')",[target,org]);await c.query('INSERT INTO mandate_targets(organization_id,mandate_id,target_id,assessment) VALUES($1,$2,$3,$4)',[org,mandate,target,JSON.stringify(initialAssessment)]);await c.query("INSERT INTO contacts(id,organization_id,mandate_id,target_id,display_name,personal_data,provenance,fictionalised) VALUES($1,$2,$3,$4,'Synthetic owner',$5,'{}',false)",[id,org,mandate,target,JSON.stringify({email})]);await c.query('COMMIT');}finally{c.release();}return id;
 }
 async function proposed(){await start();const proposal=await store.proposeTargetSelection(thread,randomUUID(),{mode:'local_sink'});const batch=(await store.listReviewBatches(thread)).find(b=>b.id===proposal.reviewBatchId)!;return {proposal,batch};}
 it('proposes cached contacts with exact review and never allocates before approval',async()=>{
  await contact();const {proposal,batch}=await proposed();expect(batch.operations[0].name).toBe('target.select');expect(batch.operations[0].input.selected.length).toBeGreaterThan(0);await expect(store.allocateApprovedTargets(thread,proposal.id)).rejects.toThrow('Approved');expect((await store.executionState(thread)).conversations).toHaveLength(0);
  await store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved');const allocated=await store.allocateApprovedTargets(thread,proposal.id);expect(allocated.allocated).toBe(1);expect(await new AgentTargetStore(pool,actor).allocateApprovedTargets(thread,proposal.id)).toEqual(allocated);expect((await store.executionState(thread)).conversations).toHaveLength(1);
 });
 it('marks reviewed contact evidence changes stale and refuses approval',async()=>{
  const id=await contact(),{batch}=await proposed();await pool.query("UPDATE contacts SET display_name='Changed synthetic owner' WHERE id=$1",[id]);expect((await store.listReviewBatches(thread)).find(b=>b.id===batch.id)?.stale).toBe(true);await expect(store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved')).rejects.toThrow('changed');
 });
 it('holds one changed contact after approval while allocating other eligible contacts and replaying without duplicates',async()=>{
  const changed=await contact();await contact();const {proposal,batch}=await proposed();await store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved');await pool.query("UPDATE contacts SET display_name='Changed after approval' WHERE id=$1",[changed]);const result=await store.allocateApprovedTargets(thread,proposal.id);expect(result.allocated).toBeGreaterThan(0);expect(result.needsReview).toBeGreaterThan(0);expect(await store.allocateApprovedTargets(thread,proposal.id)).toEqual(result);
 });
 it('requires explicit server simulation mode and does not substitute a missing email account',async()=>{
  vi.stubEnv('AGENT_LOCAL_SIMULATION_ENABLED','false');await expect(store.proposeTargetSelection(thread,randomUUID(),{mode:'local_sink'})).rejects.toThrow('Explicit');vi.stubEnv('AGENT_LOCAL_SIMULATION_ENABLED','true');await expect(store.proposeTargetSelection(thread,randomUUID(),{mode:'communications',bindingId:randomUUID()})).rejects.toThrow('owned email account');
 });
 it('recovers after a committed first allocation and interrupted remaining work without invalidating the approved selection',async()=>{
  await contact();await contact();const {proposal,batch}=await proposed();await store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved');const selected=batch.operations[0].input.selected as {contactId:string}[];expect(selected.length).toBeGreaterThanOrEqual(2);const first=selected[0].contactId;
  const faultPool=new Proxy(pool,{get(target,key,receiver){if(key!=='connect')return Reflect.get(target,key,receiver);return async()=>{const client=await target.connect();return new Proxy(client,{get(current,property){if(property==='query')return (sql:unknown,...args:unknown[])=>{const values=args[0] as unknown[]|undefined;if(typeof sql==='string'&&((sql.includes('INSERT INTO agent_conversations')&&values?.[5]!==first)||(sql.includes("UPDATE agent_operations SET state='complete',result=$2")&&values?.[0]===proposal.id)))return Promise.reject(new Error('Synthetic interruption after one committed contact'));return Reflect.apply(current.query,current,[sql,...args]);};const value=Reflect.get(current,property);return typeof value==='function'?value.bind(current):value;}});};}});
  await expect(new AgentTargetStore(faultPool,actor).allocateApprovedTargets(thread,proposal.id)).rejects.toThrow('interruption');
  const count=(await pool.query('SELECT count(*)::int AS n FROM agent_conversations WHERE organization_id=$1 AND contact_id=ANY($2::uuid[])',[org,selected.map(c=>c.contactId)])).rows[0].n;expect(count).toBe(1);
  const restarted=new AgentTargetStore(pool,actor),result=await restarted.allocateApprovedTargets(thread,proposal.id);expect(result.allocated).toBeGreaterThanOrEqual(2);expect(await restarted.allocateApprovedTargets(thread,proposal.id)).toEqual(result);
  expect((await pool.query('SELECT count(*)::int AS n FROM agent_conversations WHERE organization_id=$1 AND contact_id=ANY($2::uuid[])',[org,selected.map(c=>c.contactId)])).rows[0].n).toBe(result.allocated);
 });

 it('characterizes canonical source-identity aliases before and after the prepared performance migration',async()=>{
  await start();const a=await contact(),b=await contact(),shared='source-'+randomUUID();const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");for(const id of [a,b])await c.query("INSERT INTO campaign_reply_identities(organization_id,owner_user_id,contact_id,channel,identity,source_identity,email,since) VALUES($1,$2,$3,'linkedin',$4,$5,$6,now())",[org,user,id,'identity-'+id,shared,id+'@example.invalid']);await c.query("UPDATE contacts SET personal_data=jsonb_set(personal_data,'{doNotContact}','true') WHERE id=$1",[b]);await c.query('COMMIT');}finally{c.release();}
  const context=await store.targetSelectionContext(thread);expect(context.candidates.find(row=>row.contactId===a)?.blockedReasons).toContain('suppressed');
 });
 it('characterizes normalized email aliases while leaving an unrelated contact admissible',async()=>{
  await start();const email=randomUUID()+'@example.invalid',a=await contact(email),b=await contact('  '+email.toUpperCase()+'  '),unrelated=await contact();await pool.query("UPDATE contacts SET personal_data=jsonb_set(personal_data,'{doNotContact}','true') WHERE id=$1",[b]);const context=await store.targetSelectionContext(thread);expect(context.candidates.find(row=>row.contactId===a)?.blockedReasons).toContain('suppressed');expect(context.candidates.find(row=>row.contactId===unrelated)?.blockedReasons).not.toContain('suppressed');
 });

});
