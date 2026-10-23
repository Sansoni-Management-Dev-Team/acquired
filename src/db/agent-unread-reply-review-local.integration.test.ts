import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {AgentChannelStore} from './agent-channel-store';
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true',pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
const org=randomUUID(),user=randomUUID(),mandate=randomUUID(),contact=randomUUID(),bindings={email:randomUUID(),whatsapp:randomUUID(),linkedin:randomUUID()};
const actor={organizationId:org,userId:user},store=new AgentChannelStore(pool,actor);let thread:string,conversation:string;
describe.runIf(enabled)('explicit current-context conversation review controls',()=>{
 beforeAll(async()=>{expect((await pool.query("SELECT current_database() name,shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic route foundation fixture','{}','{}',$3)",[mandate,org,user]);await c.query("INSERT INTO contacts(id,organization_id,mandate_id,display_name,personal_data,provenance,fictionalised) VALUES($1,$2,$3,'Synthetic owner',$4,'{}',false)",[contact,org,mandate,JSON.stringify({email:'owner@example.invalid',phone:'+61412345678',linkedinUrl:'https://www.linkedin.com/in/synthetic-owner'})]);for(const channel of ['email','whatsapp','linkedin'] as const)await c.query("INSERT INTO communication_bindings(id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority) VALUES($1,$2,$3,$4,$5,1,$6,$7,'unipile','service')",[bindings[channel],org,user,randomUUID(),randomUUID(),channel,channel==='email'?'gmail':channel]);await c.query('COMMIT');}finally{c.release();}thread=(await store.openThread(mandate)).id;const state=await store.executionState(thread);await store.controlResponsibility(thread,randomUUID(),{action:'start',expectedRevision:0,mandateRevision:state.mandateRevision});conversation=(await store.openConversation(thread,randomUUID(),{contactId:contact,deliveryMode:'communications',bindingId:bindings.email})).id;});
 afterAll(async()=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");for(const table of ['communication_event_receipts','campaign_reply_receipts','campaign_inbound_events','campaign_reply_holds','campaign_contact_holds','agent_runtime_registrations','agent_conversation_channels','agent_channel_policies','agent_authority_uses','agent_handoffs','agent_person_claims','agent_budget_reservations','agent_budget_accounts','agent_review_batches','agent_authority_grants','agent_operations','agent_conversations','agent_responsibilities','agent_runs','agent_events','agent_messages','agent_threads','communication_bindings','contacts','mandates','member','audit_events','communication_send_gates'])if((await c.query('SELECT to_regclass($1) present',['public.'+table])).rows[0].present)await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);await c.query('DELETE FROM organization WHERE id=$1',[org]);await c.query('DELETE FROM "user" WHERE id=$1',[user]);await c.query('COMMIT');}finally{c.release();await pool.end();}});
 beforeAll(async()=>{
  await store.saveChannelPolicy(thread,randomUUID(),{expectedRevision:0,channelOrder:['email','whatsapp','linkedin'],delaySeconds:86400,bindings:Object.entries(bindings).map(([channel,bindingId])=>({channel,bindingId}))});
  const revision=(await pool.query('SELECT xmin::text revision FROM contacts WHERE id=$1',[contact])).rows[0].revision;
  for(const channel of ['email','whatsapp','linkedin']as const){const current=await store.conversation(thread,conversation);await store.registerConversationChannel(thread,randomUUID(),{conversationId:conversation,revision:current.revision,contextRevision:current.context_revision,bindingId:bindings[channel],channel,recipient:channel==='email'?{kind:'email',value:'owner@example.invalid'}:channel==='whatsapp'?{kind:'phone',value:'+61412345678'}:{kind:'linkedin_profile',value:'https://www.linkedin.com/in/synthetic-owner'},identityProof:{kind:'recorded_contact',revision}});}
  await refresh();
 });
 async function expected(){const r=await store.conversation(thread,conversation);return{conversationId:conversation,revision:r.revision,epoch:Number(r.epoch),contextRevision:r.context_revision};}
 async function seed(sql:string,values:unknown[]=[]){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");const r=await c.query(sql,values);await c.query('COMMIT');return r;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}
 async function refresh(){for(const route of await store.channelRoutes(thread,conversation))await store.ingestChannelHistory(thread,conversation,route.id,{source:'communications',observedAt:new Date().toISOString(),complete:true,messages:[]});}

 let proofAt:string,routeId:string,sourceKey:string,accountIdentity:string,providerHash:string,proposalId:string;const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 async function refreshNoticeDigest(c:import('pg').PoolClient){await c.query("UPDATE agent_messages SET content_digest=encode(sha256(convert_to(jsonb_build_object('role','assistant','content',content)::text,'UTF8')),'hex') WHERE thread_id=$1 AND request_key LIKE 'channel-incoming:%'",[thread]);}
 async function check(patch?:(c:import('pg').PoolClient)=>Promise<unknown>){const c=await pool.connect();try{await c.query('BEGIN');if(patch){await c.query("SET LOCAL session_replication_role='replica'");await patch(c);}await c.query('SET LOCAL ROLE acquire_agent_user');await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);await c.query('SELECT agent_lock_send_gate()');return(await c.query('SELECT public.agent_review_history_holds_clear($1) clear',[conversation])).rows[0].clear;}finally{await c.query('ROLLBACK');c.release();}}
 it('reads a verified same-contact reply hold before native history exists, keeping reassessment blocked and authority revoked',async()=>{
  const route=(await store.channelRoutes(thread,conversation)).find(r=>r.channel==='linkedin')!,email=(await store.channelRoutes(thread,conversation)).find(r=>r.channel==='email')!,current=await expected();routeId=route.id;
  const proposed=await store.proposeNativeMessage(thread,randomUUID(),{conversationId:current.conversationId,revision:current.revision,contextRevision:current.contextRevision,draft:{kind:'initial_email',routeId:email.id,intent:'initial',subject:'Synthetic read guard',body:'An unsent fixture draft.',rationale:'Fixture.',sourceIds:[]}});proposalId=proposed.id;
  const b=(await pool.query('SELECT * FROM communication_bindings WHERE id=$1',[route.bindingId])).rows[0];proofAt=new Date(Date.now()-1000).toISOString();sourceKey='a'.repeat(64);accountIdentity=hash(['communications.account.binding.v1',[b.application_id,b.organization_id,b.owner_user_id,b.service_connection_id,b.service_account_id,b.generation,b.channel,b.platform,b.backend]]);providerHash=hash([org,accountIdentity,sourceKey]);
  // Metadata-only original application ledger fixture. No provider body, send
  // receipt, accepted invitation or synthetic execution permission is asserted.
  await seed("INSERT INTO campaign_reply_receipts(organization_id,owner_user_id,channel,account_identity,provider_event_id,from_identity,received_at)VALUES($1,$2,'linkedin',$3,$4,$5,$6)",[org,user,accountIdentity,sourceKey,route.recipient.value,proofAt]);
  await seed("INSERT INTO campaign_inbound_events(organization_id,owner_user_id,contact_id,channel,provider_event_id,from_identity,received_at)VALUES($1,$2,$3,'linkedin',$4,$5,$6)",[org,user,contact,providerHash+':'+contact,route.recipient.value,proofAt]);
  await seed("INSERT INTO campaign_reply_holds(organization_id,contact_id,channel,provider_event_id,received_at,reason)VALUES($1,$2,'linkedin',$3,$4,'reply_received')",[org,contact,providerHash,proofAt]);
  await seed("INSERT INTO campaign_contact_holds(organization_id,email,reason)VALUES($1,'owner@example.invalid','reply_received')",[org]);
  await seed("INSERT INTO communication_event_receipts(binding_id,service_event_id,organization_id,owner_user_id,event_type,occurred_at,result,payload_fingerprint,fingerprint_version)VALUES($1,'fixture-original',$2,$3,'message',$4,'processed',$5,'acquire.reply.delivery.v1')",[route.bindingId,org,user,proofAt,'b'.repeat(64)]);
  await seed(`WITH notice AS(SELECT jsonb_build_object('text','Verified synthetic incoming fixture.','details',jsonb_build_object('conversationId',$1::uuid,'routeId',$2::uuid,'channel','linkedin','bindingId',$3::uuid,'serviceEventId','fixture-original','providerMessageId','synthetic-unread','occurredAt',$4::timestamptz,'reviewRequired',false,'verifiedReply',true)) content)
   INSERT INTO agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)SELECT $5,$6,$7,$8,'channel-incoming:'||encode(sha256(convert_to(jsonb_build_array($3::uuid,'fixture-original',$9::text,$1::uuid,false)::text,'UTF8')),'hex'),'assistant',content,encode(sha256(convert_to(jsonb_build_object('role','assistant','content',content)::text,'UTF8')),'hex')FROM notice`,[conversation,routeId,route.bindingId,proofAt,thread,org,mandate,user,'b'.repeat(64)]);
  await seed("UPDATE agent_conversations SET history_complete=false,pause_reason='provider_history_changed',engagement='engaged' WHERE id=$1",[conversation]);
  const before=await expected(),key=randomUUID();await expect(store.reassessConversationAfterReview(thread,randomUUID(),{...before,reason:'Attempt before native history is ingested.'})).rejects.toThrow();
  const result=await store.requestConversationReviewHistory(thread,key,before);expect(await store.requestConversationReviewHistory(thread,key,before)).toEqual(result);
  expect(await store.conversation(thread,conversation)).toMatchObject({phase:'held',pause_reason:'human_review_required',history_complete:false});expect((await pool.query('SELECT state FROM agent_operations WHERE id=$1',[proposalId])).rows[0].state).toBe('failed');
  expect((await pool.query("SELECT reason,received_at FROM campaign_reply_holds WHERE contact_id=$1",[contact])).rows[0]).toMatchObject({reason:'reply_received',received_at:new Date(proofAt)});
  expect((await pool.query("SELECT count(*)::int n FROM agent_events WHERE thread_id=$1 AND event_key LIKE 'review-history:%'",[thread])).rows[0].n).toBe(1);expect((await pool.query("SELECT count(*)::int n FROM agent_operations WHERE thread_id=$1 AND name='conversation.decide'",[thread])).rows[0].n).toBe(0);
 });
 it('denies unproved/manual, changed account/route/contact/channel/time/provider hash and substantive outcomes',async()=>{
  expect(await check()).toBe(true);
  const patches:Array<(c:import('pg').PoolClient)=>Promise<unknown>>=[
   c=>c.query("UPDATE communication_event_receipts SET service_event_id='unrelated-same-time' WHERE organization_id=$1",[org]),
   c=>c.query("UPDATE communication_event_receipts SET payload_fingerprint=$2 WHERE organization_id=$1",[org,'d'.repeat(64)]),
   c=>c.query("UPDATE agent_messages SET request_key='channel-incoming:unrelated' WHERE thread_id=$1 AND request_key LIKE 'channel-incoming:%'",[thread]),
   async c=>{await c.query("UPDATE agent_messages SET content=jsonb_set(content,'{details,verifiedReply}','false') WHERE thread_id=$1 AND request_key LIKE 'channel-incoming:%'",[thread]);await refreshNoticeDigest(c);},
   async c=>{await c.query("UPDATE agent_messages SET content=jsonb_set(content,'{details,routeId}',to_jsonb($2::text)) WHERE thread_id=$1 AND request_key LIKE 'channel-incoming:%'",[thread,randomUUID()]);await refreshNoticeDigest(c);},
   c=>c.query("UPDATE agent_messages SET content_digest=$2 WHERE thread_id=$1 AND request_key LIKE 'channel-incoming:%'",[thread,'e'.repeat(64)]),
   c=>c.query("UPDATE campaign_inbound_events SET contact_id=$2 WHERE organization_id=$1",[org,randomUUID()]),
   c=>c.query("UPDATE campaign_reply_receipts SET owner_user_id=$2 WHERE organization_id=$1",[org,randomUUID()]),
   c=>c.query("UPDATE campaign_reply_receipts SET organization_id=$2 WHERE organization_id=$1",[org,randomUUID()]),
   c=>c.query("INSERT INTO communication_reply_review_latches(binding_id,service_event_id,organization_id,owner_user_id,code)VALUES($1,'untracked-original',$2,$3,'protocol')",[bindings.linkedin,org,user]),
   c=>c.query("UPDATE agent_conversations SET history=$2 WHERE id=$1",[conversation,JSON.stringify([{id:'known-optout',direction:'inbound',text:'Do not contact me again.',at:new Date().toISOString()}])]),
   c=>c.query("UPDATE agent_conversations SET phase='held',pause_reason='provider_outcome_unknown' WHERE id=$1",[conversation]),
   c=>c.query('DELETE FROM campaign_reply_receipts WHERE organization_id=$1',[org]),
   c=>c.query("UPDATE campaign_reply_receipts SET account_identity=$2 WHERE organization_id=$1",[org,'c'.repeat(64)]),
   c=>c.query("UPDATE campaign_reply_holds SET provider_event_id=$2 WHERE contact_id=$1",[contact,'c'.repeat(64)]),
   c=>c.query("UPDATE campaign_reply_holds SET channel='whatsapp' WHERE contact_id=$1",[contact]),
   c=>c.query("UPDATE campaign_reply_holds SET received_at=received_at+interval '1 second' WHERE contact_id=$1",[contact]),
   c=>c.query("UPDATE campaign_reply_holds SET reason='reply_identity_ambiguous' WHERE contact_id=$1",[contact]),
   c=>c.query('UPDATE agent_conversation_channels SET binding_id=$2 WHERE id=$1',[routeId,bindings.email]),
   c=>c.query("UPDATE agent_conversation_channels SET identity_source='{}' WHERE id=$1",[routeId]),
   c=>c.query('UPDATE communication_bindings SET generation=2 WHERE id=$1',[bindings.linkedin]),
   c=>c.query("UPDATE contacts SET personal_data=jsonb_set(personal_data,'{doNotContact}','true') WHERE id=$1",[contact]),
   c=>c.query('UPDATE contacts SET fictionalised=true WHERE id=$1',[contact]),
   c=>c.query("UPDATE communication_event_receipts SET result='review' WHERE organization_id=$1",[org]),
   c=>c.query("UPDATE agent_operations SET state='uncertain' WHERE id=$1",[proposalId]),
   c=>c.query("UPDATE agent_conversations SET phase='complete',engagement='stopped' WHERE id=$1",[conversation]),
   c=>c.query("INSERT INTO contacts(id,organization_id,mandate_id,display_name,personal_data,provenance,fictionalised)SELECT $1,organization_id,mandate_id,'Ambiguous synthetic alias',personal_data,'{}',false FROM contacts WHERE id=$2",[randomUUID(),contact]),
   c=>c.query("INSERT INTO suppressions(organization_id,address,reason)VALUES($1,'owner@example.invalid','Synthetic guard')",[org]),
  ];for(const patch of patches)expect(await check(patch)).toBe(false);
 });
});
