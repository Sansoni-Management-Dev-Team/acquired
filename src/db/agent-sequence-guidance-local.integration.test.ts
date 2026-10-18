import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {emptyBrief} from '@/domain/acquisition';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {prepareNativeChatDecision} from '@/lib/agent-chat-plan';
import {AgentChatStore} from './agent-chat-store';
const enabled=process.env.RUN_AGENT_SEQUENCE_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentChatStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('versioned guidance for generated sequence drafts',()=>{
 beforeAll(async()=>{
  const identity=(await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
  expect(identity).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic conversation test',$4,'{}',$3)",[mandate,org,user,JSON.stringify({brief:emptyBrief()})]);
  await c.query('COMMIT');}finally{c.release();}
  vi.stubEnv('AGENT_GUIDANCE_ENABLED','true');store=new AgentChatStore(pool,actor);thread=(await store.openThread(mandate)).id;
 });
 afterAll(async()=>{
  // Delete only this suite's synthetic tenant; never use a pilot user's thread.
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const table of ['agent_sink_messages','agent_authority_uses','agent_handoffs','agent_person_claims','agent_budget_reservations','agent_budget_accounts','agent_review_batches','agent_authority_grants','agent_operations','agent_conversations','agent_responsibilities','agent_runs','agent_events','agent_messages','agent_threads','campaign_sequences','contacts','mandates','member','audit_events','communication_send_gates'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
  await c.query('DELETE FROM organization WHERE id=$1',[org]);
  await c.query('DELETE FROM "user" WHERE id=$1',[user]);
  await c.query('COMMIT');}finally{c.release();}
  await pool.end();vi.unstubAllEnvs();
 });

 async function start(){const state=await store.executionState(thread);return store.controlResponsibility(thread,randomUUID(),{action:'start',expectedRevision:state.responsibility?.revision??0,mandateRevision:state.mandateRevision});}


 const definition={schemaVersion:1 as const,steps:[{id:randomUUID(),kind:'email' as const,title:'Introduction',subject:'Confidential conversation',body:'A literal human-written draft.'}]};
 async function guidance(inThread=thread){const source=await store.appendMessage(inThread,randomUUID(),'user',{text:'Please keep introductions brief.'}),candidate=await store.proposeGuidance(inThread,randomUUID(),{text:'Use a brief conversational introduction.',category:'tone',sourceMessageId:source.id,triggerTerms:[]});return store.decideGuidance(inThread,candidate.id,candidate.revision,'approved');}
 async function frozen(){const context=await store.nativeChatContext(thread,'Build a sequence');if(!context?.sequenceGuidance)throw new Error('Server guidance context required');return context.sequenceGuidance;}
 async function proposed(snapshot:unknown){await start();return store.proposeSequenceDraft(thread,randomUUID(),{name:'Guided sequence',definition},undefined,{guidanceSnapshot:snapshot});}
 async function approve(proposal:{reviewBatchId?:string}){const batch=(await store.listReviewBatches(thread)).find(row=>row.id===proposal.reviewBatchId)!;await store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved');return batch;}
 it('retrieves approved own-thread sequence guidance and excludes another mandate even for the same member',async()=>{await start();const own=await guidance(),otherMandate=randomUUID();await pool.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Other synthetic mandate',$3,'{}',$4)",[otherMandate,org,JSON.stringify({brief:emptyBrief()}),user]);const other=(await store.openThread(otherMandate)).id,foreign=await guidance(other),context=await store.nativeChatContext(thread,'Build an email sequence');expect(context?.sequenceGuidance?.items.map(item=>item.id)).toContain(own.id);expect(context?.sequenceGuidance?.items.map(item=>item.id)).not.toContain(foreign.id);});
 it('blocks a revoked applied guidance version between draft review and saving without changing the literal definition',async()=>{const memory=await guidance(),snapshot=await frozen(),proposal=await proposed(snapshot),batch=await approve(proposal);expect(batch.operations[0].input.definition).toEqual(definition);await store.decideGuidance(thread,memory.id,memory.revision,'rejected');await expect(store.saveApprovedSequenceDraft(thread,proposal.id)).rejects.toThrow('guidance changed');expect((await pool.query('SELECT count(*)::int n FROM campaign_sequences WHERE id=$1',[batch.operations[0].input.sequenceId])).rows[0].n).toBe(0);});
 it('invalidates an originally empty guidance snapshot when new relevant guidance is approved',async()=>{for(const item of (await store.listGuidance(thread)).filter(item=>item.state==='approved'))await store.decideGuidance(thread,item.id,item.revision,'rejected');const snapshot=await frozen();expect(snapshot.items).toHaveLength(0);const proposal=await proposed(snapshot);await approve(proposal);await guidance();await expect(store.saveApprovedSequenceDraft(thread,proposal.id)).rejects.toThrow('guidance changed');});
 it('preserves directly supplied human drafts literally instead of silently regenerating them from preferences',async()=>{await start();const proposal=await store.proposeSequenceDraft(thread,randomUUID(),{name:'Literal human sequence',definition});await approve(proposal);const saved=await store.saveApprovedSequenceDraft(thread,proposal.id);expect((await pool.query('SELECT draft FROM campaign_sequences WHERE id=$1',[saved.sequenceId])).rows[0].draft).toEqual(definition);});
 it('blocks revoked generation guidance before committing a completed model answer or queuing its draft tool',async()=>{await start();const now=new Date();now.setUTCHours(0,0,0,0);for(const unit of ['calls','usd_micro'])for(const scope of ['organization','user:'+user,'mandate:'+mandate])await store.configureBudget({scopeKey:scope+':'+unit,unit,windowStart:now.toISOString(),windowEnd:new Date(now.getTime()+86400000).toISOString(),cap:unit==='usd_micro'?'1000000':'100',expectedRevision:0});const memory=await guidance(),question='Build an email sequence',turn=await store.beginConversationTurn(thread,randomUUID(),question),context=await store.nativeChatContext(thread,question),response={text:'Prepared draft',proposal:{kind:'sequence',name:'Scoped guided draft',definition}},spec={model:'gpt-6-luna',maxInputTokens:64000,maxOutputTokens:2000,inputPriceMicroUsdPerMillion:'100000',outputPriceMicroUsdPerMillion:'500000',promptVersion:'native-chat-v1',requestDigest:'b'.repeat(64)},model=await store.beginChatModel(thread,turn.operationId,spec);if(model.kind!=='started')throw new Error('New synthetic accounted model required');await store.finishChatModel(thread,model.operationId,model.fence,{model:spec.model,usage:{inputTokens:100,outputTokens:50,cachedInputTokens:0,reasoningTokens:0},response});const prepared=prepareNativeChatDecision(response,context);await store.decideGuidance(thread,memory.id,memory.revision,'rejected');await expect(store.finishConversationTurn(turn.operationId,prepared.text,context!.sequenceGuidance!.items.map(item=>({id:item.id,revision:item.revision})),prepared.plan)).rejects.toThrow('Guidance changed');expect((await pool.query('SELECT count(*)::int n FROM agent_events WHERE thread_id=$1 AND event_key=$2',[thread,'chat-plan:'+turn.operationId])).rows[0].n).toBe(0);expect((await pool.query('SELECT count(*)::int n FROM agent_messages WHERE thread_id=$1 AND request_key=$2',[thread,'turn:'+turn.operationId+':assistant'])).rows[0].n).toBe(0);await store.failConversationTurn(turn.operationId,'failed');});

});
