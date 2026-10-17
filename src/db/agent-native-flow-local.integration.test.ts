import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentModelStore} from './agent-model-store';
import {runAgentEvent} from '@/lib/agent-event-worker';
import {createNativeAgentHandlers} from '@/lib/agent-native-handlers';
import type {AgentConversationContext} from '@/lib/agent-conversation-engine';
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentModelStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('native persisted conversation flow without a browser',()=>{
 beforeAll(async()=>{
  const identity=(await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
  expect(identity).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic conversation test','{}','{}',$3)",[mandate,org,user]);
  await c.query('COMMIT');}finally{c.release();}
  store=new AgentModelStore(pool,actor);thread=(await store.openThread(mandate)).id;
 });
 afterAll(async()=>{
  // Delete only this suite's synthetic tenant; never use a pilot user's thread.
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const table of ['agent_sink_messages','agent_authority_uses','agent_handoffs','agent_person_claims','agent_budget_reservations','agent_budget_accounts','agent_review_batches','agent_authority_grants','agent_operations','agent_conversations','agent_responsibilities','agent_runs','agent_events','agent_messages','agent_threads','contacts','mandates','member','audit_events','communication_send_gates'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
  await c.query('DELETE FROM organization WHERE id=$1',[org]);
  await c.query('DELETE FROM "user" WHERE id=$1',[user]);
  await c.query('COMMIT');}finally{c.release();}
  await pool.end();
 });

 async function start(){const state=await store.executionState(thread);return store.controlResponsibility(thread,randomUUID(),{action:'start',expectedRevision:state.responsibility?.revision??0,mandateRevision:state.mandateRevision});}
 async function contact(email='owner@example.invalid'){
  const id=randomUUID(),c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query("INSERT INTO contacts(id,organization_id,mandate_id,display_name,personal_data,provenance,fictionalised) VALUES($1,$2,$3,'Synthetic owner',$4,'{}',false)",[id,org,mandate,JSON.stringify({email})]);await c.query('COMMIT');}finally{c.release();}return id;
 }

 async function prepared(){
  await start();const opened=await store.openConversation(thread,randomUUID(),{contactId:await contact(randomUUID()+'@example.invalid'),deliveryMode:'local_sink'});
  await store.ingestHistory(thread,opened.id,{source:'local_fixture',observedAt:new Date().toISOString(),complete:true,messages:[]});
  return store.conversation(thread,opened.id);
 }
 async function budgets(){
  const start=new Date();start.setUTCHours(0,0,0,0);
  for(const scopeKey of ['organization:sends','user:'+user+':sends','mandate:'+mandate+':sends'])await store.configureBudget({scopeKey,unit:'sends',windowStart:start.toISOString(),windowEnd:new Date(start.getTime()+86400000).toISOString(),cap:'10',expectedRevision:0});
 }

 it('resumes from saved events across fresh store instances: draft, human approval, simulation, reply and handoff',async()=>{
  await budgets();const row=await prepared();let decisions=0;
  const decide=()=>async(context:AgentConversationContext)=>{
   decisions++;
   return context.history.some(m=>m.direction==='inbound')?{action:'handoff',reason:'The lead requested a call',summary:'Please review the conversation and send the booking link',sourceIds:[]}:context.history.length?{action:'wait',reminder:{wakeAt:new Date(Date.now()+3*86400000).toISOString(),timeZone:'Australia/Sydney',reason:'Give the lead time to reply, then reassess'},sourceIds:[]}:{action:'draft',draft:{kind:'initial_email',intent:'initial',subject:'Confidential acquisition enquiry',body:'Would you consider a confidential conversation about your business?',rationale:'Explore the mandate goal',sourceIds:['mandate:'+mandate]}};
  };
  async function drain(){
   for(let index=0;index<30;index++){
    // Every tick builds a fresh store: no browser or in-memory conversation owns
    // the progress. Model output is a controlled fixture, not a live quality eval.
    const restarted=new AgentModelStore(pool,actor),handlers=createNativeAgentHandlers({store:restarted,decide,supervise:async()=>({kind:'complete'})});
    const result=await runAgentEvent({store:restarted,workerId:randomUUID(),handlers});if(result==='idle')return;
    expect(result).toBe('complete');
   }throw new Error('Unbounded event recursion');
  }
  await drain();expect(decisions).toBe(1);
  const batch=(await store.listReviewBatches(thread)).find(b=>b.state==='pending');expect(batch.operations).toHaveLength(1);
  expect((await pool.query('SELECT count(*)::int n FROM agent_sink_messages WHERE organization_id=$1',[org])).rows[0].n).toBe(0);
  await store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved');await drain();
  expect((await pool.query('SELECT count(*)::int n FROM agent_sink_messages WHERE organization_id=$1',[org])).rows[0].n).toBe(1);
  expect(decisions).toBe(2);
  const sent=await store.conversation(thread,row.id),instant=new Date().toISOString();expect(sent.next_wakeup_at).not.toBeNull();
  await store.ingestHistory(thread,row.id,{source:'local_fixture',observedAt:instant,complete:true,messages:[...sent.history,{id:'lead-call-request',direction:'inbound',text:'Yes, can we arrange a call?',at:instant}]});await drain();
  expect(decisions).toBe(3);expect((await store.listHandoffs(thread))).toHaveLength(1);
  expect(await store.conversation(thread,row.id)).toMatchObject({driver_kind:'human',phase:'paused',engagement:'handoff',next_wakeup_at:null});
  expect((await store.messages(thread)).some(m=>m.content?.text?.includes('send the booking link'))).toBe(true);
  expect((await pool.query('SELECT count(*)::int n FROM agent_sink_messages WHERE organization_id=$1',[org])).rows[0].n).toBe(1);
 });
});
