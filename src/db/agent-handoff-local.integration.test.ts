import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentHandoffStore} from './agent-handoff-store';
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentHandoffStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID(),assignee=randomUUID(),outsider=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('human handoff tasks (migration0011 required)',()=>{
 beforeAll(async()=>{
  const identity=(await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
  expect(identity).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  for(const extra of [assignee,outsider])await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[extra,extra+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  for(const extra of [assignee,outsider])await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'member')",[randomUUID(),org,extra]);
  await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic conversation test','{}','{}',$3)",[mandate,org,user]);
  await c.query('COMMIT');}finally{c.release();}
  store=new AgentHandoffStore(pool,actor);thread=(await store.openThread(mandate)).id;
 });
 afterAll(async()=>{
  // Delete only this suite's synthetic tenant; never use a pilot user's thread.
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const table of ['agent_sink_messages','agent_authority_uses','agent_handoffs','agent_person_claims','agent_budget_reservations','agent_budget_accounts','agent_review_batches','agent_authority_grants','agent_operations','agent_conversations','agent_responsibilities','agent_runs','agent_events','agent_messages','agent_threads','contacts','mandates','member','audit_events','communication_send_gates'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
  await c.query('DELETE FROM organization WHERE id=$1',[org]);
  await c.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[[user,assignee,outsider]]);
  await c.query('COMMIT');}finally{c.release();}
  await pool.end();
 });

 async function start(){const state=await store.executionState(thread);return store.controlResponsibility(thread,randomUUID(),{action:'start',expectedRevision:state.responsibility?.revision??0,mandateRevision:state.mandateRevision});}
 async function contact(email='owner@example.invalid'){
  const id=randomUUID(),c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query("INSERT INTO contacts(id,organization_id,mandate_id,display_name,personal_data,provenance,fictionalised) VALUES($1,$2,$3,'Synthetic owner',$4,'{}',false)",[id,org,mandate,JSON.stringify({email})]);await c.query('COMMIT');}finally{c.release();}return id;
 }
 async function task(){
  await start();const opened=await store.openConversation(thread,randomUUID(),{contactId:await contact(randomUUID()+'@example.invalid'),deliveryMode:'local_sink'});
  const instant=new Date().toISOString();await store.ingestHistory(thread,opened.id,{source:'local_fixture',observedAt:instant,complete:true,messages:[{id:randomUUID(),direction:'inbound',text:'Can we arrange a call?',at:instant}]});
  const row=await store.conversation(thread,opened.id);await store.handoffConversation(thread,randomUUID(),{conversationId:row.id,revision:row.revision,contextRevision:row.context_revision,reason:'Lead requested call',summary:'Human to send booking link'});
  return (await store.handoffInbox(mandate)).tasks.find(t=>t.context.recipient===row.recipient_email)!;
 }
 const proof={note:'Sent manually through owned email account',externalReference:'manual-email:synthetic-001',occurredAt:new Date().toISOString()};
 it('records acknowledgement, external link and confirmed meeting as separate audited facts without sending or resuming',async()=>{
  let current=await task();const key=randomUUID(),input={taskId:current.id,revision:current.revision,contextRevision:current.context_revision,action:'acknowledge'};
  const ack=await store.controlHandoff(mandate,key,input);expect(await store.controlHandoff(mandate,key,input)).toEqual(ack);
  await expect(store.controlHandoff(mandate,key,{...input,action:'dismiss',reason:'Changed replay must be denied'})).rejects.toThrow('key reused');
  current=(await store.handoffInbox(mandate)).tasks.find(t=>t.id===current.id)!;expect(current.state).toBe('acknowledged');
  await expect(store.controlHandoff(mandate,randomUUID(),{taskId:current.id,revision:current.revision,contextRevision:current.context_revision,action:'meeting_confirmed',evidence:proof})).rejects.toThrow();
  await store.controlHandoff(mandate,randomUUID(),{taskId:current.id,revision:current.revision,contextRevision:current.context_revision,action:'link_sent',evidence:proof});
  current=(await store.handoffInbox(mandate)).tasks.find(t=>t.id===current.id)!;expect(current.state).toBe('link_sent');
  await store.controlHandoff(mandate,randomUUID(),{taskId:current.id,revision:current.revision,contextRevision:current.context_revision,action:'meeting_confirmed',evidence:{...proof,note:'Lead confirmed call time by email',externalReference:'confirmation:synthetic-002'}});
  current=(await store.handoffInbox(mandate)).tasks.find(t=>t.id===current.id)!;expect(current.state).toBe('meeting_confirmed');
  expect((current.human_evidence as {events:unknown[]}).events).toHaveLength(3);
  const conv=(await pool.query('SELECT phase,driver_kind,next_wakeup_at FROM agent_conversations WHERE id=(SELECT conversation_id FROM agent_handoffs WHERE id=$1)',[current.id])).rows[0];expect(conv).toEqual({phase:'paused',driver_kind:'human',next_wakeup_at:null});
  expect((await pool.query('SELECT count(*)::int AS count FROM agent_sink_messages WHERE organization_id=$1',[org])).rows[0].count).toBe(0);
 });
 it('reassigns only to a current member, exposes a bounded assignee inbox without owner thread access, and audits assignee actions',async()=>{
  let current=await task();const otherStore=new AgentHandoffStore(pool,{organizationId:org,userId:assignee}),outsiderStore=new AgentHandoffStore(pool,{organizationId:org,userId:outsider});
  expect((await otherStore.handoffInbox(mandate)).tasks).toHaveLength(0);expect((await outsiderStore.handoffInbox(mandate)).tasks).toHaveLength(0);
  const base={taskId:current.id,revision:current.revision,contextRevision:current.context_revision};
  await expect(store.controlHandoff(mandate,randomUUID(),{...base,action:'reassign',assigneeUserId:'not-a-member'})).rejects.toThrow();
  await store.controlHandoff(mandate,randomUUID(),{...base,action:'reassign',assigneeUserId:assignee});
  current=(await otherStore.handoffInbox(mandate)).tasks.find(t=>t.id===current.id)!;expect(current.can_reassign).toBe(false);expect(current.context.summary).toContain('Human');
  await expect(otherStore.messages(thread)).rejects.toThrow('thread not found');
  await expect(outsiderStore.controlHandoff(mandate,randomUUID(),{...base,action:'acknowledge'})).rejects.toThrow();
  const command={taskId:current.id,revision:current.revision,contextRevision:current.context_revision};
  await expect(otherStore.controlHandoff(mandate,randomUUID(),{...command,action:'reassign',assigneeUserId:outsider})).rejects.toThrow();
  await otherStore.controlHandoff(mandate,randomUUID(),{...command,action:'acknowledge'});
  expect((await store.handoffInbox(mandate)).tasks.find(t=>t.id===current.id)?.state).toBe('acknowledged');
  expect((await store.messages(thread)).some(m=>m.content?.details?.actorId===assignee)).toBe(true);
  // Current membership is rechecked even for an existing assignment.
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query('DELETE FROM member WHERE organization_id=$1 AND user_id=$2',[org,assignee]);await c.query('COMMIT');}finally{c.release();}
  await expect(otherStore.handoffInbox(mandate)).rejects.toThrow();
 });
 it('invalidates old task-context decisions after a new lead reply and records dismissal without restarting automation',async()=>{
  const current=await task(),conv=(await pool.query('SELECT * FROM agent_conversations WHERE id=(SELECT conversation_id FROM agent_handoffs WHERE id=$1)',[current.id])).rows[0],instant=new Date().toISOString();
  await store.ingestHistory(thread,conv.id,{source:'local_fixture',complete:true,observedAt:instant,messages:[...conv.history,{id:randomUUID(),direction:'inbound',text:'Please send tomorrow instead',at:instant}]});
  await expect(store.controlHandoff(mandate,randomUUID(),{taskId:current.id,revision:current.revision,contextRevision:current.context_revision,action:'acknowledge'})).rejects.toThrow('changed');
  const latest=(await store.handoffInbox(mandate)).tasks.find(t=>t.id===current.id)!;await store.controlHandoff(mandate,randomUUID(),{taskId:latest.id,revision:latest.revision,contextRevision:latest.context_revision,action:'dismiss',reason:'Human has taken over externally'});
  expect((await store.conversation(thread,conv.id)).phase).toBe('paused');
 });
 it('bounds repeated human evidence growth and keeps the original state on rejection',async()=>{
  const current=await task();const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query("UPDATE agent_handoffs SET human_evidence=$2,revision=revision+1 WHERE id=$1",[current.id,JSON.stringify({events:Array(100).fill({action:'fixture'})})]);await c.query('COMMIT');}finally{c.release();}
  const latest=(await store.handoffInbox(mandate)).tasks.find(t=>t.id===current.id)!;
  await expect(store.controlHandoff(mandate,randomUUID(),{taskId:latest.id,revision:latest.revision,contextRevision:latest.context_revision,action:'acknowledge'})).rejects.toThrow('evidence limit');
  expect((await store.handoffInbox(mandate)).tasks.find(t=>t.id===current.id)?.state).toBe('pending');
 });
 it('allows one concurrent decision and rejects stale source context, future evidence and changed replay payload',async()=>{
  const current=await task(),input={taskId:current.id,revision:current.revision,contextRevision:current.context_revision,action:'acknowledge'},key=randomUUID();
  const results=await Promise.allSettled([store.controlHandoff(mandate,key,input),store.controlHandoff(mandate,randomUUID(),{...input,action:'dismiss',reason:'Human will handle externally'})]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const another=await task();await expect(store.controlHandoff(mandate,randomUUID(),{taskId:another.id,revision:another.revision,contextRevision:'a'.repeat(64),action:'acknowledge'})).rejects.toThrow();
  await expect(store.controlHandoff(mandate,randomUUID(),{taskId:another.id,revision:another.revision,contextRevision:another.context_revision,action:'link_sent',evidence:{...proof,occurredAt:new Date(Date.now()+3600000).toISOString()}})).rejects.toThrow('future');
 });
 it('schedules an internal task reminder without an outbound send or changed conversation ownership',async()=>{
  const current=await task(),wakeAt=new Date(Date.now()+3600000).toISOString();
  const scheduled=await store.controlHandoff(mandate,randomUUID(),{taskId:current.id,revision:current.revision,contextRevision:current.context_revision,action:'remind',reminder:{wakeAt,timeZone:'Australia/Melbourne',reason:'Review the lead response and send link manually'}});
  const due=(await pool.query("SELECT * FROM agent_events WHERE organization_id=$1 AND kind='human.handoff_reminder' AND payload->>'taskId'=$2",[org,current.id])).rows;
  expect(due).toHaveLength(1);expect(due[0].available_at.toISOString()).toBe(wakeAt);expect(due[0].payload).toMatchObject({taskId:current.id,revision:scheduled.revision,assigneeUserId:user});
  expect((await pool.query('SELECT driver_kind,phase,next_wakeup_at FROM agent_conversations WHERE id=(SELECT conversation_id FROM agent_handoffs WHERE id=$1)',[current.id])).rows[0]).toEqual({driver_kind:'human',phase:'paused',next_wakeup_at:null});
 });

 async function dueReminder(current:Awaited<ReturnType<typeof task>>){
  const wakeAt=new Date(Date.now()+3600000).toISOString();await store.controlHandoff(mandate,randomUUID(),{taskId:current.id,revision:current.revision,contextRevision:current.context_revision,action:'remind',reminder:{wakeAt,timeZone:'Australia/Melbourne',reason:'Human to review this task'}});
  const id=(await pool.query("SELECT id FROM agent_events WHERE organization_id=$1 AND kind='human.handoff_reminder' AND payload->>'taskId'=$2 ORDER BY created_at DESC LIMIT 1",[org,current.id])).rows[0].id;
  // Accelerate only our synthetic timer; all other fixture events are audited no-ops.
  await pool.query("UPDATE agent_events SET state=CASE WHEN id=$2 THEN 'pending' ELSE 'done' END,available_at=CASE WHEN id=$2 THEN now()-interval '1 second' ELSE available_at END WHERE organization_id=$1",[org,id]);
  const restarted=new AgentHandoffStore(pool,actor),event=await restarted.claimEvent(randomUUID()),run=await restarted.beginEventRun(event!);expect(run.kind).toBe('started');if(run.kind!=='started')throw new Error('Expected active event');
  return {restarted,event:event!,run,authority:{eventId:event!.id,runId:run.runId,leaseOwner:event!.lease_owner,fence:event!.fence}};
 }
 it('fires a persisted internal reminder once after restart and never wakes the contact or resumes automation',async()=>{
  const current=await task(),{restarted,event,run,authority}=await dueReminder(current),key='reminder:'+event.id;
  const result=await restarted.fireHandoffReminder(thread,key,event.payload,authority);expect(result.status).toBe('notified');expect(await restarted.fireHandoffReminder(thread,key,event.payload,authority)).toEqual(result);
  expect(await restarted.finishEventRun(run.runId,event,{kind:'complete'})).toBe(true);
  expect((await pool.query("SELECT count(*)::int AS count FROM agent_messages WHERE organization_id=$1 AND content->>'text' LIKE 'Human handoff reminder:%' AND content->'details'->>'taskId'=$2",[org,current.id])).rows[0].count).toBe(1);
  const conv=(await pool.query('SELECT phase,driver_kind,next_wakeup_at FROM agent_conversations WHERE id=(SELECT conversation_id FROM agent_handoffs WHERE id=$1)',[current.id])).rows[0];expect(conv).toEqual({phase:'paused',driver_kind:'human',next_wakeup_at:null});
 });
 it('ignores a task reminder superseded by human acknowledgement',async()=>{
  const current=await task(),{restarted,event,run,authority}=await dueReminder(current),latest=(await store.handoffInbox(mandate)).tasks.find(t=>t.id===current.id)!;
  await store.controlHandoff(mandate,randomUUID(),{taskId:latest.id,revision:latest.revision,contextRevision:latest.context_revision,action:'acknowledge'});
  expect((await restarted.fireHandoffReminder(thread,'reminder:'+event.id,event.payload,authority)).status).toBe('superseded');
  expect(await restarted.finishEventRun(run.runId,event,{kind:'complete'})).toBe(true);
 });

 it('binds handoff correction feedback to the exact human task and context without resuming outreach',async()=>{
  const current=await task(),input={source:{kind:'handoff' as const,id:current.id,revision:current.revision,contextRevision:current.context_revision},reason:'The lead asked a question, rather than requesting a call.',preference:'Answer open questions before proposing a call.',category:'follow_up' as const};
  await expect(store.captureFeedback(thread,randomUUID(),{...input,source:{...input.source,contextRevision:'0'.repeat(64)}})).rejects.toThrow('changed');
  const candidate=await store.captureFeedback(thread,randomUUID(),input);
  expect(candidate.state).toBe('proposed');expect(candidate.input.sourceEntity).toMatchObject({kind:'handoff',id:current.id,revision:current.revision});
  const unchanged=(await store.handoffInbox(mandate)).tasks.find(t=>t.id===current.id)!;expect(unchanged.state).toBe(current.state);
  const conv=(await pool.query('SELECT phase,driver_kind,next_wakeup_at FROM agent_conversations WHERE id=(SELECT conversation_id FROM agent_handoffs WHERE id=$1)',[current.id])).rows[0];expect(conv).toEqual({phase:'paused',driver_kind:'human',next_wakeup_at:null});
 });

});
