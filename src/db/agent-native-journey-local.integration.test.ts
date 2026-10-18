import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentChatStore} from './agent-chat-store';
import {createNativeAgentMandate} from '@/lib/agent-native-create';
import {emptyBrief,initialAssessment} from '@/domain/acquisition';
import {runAgentEvent} from '@/lib/agent-event-worker';
import {createNativeAgentHandlers} from '@/lib/agent-native-handlers';
import {createResearchSupervisor} from '@/lib/agent-research-supervisor';
import {reuseCachedMandateTargets} from '@/lib/agent-people-supervisor';
import {nativeModelSpecification} from '@/lib/agent-model-decision';
import type {AgentConversationContext,NativeConversationDecision} from '@/lib/agent-conversation-engine';
import type {AgentExecutionFence} from './agent-execution-store';

// This is transaction/orchestration acceptance with scripted decisions and
// fabricated bounded usage receipts. It is NOT an LLM-quality or live-send eval.
const enabled=process.env.RUN_AGENT_JOURNEY_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
const org=randomUUID(),user=randomUUID(),mandate=randomUUID(),target=randomUUID(),contact=randomUUID(),legacyTarget=randomUUID(),legacyContact=randomUUID(),sequence=randomUUID(),version=randomUUID(),enrolment=randomUUID();
const actor={organizationId:org,userId:user},creation={requestId:mandate,brief:{...emptyBrief(),name:'Synthetic complete native journey',naturalLanguage:'Explore an acquisition with the intention of arranging a confidential introductory call.'}};
let thread:string,conversationId:string,network:ReturnType<typeof vi.fn>;
const fresh=()=>new AgentChatStore(pool,actor);
const fence=(input:{runId:string;event:{id:string;lease_owner:string;fence:string}}):AgentExecutionFence=>({runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence});

describe.runIf(enabled)('whole native mandate journey with fresh stores and original n8n ownership preserved',()=>{
 beforeAll(async()=>{
  expect((await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const installed=(await pool.query("SELECT to_regprocedure('public.agent_event_eligible(uuid,text)') IS NOT NULL AS eligible")).rows[0];
  if(!installed.eligible)throw Error('Prepared journey acceptance requires specifically approved0031; it has not been installed.');
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);await c.query('COMMIT');}finally{c.release();}
  vi.stubEnv('AGENT_DURABLE_STATE_ENABLED','true');vi.stubEnv('AGENT_NATIVE_EXECUTION_ENABLED','true');vi.stubEnv('AGENT_LOCAL_SIMULATION_ENABLED','true');
  network=vi.fn().mockRejectedValue(Error('No external HTTP is allowed in this synthetic journey'));vi.stubGlobal('fetch',network);
 });
 afterAll(async()=>{
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");for(const table of ['agent_sink_messages','agent_authority_uses','agent_handoffs','agent_person_claims','agent_budget_reservations','agent_budget_accounts','agent_review_batches','agent_authority_grants','agent_operations','agent_conversations','agent_responsibilities','agent_runs','agent_events','agent_messages','agent_threads','campaign_reply_identities','campaign_contact_assignments','campaign_enrolments','campaign_sequence_versions','campaign_sequences','research_jobs','contacts','mandate_targets','targets','mandates','member','audit_events','communication_send_gates'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);await c.query('DELETE FROM organization WHERE id=$1',[org]);await c.query('DELETE FROM "user" WHERE id=$1',[user]);await c.query('COMMIT');}finally{c.release();}await pool.end();vi.unstubAllGlobals();vi.unstubAllEnvs();
 });
 async function cachedFixtures(){
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
   for(const [id,name]of [[target,'Cached synthetic refrigeration'],[legacyTarget,'Original structured sequence company']])await c.query('INSERT INTO targets(id,organization_id,mandate_id,company_name,domain,firmographics) VALUES($1,$2,$3,$4,$5,$6)',[id,org,mandate,name,id+'.example.invalid',JSON.stringify({states:['QLD'],industries:['Commercial refrigeration']})]);
   await c.query('INSERT INTO mandate_targets(organization_id,mandate_id,target_id,assessment) VALUES($1,$2,$3,$4)',[org,mandate,target,JSON.stringify(initialAssessment)]);
   for(const[id,tid,email]of [[contact,target,'journey-owner@example.invalid'],[legacyContact,legacyTarget,'original-n8n-owner@example.invalid']])await c.query("INSERT INTO contacts(id,organization_id,mandate_id,target_id,display_name,personal_data,provenance,fictionalised) VALUES($1,$2,$3,$4,'Synthetic owner',$5,'{\"source\":\"Existing reviewed database record\"}',false)",[id,org,mandate,tid,JSON.stringify({email,doNotContact:false})]);
   await c.query("INSERT INTO campaign_sequences(id,organization_id,owner_user_id,mandate_id,name,draft,published_version) VALUES($1,$2,$3,$4,'Original UI sequence','{\"fixture\":\"original-builder-draft\"}',7)",[sequence,org,user,mandate]);
   await c.query("INSERT INTO campaign_sequence_versions(id,organization_id,owner_user_id,sequence_id,version,definition,n8n_workflow_id) VALUES($1,$2,$3,$4,7,'{\"fixture\":\"original-published-definition\"}',$5)",[version,org,user,sequence,'synthetic-original-workflow-'+version]);
   await c.query("INSERT INTO campaign_enrolments(id,organization_id,owner_user_id,sequence_id,version_id,mandate_id,contact_id,recipient_email,state,runtime,n8n_started_at,step_index) VALUES($1,$2,$3,$4,$5,$6,$7,'original-n8n-owner@example.invalid','active','n8n',now(),2)",[enrolment,org,user,sequence,version,mandate,legacyContact]);
   await c.query('COMMIT');}finally{c.release();}
 }
 async function originalPins(){return {sequence:(await pool.query('SELECT * FROM campaign_sequences WHERE id=$1',[sequence])).rows[0],version:(await pool.query('SELECT * FROM campaign_sequence_versions WHERE id=$1',[version])).rows[0],enrolment:(await pool.query('SELECT * FROM campaign_enrolments WHERE id=$1',[enrolment])).rows[0]};}
 async function limits(){const d=new Date();d.setUTCHours(0,0,0,0);for(const unit of ['calls','usd_micro','sends'])for(const scope of ['organization','user:'+user,'mandate:'+mandate])await fresh().configureBudget({scopeKey:scope+':'+unit,unit,windowStart:d.toISOString(),windowEnd:new Date(d.getTime()+86400000).toISOString(),cap:unit==='usd_micro'?'1000000':'100',expectedRevision:0});}
 function decision(context:AgentConversationContext):NativeConversationDecision{
  const latest=context.history.at(-1);
  if(latest?.direction==='inbound'&&/arrange a call/i.test(latest.text))return {action:'handoff',reason:'Lead explicitly requested a call',summary:'Review the lead history and send the booking link manually. No meeting is confirmed.',sourceIds:[latest.id]};
  if(latest?.direction==='inbound')return {action:'draft',draft:{kind:'reply_email',intent:'question',subject:'Re: Confidential introductory conversation',body:'Thanks for the question. We can discuss the acquisition interest and your preferred next step in a confidential conversation.',rationale:'Answer the current question without inventing buyer credentials or sharing private criteria',sourceIds:[latest.id]}};
  if(latest)return {action:'wait',reminder:{wakeAt:new Date(Date.now()+3*86400000).toISOString(),timeZone:'Australia/Sydney',reason:'Give the lead time to respond'},sourceIds:[latest.id]};
  return {action:'draft',draft:{kind:'initial_email',intent:'initial',subject:'Confidential introductory conversation',body:'Would you be open to a confidential conversation about your business?',rationale:'Progress the saved acquisition goal',sourceIds:['mandate:'+mandate]}};
 }
 async function drain(){
  const outcomes:string[]=[];
  for(let n=0;n<60;n++){
   const store=fresh(),handlers=createNativeAgentHandlers({store,supervise:createResearchSupervisor(store,{reuseCached:reuseCachedMandateTargets(store)}),targetApproved:async input=>{
    const {reviewBatchId}=input.event.payload as {reviewBatchId:string};for(const op of await store.reviewDispatchTargets(thread,reviewBatchId)){await input.assertCurrent();await store.allocateApprovedTargets(thread,op.id,fence(input));}return {kind:'complete'};
   },decide:args=>async context=>{
    const started=await store.beginNativeModel(thread,args.requestKey,{...nativeModelSpecification,conversationId:context.conversationId,contextRevision:context.contextRevision},args.authority);if(started.kind==='cached')return started.response;
    const response=decision(context);await store.finishNativeModel(thread,started.operationId,started.fence,{model:nativeModelSpecification.model,usage:{inputTokens:100,outputTokens:40,cachedInputTokens:0,reasoningTokens:0},response});return response;
   }});
   const outcome=await runAgentEvent({store,workerId:randomUUID(),handlers});if(outcome==='idle')return outcomes;outcomes.push(outcome);expect(['complete','review']).toContain(outcome);
  }throw Error('Synthetic journey exceeded bounded worker ticks');
 }
 async function pending(name:string){const batch=(await fresh().listReviewBatches(thread)).find(b=>b.state==='pending'&&!b.stale&&b.operations.some((o:{name:string})=>o.name===name));expect(batch).toBeDefined();return batch!;}
 async function approve(name:string){const b=await pending(name);await fresh().decideReviewBatch(thread,b.id,b.revision,b.manifest,'approved');await drain();return b;}
 async function incoming(id:string,text:string){const row=await fresh().conversation(thread,conversationId),now=new Date().toISOString();await fresh().ingestHistory(thread,conversationId,{source:'local_fixture',observedAt:now,complete:true,messages:[...row.history,{id,direction:'inbound',text,at:now}]});await drain();}
 const sends=async()=>(await pool.query('SELECT count(*)::int AS n FROM agent_sink_messages WHERE organization_id=$1',[org])).rows[0].n;

 it('creates once, reuses cached contacts, survives approval races, answers a question, and records handoff/link/meeting as separate facts',async()=>{
  const created=await createNativeAgentMandate(pool,actor,creation);expect(await createNativeAgentMandate(pool,actor,creation)).toMatchObject({id:mandate,revision:created.revision,replayed:true});await cachedFixtures();const pins=await originalPins();thread=(await fresh().openThread(mandate)).id;await limits();const startKey=randomUUID(),start={action:'start',expectedRevision:0,mandateRevision:created.revision};const started=await fresh().controlResponsibility(thread,startKey,start);expect(await fresh().controlResponsibility(thread,startKey,start)).toEqual(started);await drain();
  expect((await fresh().messages(thread)).some(m=>m.content?.text?.includes('already has cached email contacts'))).toBe(true);expect((await pool.query('SELECT count(*)::int AS n FROM research_jobs WHERE organization_id=$1',[org])).rows[0].n).toBe(0);expect(await sends()).toBe(0);
  const selection=await fresh().proposeTargetSelection(thread,randomUUID(),{mode:'local_sink'}),targetReview=await pending('target.select');expect(targetReview.operations[0].input.selected.map((c:{contactId:string})=>c.contactId)).toEqual([contact]);await expect(fresh().allocateApprovedTargets(thread,selection.id)).rejects.toThrow(/Approved/);await approve('target.select');const conversations=(await fresh().executionState(thread)).conversations;expect(conversations).toHaveLength(1);conversationId=conversations[0].id;expect(conversations[0].delivery_mode).toBe('local_sink');
  // A human approval is not a licence to send after supervision pauses.
  const first=await pending('email.initial');await fresh().decideReviewBatch(thread,first.id,first.revision,first.manifest,'approved');let control=await fresh().executionState(thread);await fresh().controlResponsibility(thread,randomUUID(),{action:'pause',expectedRevision:control.responsibility.revision,mandateRevision:control.mandateRevision});await drain();expect(await sends()).toBe(0);
  control=await fresh().executionState(thread);await fresh().controlResponsibility(thread,randomUUID(),{action:'resume',expectedRevision:control.responsibility.revision,mandateRevision:control.mandateRevision});let current=await fresh().conversation(thread,conversationId);await fresh().enqueueEvent(thread,randomUUID(),'conversation.reassess',{conversationId,epoch:Number(current.epoch),reminderGeneration:current.reminder_generation});await drain();expect(await sends()).toBe(0);await approve('email.initial');expect(await sends()).toBe(1);
  await incoming('lead-question','Who is buying, and what would the next step involve?');const staleReply=await pending('email.reply');expect(await sends()).toBe(1);
  // New inbound history invalidates the exact reply batch before approval.
  await incoming('lead-clarification','Please clarify what information you need first.');await expect(fresh().decideReviewBatch(thread,staleReply.id,staleReply.revision,staleReply.manifest,'approved')).rejects.toThrow(/invalidated/i);expect((await pool.query('SELECT state FROM agent_review_batches WHERE id=$1',[staleReply.id])).rows[0].state).toBe('invalidated');expect(await sends()).toBe(1);await approve('email.reply');expect(await sends()).toBe(2);
  await incoming('lead-ready','Yes, can we arrange a call?');let task=(await fresh().handoffInbox(mandate)).tasks[0];expect(task.state).toBe('pending');current=await fresh().conversation(thread,conversationId);expect(current).toMatchObject({driver_kind:'human',phase:'paused',engagement:'handoff',next_wakeup_at:null});expect((await fresh().messages(thread)).some(m=>/send the booking link/i.test(m.content?.text??''))).toBe(true);expect(await sends()).toBe(2);
  const proof={note:'Human sent the booking link manually using the original account',externalReference:'synthetic-manual-link:'+task.id,occurredAt:new Date().toISOString()};await fresh().controlHandoff(mandate,randomUUID(),{taskId:task.id,revision:task.revision,contextRevision:task.context_revision,action:'acknowledge'});task=(await fresh().handoffInbox(mandate)).tasks[0];await fresh().controlHandoff(mandate,randomUUID(),{taskId:task.id,revision:task.revision,contextRevision:task.context_revision,action:'link_sent',evidence:proof});task=(await fresh().handoffInbox(mandate)).tasks[0];expect(task.state).toBe('link_sent');expect(task.state).not.toBe('meeting_confirmed');await fresh().controlHandoff(mandate,randomUUID(),{taskId:task.id,revision:task.revision,contextRevision:task.context_revision,action:'meeting_confirmed',evidence:{...proof,note:'Human verified the lead confirmed a call time',externalReference:'synthetic-meeting:'+task.id}});task=(await fresh().handoffInbox(mandate)).tasks[0];expect(task.state).toBe('meeting_confirmed');await drain();expect(await sends()).toBe(2);
  expect(await originalPins()).toEqual(pins);expect(network).not.toHaveBeenCalled();expect((await pool.query("SELECT count(*)::int AS n FROM agent_operations WHERE organization_id=$1 AND name='conversation.decide' AND state='complete'",[org])).rows[0].n).toBeGreaterThanOrEqual(5);expect((await pool.query('SELECT sum(spent)::text AS used FROM agent_budget_accounts WHERE organization_id=$1 AND unit=\'sends\'',[org])).rows[0].used).toBe('6');expect((await fresh().conversation(thread,conversationId)).driver_kind).toBe('human');
 });
});
