import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentLifecycleStore} from './agent-lifecycle-store';
import {AgentOutreachStore} from './agent-outreach-store';
import {reassessAgentConversation,type AgentConversationContext} from '@/lib/agent-conversation-engine';
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentLifecycleStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('native conversation controls (migration0006 required)',()=>{
 beforeAll(async()=>{
  const identity=(await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
  expect(identity).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic conversation test','{}','{}',$3)",[mandate,org,user]);
  await c.query('COMMIT');}finally{c.release();}
  store=new AgentLifecycleStore(pool,actor);thread=(await store.openThread(mandate)).id;
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
 it('starts supervision with a durable wakeup, then pauses without affecting structured sequences',async()=>{
  const state=await store.executionState(thread),request=randomUUID();
  const started=await store.controlResponsibility(thread,request,{action:'start',expectedRevision:0,mandateRevision:state.mandateRevision});expect(started.status).toBe('ready');
  expect((await store.controlResponsibility(thread,request,{action:'start',expectedRevision:0,mandateRevision:state.mandateRevision})).id).toBe(started.id);
  const paused=await store.controlResponsibility(thread,randomUUID(),{action:'pause',expectedRevision:started.revision,mandateRevision:state.mandateRevision});expect(paused.status).toBe('paused');
 });
 it('claims canonical identities once across duplicate contact records',async()=>{
  await start();const a=await contact(),b=await contact();
  const opened=await store.openConversation(thread,randomUUID(),{contactId:a,deliveryMode:'local_sink'});expect(opened.status).toBe('active');
  await expect(store.openConversation(thread,randomUUID(),{contactId:b,deliveryMode:'local_sink'})).rejects.toThrow();
  expect((await store.executionState(thread)).conversations).toHaveLength(1);
 });
 it('persists history and a future reminder, and ignores a stale observation by holding execution',async()=>{
  const opened=await store.openConversation(thread,randomUUID(),{contactId:await contact(randomUUID()+'@example.invalid'),deliveryMode:'local_sink'});
  const instant=new Date().toISOString();
  await store.ingestHistory(thread,opened.id,{source:'local_fixture',observedAt:instant,complete:true,messages:[]});
  const row=await store.conversation(thread,opened.id),wakeAt=new Date(Date.now()+3600000).toISOString();
  const reminded=await store.scheduleConversation(thread,randomUUID(),{conversationId:row.id,revision:row.revision,contextRevision:row.context_revision,reminder:{wakeAt,timeZone:'Australia/Melbourne',reason:'Check whether a reply arrived'}});
  expect(reminded.status).toBe('scheduled');
  expect((await store.conversation(thread,row.id)).next_wakeup_at.toISOString()).toBe(wakeAt);
  const held=await store.ingestHistory(thread,row.id,{source:'local_fixture',observedAt:new Date(Date.parse(instant)-1000).toISOString(),complete:true,messages:[]});
  expect(held.status).toBe('held');expect((await store.conversation(thread,row.id)).next_wakeup_at).toBeNull();
 });
 it('creates one persisted human task and chat handoff, pauses follow-ups and does not claim a meeting',async()=>{
  const opened=await store.openConversation(thread,randomUUID(),{contactId:await contact(randomUUID()+'@example.invalid'),deliveryMode:'local_sink'});
  const instant=new Date().toISOString();
  await store.ingestHistory(thread,opened.id,{source:'local_fixture',observedAt:instant,complete:true,messages:[{id:'call-ready',direction:'inbound',text:'Can we arrange a call?',at:instant}]});
  const row=await store.conversation(thread,opened.id),key=randomUUID();
  const input={conversationId:row.id,revision:row.revision,contextRevision:row.context_revision,reason:'The lead asked to speak',summary:'Please review the call request and send the booking link'};
  const task=await store.handoffConversation(thread,key,input);expect(await store.handoffConversation(thread,key,input)).toEqual(task);
  const tasks=await store.listHandoffs(thread);expect(tasks.filter(t=>t.conversation_id===row.id)).toHaveLength(1);
  expect(tasks.find(t=>t.id===task.id).state).toBe('pending');
  expect(await store.conversation(thread,row.id)).toMatchObject({phase:'paused',driver_kind:'human',engagement:'handoff',next_wakeup_at:null});
  expect((await store.messages(thread)).some(m=>m.content?.details?.taskId===task.id)).toBe(true);
  const latest=new Date().toISOString();await store.ingestHistory(thread,row.id,{source:'local_fixture',observedAt:latest,complete:true,messages:[...row.history,{id:'still-ready',direction:'inbound',text:'Tomorrow works too',at:latest}]});
  expect(await store.conversation(thread,row.id)).toMatchObject({phase:'paused',driver_kind:'human',engagement:'handoff'});
  expect((await pool.query('SELECT count(*)::int AS count FROM agent_sink_messages WHERE organization_id=$1',[org])).rows[0].count).toBe(0);
 });
 it('stops explicit opt-outs without a model or outbound proposal',async()=>{
  const opened=await store.openConversation(thread,randomUUID(),{contactId:await contact(randomUUID()+'@example.invalid'),deliveryMode:'local_sink'});
  const instant=new Date().toISOString();
  await store.ingestHistory(thread,opened.id,{source:'local_fixture',observedAt:instant,complete:true,messages:[{id:'stop',direction:'inbound',text:'Please unsubscribe me',at:instant}]});
  expect(await store.conversation(thread,opened.id)).toMatchObject({phase:'complete',engagement:'stopped'});
 });

 it('wakes only explicitly resumed supervisor-paused people with fresh context and no duplicate discovery or authority',async()=>{
  await start();const controls=new AgentOutreachStore(pool,actor),people=[] as string[];
  for(let i=0;i<5;i++){const id=(await controls.openConversation(thread,randomUUID(),{contactId:await contact(randomUUID()+'@example.invalid'),deliveryMode:'local_sink'})).id;people.push(id);await controls.ingestHistory(thread,id,{source:'local_fixture',observedAt:new Date().toISOString(),complete:true,messages:[]});}
  const [a,held,human,stopped,unknown]=people,initial=await controls.conversation(thread,a),proposal=await controls.proposeNativeEmail(thread,randomUUID(),{conversationId:a,revision:initial.revision,contextRevision:initial.context_revision,draft:{kind:'initial_email',intent:'initial',subject:'Synthetic pending draft',body:'A pending draft must not retain authority after resume.',rationale:'Synthetic review fixture',sourceIds:[]}}),state=await controls.executionState(thread),grant=await controls.createConversationGrant(thread,randomUUID(),{mandateRevision:state.mandateRevision,conversationIds:[a],actions:['reply_email'],maxSends:1,expiresAt:new Date(Date.now()+3600000).toISOString()});
  await controls.ingestHistory(thread,held,{source:'local_fixture',observedAt:new Date(Date.now()-60000).toISOString(),complete:true,messages:[]});
  const humanAt=new Date().toISOString();await controls.ingestHistory(thread,human,{source:'local_fixture',observedAt:humanAt,complete:true,messages:[{id:'call-'+human,direction:'inbound',text:'Can we arrange a call?',at:humanAt}]});const h=await controls.conversation(thread,human);await controls.handoffConversation(thread,randomUUID(),{conversationId:human,revision:h.revision,contextRevision:h.context_revision,reason:'Human must arrange the booking',summary:'Please review this synthetic call request.'});
  await controls.ingestHistory(thread,stopped,{source:'local_fixture',observedAt:new Date().toISOString(),complete:true,messages:[{id:'stop-'+stopped,direction:'inbound',text:'Please unsubscribe me',at:new Date().toISOString()}]});
  const uncertain=randomUUID(),c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query("INSERT INTO agent_operations(id,thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state,conversation_id)VALUES($1::uuid,$2,$3,$4,$5,$1::text,'email.reply','{}',$6,'uncertain',$7)",[uncertain,thread,org,mandate,user,'d'.repeat(64),unknown]);await c.query('COMMIT');}finally{c.release();}
  const prior=await controls.executionState(thread);await controls.controlResponsibility(thread,randomUUID(),{action:'pause',expectedRevision:prior.responsibility.revision,mandateRevision:prior.mandateRevision});
  const paused=await controls.executionState(thread),protectedBefore=await Promise.all([held,human,stopped,unknown].map(id=>controls.conversation(thread,id))),beforeA=await controls.conversation(thread,a),superviseBefore=Number((await pool.query("SELECT count(*)::int n FROM agent_events WHERE thread_id=$1 AND kind='mandate.supervise'",[thread])).rows[0].n),key=randomUUID(),input={action:'resume',expectedRevision:paused.responsibility.revision,mandateRevision:paused.mandateRevision};
  const resumed=await controls.controlResponsibility(thread,key,input),afterA=await controls.conversation(thread,a);expect(afterA).toMatchObject({phase:'active',pause_reason:null});expect(Number(afterA.epoch)).toBe(Number(beforeA.epoch)+1);expect(afterA.reminder_generation).toBe(beforeA.reminder_generation+1);expect(afterA.next_wakeup_at).toBeNull();
  const wakes=(await pool.query("SELECT event_key,payload FROM agent_events WHERE thread_id=$1 AND kind='conversation.reassess' AND event_key LIKE 'supervisor-resumed:%' AND payload->>'conversationId'=$2",[thread,a])).rows;expect(wakes).toHaveLength(1);expect(wakes[0].payload).toEqual({conversationId:a,epoch:Number(afterA.epoch),reminderGeneration:afterA.reminder_generation});
  for(const [i,id]of [held,human,stopped,unknown].entries())expect(await controls.conversation(thread,id)).toEqual(protectedBefore[i]);
  expect((await pool.query('SELECT state FROM agent_operations WHERE id=$1',[uncertain])).rows[0].state).toBe('uncertain');expect((await pool.query('SELECT state FROM agent_operations WHERE id=$1',[proposal.id])).rows[0].state).toBe('failed');expect((await pool.query('SELECT revoked_at FROM agent_authority_grants WHERE id=$1',[grant.id])).rows[0].revoked_at).not.toBeNull();
  expect(Number((await pool.query("SELECT count(*)::int n FROM agent_events WHERE thread_id=$1 AND kind='mandate.supervise'",[thread])).rows[0].n)).toBe(superviseBefore);
  expect(await controls.controlResponsibility(thread,key,input)).toEqual(resumed);expect((await pool.query("SELECT count(*)::int n FROM agent_events WHERE thread_id=$1 AND kind='conversation.reassess' AND event_key LIKE 'supervisor-resumed:%' AND payload->>'conversationId'=$2",[thread,a])).rows[0].n).toBe(1);
 });

 it('persists a latency-adjusted wait through the unchanged strict database future guard and current context',async()=>{
  await start();const id=(await store.openConversation(thread,randomUUID(),{contactId:await contact(randomUUID()+'@example.invalid'),deliveryMode:'local_sink'})).id;await store.ingestHistory(thread,id,{source:'local_fixture',observedAt:new Date().toISOString(),complete:true,messages:[]});const current=await store.conversation(thread,id),context:AgentConversationContext={conversationId:id,epoch:Number(current.epoch),reminderGeneration:current.reminder_generation,revision:current.revision,contextRevision:current.context_revision,phase:'active',driver:'agent',supervisionActive:true,deliveryMode:'local_sink',historyComplete:true,historyObservedAt:current.history_observed_at.toISOString(),goal:'A synthetic acquisition goal',history:[],sources:[],guidance:[]};let requested='';
  const result=await reassessAgentConversation({load:async()=>context,now:()=>new Date().toISOString(),decide:async()=>{requested=new Date(Date.now()+10).toISOString();const response={action:'wait',reminder:{wakeAt:requested,timeZone:'UTC',reason:'Wait for a future conversation update.'},sourceIds:[]};await new Promise(resolve=>setTimeout(resolve,40));return response;},commit:async(c,d,key)=>{if(d.action!=='wait')throw Error('Only synthetic wait allowed');return store.scheduleConversation(thread,key,{conversationId:c.conversationId,revision:c.revision,contextRevision:c.contextRevision,reminder:d.reminder});}},{conversationId:id,epoch:Number(current.epoch),reminderGeneration:current.reminder_generation,requestKey:randomUUID()});
  expect(result).toEqual({kind:'complete'});const saved=await store.conversation(thread,id);expect(saved.phase).toBe('active');expect(saved.next_wakeup_at.getTime()-Date.now()).toBeGreaterThan(29000);expect(saved.wakeup_reason).toContain(requested);expect(saved.wakeup_reason.length).toBeLessThanOrEqual(2000);expect((await pool.query("SELECT payload,available_at FROM agent_events WHERE thread_id=$1 AND kind='conversation.reminder' AND payload->>'conversationId'=$2",[thread,id])).rows).toEqual([{payload:{conversationId:id,epoch:Number(saved.epoch),reminderGeneration:saved.reminder_generation},available_at:saved.next_wakeup_at}]);
 });

});
