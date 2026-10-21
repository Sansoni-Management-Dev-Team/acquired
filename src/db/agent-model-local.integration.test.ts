import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentModelStore} from './agent-model-store';
import {agentRecordDigest} from './agent-store';
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentModelStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('native model accounting and replay',()=>{
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

 async function limits(){
  const start=new Date();start.setUTCHours(0,0,0,0);
  for(const unit of ['calls','usd_micro'])for(const scope of ['organization','user:'+user,'mandate:'+mandate])await store.configureBudget({scopeKey:scope+':'+unit,unit,windowStart:start.toISOString(),windowEnd:new Date(start.getTime()+86400000).toISOString(),cap:unit==='calls'?'10':'100000',expectedRevision:0});
 }
 const spec={model:'gpt-6-luna',maxInputTokens:64000,maxOutputTokens:2000,inputPriceMicroUsdPerMillion:'100000',outputPriceMicroUsdPerMillion:'500000',promptVersion:'native-conversation-v1'};
 it('reserves three call and three money limits before a provider request, then settles usage once',async()=>{
  await limits();const row=await prepared(),key=randomUUID(),request={conversationId:row.id,contextRevision:row.context_revision,...spec};
  const started=await store.beginNativeModel(thread,key,request);expect(started.kind).toBe('started');if(started.kind!=='started')throw new Error('Expected a new model operation');
  await expect(store.beginNativeModel(thread,key,request)).rejects.toThrow(/reconcil|running/);
  const response={action:'review',reason:'Buyer details need confirmation',sourceIds:[]};
  const result={response,model:spec.model,usage:{inputTokens:1000,outputTokens:200}};
  await store.finishNativeModel(thread,started.operationId,started.fence,result);
  expect(await store.beginNativeModel(thread,key,request)).toMatchObject({kind:'cached',response});
  await store.finishNativeModel(thread,started.operationId,started.fence,result);
  const accounts=await store.listBudgetAccounts();expect(accounts.filter(a=>a.unit==='calls').every(a=>a.spent==='1'&&a.reserved==='0')).toBe(true);
  expect(accounts.filter(a=>a.unit==='usd_micro').every(a=>a.spent==='200'&&a.reserved==='0')).toBe(true);
 });
 it('persists token details with an explicit conservative estimate and rejects inconsistent subcounts',async()=>{
  const row=await prepared(),started=await store.beginNativeModel(thread,randomUUID(),{conversationId:row.id,contextRevision:row.context_revision,...spec});
  if(started.kind!=='started')throw Error('Expected a new model operation');
  const result={model:spec.model,usage:{inputTokens:1000,outputTokens:200,cachedInputTokens:800,reasoningTokens:150,cacheWriteTokens:100},reason:'provider_response_invalid',responseFailure:{version:1,category:'schema_validation',draftKind:'invitation_linkedin',issues:[{path:'decision.draft.body',code:'too_big',maximum:300,length:301}]}};
  await expect(store.finishNativeModel(thread,started.operationId,started.fence,{...result,usage:{...result.usage,cachedInputTokens:1001}})).rejects.toThrow();
  await expect(store.finishNativeModel(thread,started.operationId,started.fence,{...result,usage:{...result.usage,cacheWriteTokens:201}})).rejects.toThrow();
  await expect(store.finishNativeModel(thread,started.operationId,started.fence,{...result,usage:{...result.usage,reasoningTokens:201}})).rejects.toThrow();
  await expect(store.finishNativeModel(thread,started.operationId,started.fence,{...result,usage:{inputTokens:1000,outputTokens:200,cachedInputTokens:800}})).rejects.toThrow();
  await expect(store.finishNativeModel(thread,started.operationId,started.fence,{...result,responseFailure:{...result.responseFailure,rawBody:'must not be persisted'}})).rejects.toThrow();
  const saved=await store.finishNativeModel(thread,started.operationId,started.fence,result);
  expect(saved).toMatchObject({...result,estimatedCostMicroUsd:'200',costBasis:'configured_price_ceiling_no_cached_discount',usageDetails:'reported'});
  expect((await pool.query('SELECT result FROM agent_operations WHERE id=$1',[started.operationId])).rows[0].result).toEqual(saved);
  expect(await store.finishNativeModel(thread,started.operationId,started.fence,result)).toEqual(saved);
  await expect(store.finishNativeModel(thread,started.operationId,started.fence,{...result,usage:{...result.usage,cachedInputTokens:799}})).rejects.toThrow('Different model usage receipt');
 });
 it('replays a stored legacy receipt without changing its digest or inventing token details',async()=>{
  const row=await prepared(),key=randomUUID(),request={conversationId:row.id,contextRevision:row.context_revision,...spec},started=await store.beginNativeModel(thread,key,request);
  if(started.kind!=='started')throw Error('Expected a new model operation');
  const result={response:{action:'review',reason:'Human review required',sourceIds:[]},model:spec.model,usage:{inputTokens:100,outputTokens:20}};
  await store.finishNativeModel(thread,started.operationId,started.fence,result);
  const legacy={...result,receiptDigest:agentRecordDigest(result),estimatedCostMicroUsd:'20'};
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.acquire_org',$1,true)",[org]);await c.query('SELECT communications_lock_send_gate($1)',[org]);await c.query('UPDATE agent_operations SET result=$2 WHERE id=$1',[started.operationId,JSON.stringify(legacy)]);await c.query('COMMIT');}finally{c.release();}
  expect(await store.finishNativeModel(thread,started.operationId,started.fence,result)).toEqual(legacy);
  expect(await store.beginNativeModel(thread,key,request)).toMatchObject({kind:'cached',response:result.response});
 });
 it('keeps uncertain model usage reserved and never blindly starts the same request again',async()=>{
  const row=await prepared(),key=randomUUID(),request={conversationId:row.id,contextRevision:row.context_revision,...spec};
  const started=await store.beginNativeModel(thread,key,request);expect(started.kind).toBe('started');if(started.kind!=='started')throw new Error('Expected a new model operation');
  expect(await store.finishNativeModel(thread,started.operationId,started.fence,{model:spec.model,usage:null,reason:'provider_outcome_unknown'})).toMatchObject({usage:null,usageDetails:'unknown',estimatedCostMicroUsd:null});
  await expect(store.beginNativeModel(thread,key,request)).rejects.toThrow(/reconcil/);
  expect((await store.listBudgetAccounts()).filter(a=>a.unit==='usd_micro').every(a=>a.reserved==='7400')).toBe(true);
 });
 it('settles a positively classified non-executed HTTP rejection once without releasing older unknown attempts',async()=>{
  const row=await prepared(),started=await store.beginNativeModel(thread,randomUUID(),{conversationId:row.id,contextRevision:row.context_revision,...spec});if(started.kind!=='started')throw Error('Expected attempt');
  const before=await store.listBudgetAccounts(),receipt={model:spec.model,usage:null,reason:'provider_request_rejected',rejection:{httpStatus:400,category:'invalid_request',code:'invalid_json_schema',parameter:'response_format'}};
  const saved=await store.finishNativeModel(thread,started.operationId,started.fence,receipt);expect(saved).toMatchObject({estimatedCostMicroUsd:'0',usageDetails:'not_executed',rejection:receipt.rejection});expect((await pool.query('SELECT state FROM agent_operations WHERE id=$1',[started.operationId])).rows[0].state).toBe('failed');
  await store.finishNativeModel(thread,started.operationId,started.fence,receipt);const after=await store.listBudgetAccounts();for(const account of after){const prior=before.find(a=>a.id===account.id)!;if(account.unit==='usd_micro'){expect(BigInt(prior.reserved)-BigInt(account.reserved)).toBe(BigInt(7400));expect(account.spent).toBe(prior.spent);expect(account.reserved).toBe('7400');}else expect(BigInt(account.spent)-BigInt(prior.spent)).toBe(BigInt(1));}
  await expect(store.finishNativeModel(thread,started.operationId,started.fence,{...receipt,usage:{inputTokens:100,outputTokens:10}})).rejects.toThrow();
 });

 it('accounts one saved chat answer/proposal attempt and replays without another reservation',async()=>{
  const turn=await store.beginConversationTurn(thread,randomUUID(),'Synthetic native chat question');expect(turn.kind).toBe('started');const chatSpec={...spec,requestDigest:'b'.repeat(64)},started=await store.beginChatModel(thread,turn.operationId,chatSpec);if(started.kind!=='started')throw Error('Expected child attempt');
  await expect(store.beginChatModel(thread,turn.operationId,chatSpec)).rejects.toThrow('reconciliation');const response={text:'Research needs review',proposal:{kind:'none'}},receipt={model:spec.model,usage:{inputTokens:100,outputTokens:20,cachedInputTokens:0,reasoningTokens:0},response};
  await store.finishChatModel(thread,started.operationId,started.fence,receipt);expect(await store.beginChatModel(thread,turn.operationId,chatSpec)).toMatchObject({kind:'cached',response});await expect(store.beginChatModel(thread,turn.operationId,{...chatSpec,requestDigest:'c'.repeat(64)})).rejects.toThrow('changed');await store.finishChatModel(thread,started.operationId,started.fence,receipt);expect((await pool.query('SELECT count(*)::int AS n FROM agent_budget_reservations WHERE operation_id=$1',[started.operationId])).rows[0].n).toBe(6);await store.finishConversationTurn(turn.operationId,response.text);
  await expect(store.beginChatModel(thread,turn.operationId,chatSpec)).rejects.toThrow('no longer active');
 });
 it('rejects missing chat scope caps before committing any model attempt, and retains unknown chat costs after cancellation',async()=>{
  const other=randomUUID();await pool.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic scope isolation','{}','{}',$3)",[other,org,user]);const otherThread=(await store.openThread(other)).id,otherTurn=await store.beginConversationTurn(otherThread,randomUUID(),'Question without mandate caps');
  const chatSpec={...spec,requestDigest:'d'.repeat(64)};await expect(store.beginChatModel(otherThread,otherTurn.operationId,chatSpec)).rejects.toThrow('limits first');expect((await pool.query("SELECT count(*)::int AS n FROM agent_operations WHERE thread_id=$1 AND name='conversation.answer.model'",[otherThread])).rows[0].n).toBe(0);await store.failConversationTurn(otherTurn.operationId,'failed');
  const key=randomUUID(),turn=await store.beginConversationTurn(thread,key,'Unknown chat outcome'),started=await store.beginChatModel(thread,turn.operationId,chatSpec);if(started.kind!=='started')throw Error('Expected child attempt');await store.cancelConversationTurn(thread,key);await store.finishChatModel(thread,started.operationId,started.fence,{model:spec.model,usage:null,reason:'provider_outcome_unknown'});expect((await pool.query('SELECT state,result FROM agent_operations WHERE id=$1',[started.operationId])).rows[0]).toMatchObject({state:'uncertain',result:{usageDetails:'unknown'}});expect((await pool.query("SELECT a.unit,r.* FROM agent_budget_reservations r JOIN agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=$1 AND a.unit='usd_micro'",[started.operationId])).rows).toHaveLength(3);
 });

});
