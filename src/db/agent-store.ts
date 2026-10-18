import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import {agentTransactionRuntimeContext} from '@/lib/agent-runtime-context';
import {containsAgentOutboundLink} from '@/domain/agent-execution';
import {agentEventOutcomeSchema,type AgentEventOutcome} from '@/domain/agent-events';
import {assertExactReviewBatch,authorityGrantSchema,type AgentReviewItem} from '@/domain/agent-authority';

export const agentActorSchema = z.object({ organizationId: z.string().min(1).max(200), userId: z.string().min(1).max(200) }).strict();
export type AgentActor = z.infer<typeof agentActorSchema>;
const uuid = z.string().uuid();
const key = z.string().trim().min(1).max(200);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
function digest(value: unknown) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function json(value: unknown) {
  const parsed = z.json().parse(value);
  if (Buffer.byteLength(JSON.stringify(parsed)) > 60_000) throw new Error('Agent payload exceeds the bounded storage limit');
  return parsed;
}
export type AgentThread = { id: string; organization_id: string; mandate_id: string; owner_user_id: string; revision: number };
export type AgentEvent = { id: string; thread_id: string; mandate_id?:string; kind: string; payload: unknown; lease_owner: string; fence: string; attempts: number };

/** Server-owned scope. This class does not accept credentials, execute tools or send. */
export class AgentStore {
  protected actor: AgentActor;
  constructor(private pool: Pick<Pool, 'connect'>, actor: AgentActor) { this.actor = agentActorSchema.parse(actor); }
  protected async transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE acquire_agent_user');
      const role = (await client.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
      if (role.name !== 'acquire_agent_user' || role.rolsuper || role.rolbypassrls) throw new Error('Agent role must enforce RLS');
      await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)", [this.actor.organizationId,this.actor.userId]);
      const runtime=agentTransactionRuntimeContext();
      if(runtime.runtimeId)await client.query("SELECT set_config('app.acquire_runtime_id',$1,true),set_config('app.acquire_channel_simulation',$2,true)",[runtime.runtimeId,runtime.channelSimulation?'true':'false']);
      // Optional until the separately approved native-control migration exists.
      // Once installed, use the shared gate BEFORE taking membership/row locks.
      const gate=(await client.query("SELECT to_regprocedure('public.agent_lock_send_gate()') IS NOT NULL AS installed")).rows[0];
      if(typeof gate?.installed!=='boolean')throw new Error('Agent gate availability is unknown');
      if(gate.installed)await client.query('SELECT public.agent_lock_send_gate()');
      const member = await client.query('SELECT agent_lock_member() AS allowed');
      if (!member.rows[0]?.allowed) throw new Error('Agent actor is no longer a member');
      const result = await work(client);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  protected async thread(client: PoolClient, id: string): Promise<AgentThread> {
    const row = (await client.query<AgentThread>('SELECT * FROM agent_threads WHERE id=$1',[uuid.parse(id)])).rows[0];
    if (!row) throw new Error('Agent thread not found');
    return row;
  }
  async openThread(mandateId: string): Promise<AgentThread> {
    return this.transaction(async c => {
      const values=[this.actor.organizationId,uuid.parse(mandateId),this.actor.userId];
      await c.query(`INSERT INTO agent_threads(organization_id,mandate_id,owner_user_id)
        SELECT $1,$2,$3 FROM mandates WHERE id=$2 AND organization_id=$1
        ON CONFLICT(organization_id,mandate_id,owner_user_id) DO NOTHING`,values);
      const row=(await c.query<AgentThread>('SELECT * FROM agent_threads WHERE organization_id=$1 AND mandate_id=$2 AND owner_user_id=$3',values)).rows[0];
      if (!row) throw new Error('Mandate not found'); return row;
    });
  }
  async appendMessage(threadId: string, requestKey: string, role: 'user'|'assistant', content: unknown) {
    return this.transaction(async c => {
      const t=await this.thread(c,threadId); const request=key.parse(requestKey); const value=json(content); const hash=digest({role:z.enum(['user','assistant']).parse(role),content:value});
      await c.query(`INSERT INTO agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(thread_id,request_key) DO NOTHING`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,role,JSON.stringify(value),hash]);
      const row=(await c.query('SELECT * FROM agent_messages WHERE thread_id=$1 AND request_key=$2',[t.id,request])).rows[0];
      if (row.content_digest!==hash) throw new Error('Idempotency key reused with different message'); return row;
    });
  }
  async messages(threadId: string, limit=100) {
    return this.transaction(async c => {
      await this.thread(c,threadId); z.number().int().min(1).max(200).parse(limit);
      return (await c.query('SELECT id,role,content,sequence,created_at FROM (SELECT * FROM agent_messages WHERE thread_id=$1 ORDER BY sequence DESC LIMIT $2) recent ORDER BY sequence',[threadId,limit])).rows;
    });
  }
  async proposeOperation(threadId: string, requestKey: string, name: string, input: unknown) {
    return this.transaction(async c => {
      const t=await this.thread(c,threadId);const value=json(input);const operation=key.parse(name);const k=key.parse(requestKey);const hash=digest({name:operation,input:value});
      await c.query(`INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(thread_id,request_key) DO NOTHING`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,k,operation,JSON.stringify(value),hash]);
      const row=(await c.query('SELECT * FROM agent_operations WHERE thread_id=$1 AND request_key=$2',[t.id,k])).rows[0];
      if(row.input_digest!==hash) throw new Error('Idempotency key reused with different operation');
      await c.query(`INSERT INTO agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
        VALUES($1,$2,$3,$4,$5,'operation.proposed',$6,$7) ON CONFLICT(thread_id,event_key) DO NOTHING`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'operation:'+row.id,JSON.stringify({operationId:row.id}),digest({operationId:row.id})]);
      return row;
    });
  }
  protected async eventEligibilityPredicate(c:PoolClient){
    const installed=(await c.query("SELECT to_regprocedure('public.agent_event_eligible(uuid,text)') IS NOT NULL AS installed")).rows[0]?.installed;
    if(typeof installed!=='boolean')throw new Error('Native event eligibility availability is unknown');
    if(!installed&&process.env.AGENT_NATIVE_EXECUTION_ENABLED==='true')throw new Error('Native event eligibility migration requires specific approval and installation');
    // Flag-off saved conversations retain their existing generic event behavior.
    return installed?'public.agent_event_eligible(e.thread_id,e.kind)':'true';
  }
  protected async eventIsEligible(c:PoolClient,threadId:string,kind:string){
    const predicate=await this.eventEligibilityPredicate(c);if(predicate==='true')return true;
    return (await c.query('SELECT public.agent_event_eligible($1::uuid,$2) AS eligible',[threadId,kind])).rows[0]?.eligible===true;
  }
  async claimEvent(workerId: string, leaseMs=30_000,mandateId?:string): Promise<AgentEvent|undefined> {
    uuid.parse(workerId);z.number().int().min(100).max(60_000).parse(leaseMs);if(mandateId!==undefined)uuid.parse(mandateId);
    return this.transaction(async c => {const eligible=await this.eventEligibilityPredicate(c);return (await c.query<AgentEvent>(`WITH due AS (
      SELECT id FROM agent_events e WHERE ${eligible} AND available_at<=clock_timestamp() AND (state='pending' OR (state='leased' AND lease_until<=clock_timestamp()))
      AND ($3::uuid IS NULL OR e.mandate_id=$3::uuid)
      AND NOT EXISTS(SELECT 1 FROM agent_runs r WHERE r.thread_id=e.thread_id AND r.state='running' AND (r.lease_until IS NULL OR r.lease_until>clock_timestamp()))
      -- Receipt lookup can clear the physical-account barrier for queued sends.
      -- A bounded scheduling credit preserves aging: it cannot starve older work.
      ORDER BY CASE WHEN e.kind IN ('email.reconcile','whatsapp.reconcile','linkedin.reconcile')
        THEN e.available_at-interval '60 seconds' ELSE e.available_at END,e.available_at,e.id
      FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE agent_events e SET state='leased',lease_owner=$1,lease_until=clock_timestamp()+($2::int*interval '1 millisecond'),fence=fence+1,attempts=attempts+1
      FROM due WHERE e.id=due.id RETURNING e.*`,[workerId,leaseMs,mandateId??null])).rows[0];});
  }
  async completeEvent(eventId: string, workerId: string, fence: string) {
    uuid.parse(eventId);uuid.parse(workerId);z.string().regex(/^\d+$/).parse(fence);
    return this.transaction(async c => !!(await c.query(`UPDATE agent_events SET state='done',lease_owner=NULL,lease_until=NULL
      WHERE id=$1 AND state='leased' AND lease_owner=$2 AND fence=$3::bigint AND lease_until>clock_timestamp() RETURNING id`,[eventId,workerId,fence])).rowCount);
  }
  protected async lockThread(c:PoolClient,id:string){
    const thread=await this.thread(c,id);
    await c.query('SELECT id FROM agent_threads WHERE id=$1 FOR UPDATE',[thread.id]);
    return thread;
  }
  async enqueueEvent(threadId:string,eventKey:string,kind:string,payload:unknown,availableAt?:string){
    const request=key.parse(eventKey),name=key.parse(kind),value=json(payload);
    const date=availableAt?z.string().datetime({offset:true}).parse(availableAt):null;
    const hash=digest({kind:name,payload:value,availableAt:date?new Date(date).toISOString():null});
    return this.transaction(async c=>{
      const t=await this.thread(c,threadId);
      await c.query(`INSERT INTO agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest,available_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,clock_timestamp())) ON CONFLICT(thread_id,event_key) DO NOTHING`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,name,JSON.stringify(value),hash,date]);
      const row=(await c.query('SELECT * FROM agent_events WHERE thread_id=$1 AND event_key=$2',[t.id,request])).rows[0];
      if(row.kind!==name||row.payload_digest!==hash)throw new Error('Event key reused with different work');return row;
    });
  }
  private eventIdentity(event:AgentEvent){
    uuid.parse(event.id);uuid.parse(event.thread_id);uuid.parse(event.lease_owner);z.string().regex(/^\d+$/).parse(event.fence);
    return [event.id,event.thread_id,event.lease_owner,event.fence];
  }
  async beginEventRun(event:AgentEvent):Promise<{kind:'started';runId:string}|{kind:'busy'}|{kind:'lost'}>{
    const identity=this.eventIdentity(event);
    return this.transaction(async c=>{
      const t=await this.lockThread(c,event.thread_id);
      const current=(await c.query("SELECT * FROM agent_events WHERE id=$1 AND thread_id=$2 AND lease_owner=$3 AND fence=$4::bigint AND state='leased' AND lease_until>clock_timestamp() FOR UPDATE",identity)).rows[0];
      if(!current||!await this.eventIsEligible(c,t.id,current.kind))return {kind:'lost'};
      const prior=(await c.query("SELECT id FROM agent_runs WHERE trigger_event_id=$1 AND state='running' AND lease_owner=$2 AND fence=$3::bigint AND lease_until>clock_timestamp()",[event.id,event.lease_owner,event.fence])).rows[0];
      if(prior)return {kind:'started',runId:prior.id};
      await c.query("UPDATE agent_runs SET state='uncertain',stop_reason='interrupted_event',updated_at=now() WHERE thread_id=$1 AND state='running' AND lease_until<=clock_timestamp()",[t.id]);
      if((await c.query("SELECT id FROM agent_runs WHERE thread_id=$1 AND state='running'",[t.id])).rowCount)return {kind:'busy'};
      const run=(await c.query(`INSERT INTO agent_runs(thread_id,organization_id,mandate_id,owner_user_id,trigger_event_id,state,lease_owner,lease_until,fence,model_config)
       VALUES($1,$2,$3,$4,$5,'running',$6,$7,$8::bigint,'{"nativeLimits":{"version":1,"maxToolSteps":32,"maxDurationMs":45000}}'::jsonb) RETURNING id`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,event.id,event.lease_owner,current.lease_until,event.fence])).rows[0];
      return {kind:'started',runId:run.id};
    });
  }
  async eventRunCurrent(runId:string,event:AgentEvent){
    uuid.parse(runId);const identity=this.eventIdentity(event);
    return this.transaction(async c=>{const eligible=await this.eventEligibilityPredicate(c);return !!(await c.query(`SELECT r.id FROM agent_runs r JOIN agent_events e ON e.id=r.trigger_event_id
      WHERE ${eligible} AND e.id=$1 AND e.thread_id=$2 AND e.lease_owner=$3 AND e.fence=$4::bigint AND e.state='leased' AND e.lease_until>clock_timestamp()
      AND r.id=$5 AND r.state='running' AND r.lease_owner=e.lease_owner AND r.fence=e.fence AND r.lease_until>clock_timestamp() AND r.created_at>clock_timestamp()-interval '45 seconds'`,[...identity,runId])).rowCount;});
  }
  async deferEvent(event:AgentEvent,wakeAt:string){
    const identity=this.eventIdentity(event);z.string().datetime({offset:true}).parse(wakeAt);
    return this.transaction(async c=>!!(await c.query(`UPDATE agent_events SET state='pending',available_at=$5::timestamptz,lease_owner=NULL,lease_until=NULL
      WHERE id=$1 AND thread_id=$2 AND lease_owner=$3 AND fence=$4::bigint AND state='leased' AND lease_until>clock_timestamp()
      AND $5::timestamptz>clock_timestamp() AND $5::timestamptz<=clock_timestamp()+interval '30 days' RETURNING id`,[...identity,wakeAt])).rowCount);
  }
  async finishEventRun(runId:string,event:AgentEvent,raw:AgentEventOutcome){
    uuid.parse(runId);const identity=this.eventIdentity(event),outcome=agentEventOutcomeSchema.parse(raw);
    return this.transaction(async c=>{
      const t=await this.lockThread(c,event.thread_id);
      const current=(await c.query(`SELECT r.id FROM agent_runs r JOIN agent_events e ON e.id=r.trigger_event_id
       WHERE e.id=$1 AND e.thread_id=$2 AND e.lease_owner=$3 AND e.fence=$4::bigint AND e.state='leased' AND e.lease_until>clock_timestamp()
       AND r.id=$5 AND r.state='running' AND r.lease_owner=e.lease_owner AND r.fence=e.fence AND r.lease_until>clock_timestamp() FOR UPDATE OF e,r`,[...identity,runId])).rows[0];
      if(!current)return false;
      if(outcome.kind==='defer'){
        const due=(await c.query("SELECT $1::timestamptz>clock_timestamp() AND $1::timestamptz<=clock_timestamp()+interval '30 days' AS allowed",[outcome.wakeAt])).rows[0];
        if(!due.allowed)throw new Error('Reassessment is outside the allowed horizon');
        await c.query("UPDATE agent_events SET state='pending',available_at=$2::timestamptz,lease_owner=NULL,lease_until=NULL WHERE id=$1",[event.id,outcome.wakeAt]);
      }else await c.query("UPDATE agent_events SET state='done',lease_owner=NULL,lease_until=NULL WHERE id=$1",[event.id]);
      await c.query('UPDATE agent_runs SET state=$2,stop_reason=$3,updated_at=now() WHERE id=$1',[runId,outcome.kind==='complete'?'complete':outcome.kind==='defer'?'waiting':'failed',outcome.kind==='defer'?outcome.reason:outcome.kind==='review'?(outcome.stopReason??'human_review_required'):null]);
      if(outcome.kind==='review'){
        const content={text:outcome.message,triggerEventId:event.id,runId};
        await c.query(`INSERT INTO agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
         VALUES($1,$2,$3,$4,$5,'assistant',$6,$7)`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'event-review:'+event.id+':'+event.fence,JSON.stringify(content),digest({role:'assistant',content})]);
        await c.query(`INSERT INTO agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
         VALUES($1,$2,$3,$4,$5,'agent.review_required',$6,$7)`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'event-review:'+event.id+':'+event.fence,JSON.stringify(content),digest(content)]);
      }
      return true;
    });
  }
  protected async currentReviewOperations(c:PoolClient,t:AgentThread,manifest:AgentReviewItem[]){
    const rows=(await c.query('SELECT * FROM agent_operations WHERE thread_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[t.id,manifest.map(item=>item.operationId)])).rows;
    if(rows.length!==manifest.length)throw new Error('Review operation not found');
    for(const item of manifest){
      const op=rows.find(row=>row.id===item.operationId)!;
      if(!['target.select','research.start','research.people','sequence.prepare','sequence.publish','sequence.enrol','email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up','linkedin.invitation','email.manual_link'].includes(op.name))throw new Error('Operation is not reviewable');
      if(op.state!=='proposed'||op.revision!==item.revision||op.input_digest!==item.digest||op.input?.contextRevision!==item.contextRevision)throw new Error('Operation changed; refresh and review again');
      await this.checkReviewContext(c,t,op);
      if(op.conversation_id){const current=(await c.query('SELECT agent_context_revision($1::uuid) AS revision',[op.conversation_id])).rows[0];if(current.revision!==item.contextRevision)throw new Error('Conversation changed; reassess before approval');}
    }
    return rows;
  }
  /** Additional current-context guards run under the same review transaction. */
  protected async checkReviewContext(c:PoolClient,t:AgentThread,op:{name:string;input?:{nativeResearchPlanVersion?:unknown;mandateRevision?:unknown;[key:string]:unknown}}){
    if(op.name==='research.start'&&op.input?.nativeResearchPlanVersion===1){
      const mandate=(await c.query('SELECT xmin::text AS revision FROM mandates WHERE id=$1 AND organization_id=$2',[t.mandate_id,t.organization_id])).rows[0];
      if(mandate?.revision!==op.input.mandateRevision)throw new Error('Mandate changed; review the current research plan');
    }
  }
  async createReviewBatch(threadId:string,requestKey:string,items:unknown){
    const manifest=assertExactReviewBatch(items,items).sort((a,b)=>a.operationId.localeCompare(b.operationId)),request=key.parse(requestKey);
    return this.transaction(async c=>{
      const t=await this.lockThread(c,threadId);
      const prior=(await c.query('SELECT * FROM agent_review_batches WHERE thread_id=$1 AND request_key=$2',[t.id,request])).rows[0];
      if(prior){assertExactReviewBatch(prior.manifest,manifest);return prior;}
      await this.currentReviewOperations(c,t,manifest);
      return (await c.query(`INSERT INTO agent_review_batches(thread_id,organization_id,mandate_id,owner_user_id,request_key,manifest,manifest_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,JSON.stringify(manifest),digest(manifest)])).rows[0];
    });
  }
  async listReviewBatches(threadId:string,options:{pendingOnly?:boolean}={}){
    const filter=z.object({pendingOnly:z.boolean().optional()}).strict().parse(options);
    return this.transaction(async c=>{
      const t=await this.thread(c,threadId);
      const batches=(await c.query("SELECT * FROM agent_review_batches WHERE thread_id=$1 AND ($2::boolean=false OR state='pending') ORDER BY created_at DESC,id LIMIT 50",[t.id,filter.pendingOnly===true])).rows;
      for(const batch of batches){
        const manifest=assertExactReviewBatch(batch.manifest,batch.manifest);
        batch.operations=(await c.query('SELECT o.id,o.name,o.input,o.input_digest,o.revision,o.state,o.conversation_id,CASE WHEN current_conversation.id IS NOT NULL THEN public.agent_context_revision(current_conversation.id) ELSE NULL END AS current_context_revision FROM agent_operations o LEFT JOIN agent_conversations current_conversation ON current_conversation.id=o.conversation_id AND current_conversation.thread_id=o.thread_id AND current_conversation.organization_id=o.organization_id AND current_conversation.owner_user_id=o.owner_user_id WHERE o.thread_id=$1 AND o.id=ANY($2::uuid[]) ORDER BY o.id',[t.id,manifest.map(item=>item.operationId)])).rows;
        let contextStale=false;
        for(const op of batch.operations){if(op.conversation_id&&op.current_context_revision!==op.input?.contextRevision)contextStale=true;delete op.current_context_revision;delete op.conversation_id;try{await this.checkReviewContext(c,t,op);}catch{contextStale=true;}}
        batch.stale=contextStale||batch.operations.length!==manifest.length||manifest.some(item=>!batch.operations.some((op:{id:string;revision:number;input_digest:string;input:{contextRevision?:string}})=>op.id===item.operationId&&op.revision===item.revision&&op.input_digest===item.digest&&op.input.contextRevision===item.contextRevision));
      }
      return batches;
    });
  }
  async decideReviewBatch(threadId:string,batchId:string,revision:number,presented:unknown,decision:'approved'|'rejected'){
    uuid.parse(batchId);z.number().int().positive().parse(revision);z.enum(['approved','rejected']).parse(decision);
    return this.transaction(async c=>{
      const t=await this.lockThread(c,threadId);
      const batch=(await c.query('SELECT * FROM agent_review_batches WHERE id=$1 AND thread_id=$2 FOR UPDATE',[batchId,t.id])).rows[0];
      if(!batch)throw new Error('Review batch not found');
      const manifest=assertExactReviewBatch(batch.manifest,presented);
      if(batch.revision!==revision)throw new Error('Review batch changed');
      if(batch.state===decision)return batch;
      if(batch.state!=='pending')throw new Error('Review batch was already decided or invalidated');
      await this.currentReviewOperations(c,t,manifest);
      await c.query('UPDATE agent_operations SET state=$2,updated_at=now() WHERE id=ANY($1::uuid[])',[manifest.map(item=>item.operationId),decision]);
      const updated=(await c.query('UPDATE agent_review_batches SET state=$2,decided_by=$3,decided_at=clock_timestamp() WHERE id=$1 RETURNING *',[batch.id,decision,this.actor.userId])).rows[0];
      const payload={reviewBatchId:batch.id,decision,items:manifest};
      await c.query(`INSERT INTO agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'review:'+batch.id+':'+decision,'review.'+decision,JSON.stringify(payload),digest(payload)]);
      const content={text:decision==='approved'?'You approved the displayed proposals. Execution will recheck current permissions and conversation state.':'You rejected the displayed proposals.',...payload};
      await c.query(`INSERT INTO agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
       VALUES($1,$2,$3,$4,$5,'user',$6,$7)`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'review:'+batch.id+':'+decision,JSON.stringify(content),digest({role:'user',content})]);
      return updated;
    });
  }
  async editProposedOperation(threadId:string,operationId:string,revision:number,input:unknown){
    uuid.parse(operationId);z.number().int().positive().parse(revision);const value=json(input);
    z.object({contextRevision:key}).passthrough().parse(value);
    return this.transaction(async c=>{
      const t=await this.lockThread(c,threadId);
      const op=(await c.query('SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 FOR UPDATE',[operationId,t.id])).rows[0];
      if(!op||!['target.select','research.start','research.people','sequence.prepare','sequence.publish','sequence.enrol','email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up','linkedin.invitation','email.manual_link'].includes(op.name)||op.state!=='proposed'||op.revision!==revision)throw new Error('Operation changed or unavailable');
      return (await c.query('UPDATE agent_operations SET input=$2,input_digest=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',[op.id,JSON.stringify(value),digest({name:op.name,input:value})])).rows[0];
    });
  }
  async editEmailReview(threadId:string,batchId:string,operationId:string,revision:number,text:string){
    uuid.parse(batchId);uuid.parse(operationId);z.number().int().positive().parse(revision);
    const body=z.string().trim().min(1).max(6000).parse(text);
    const request='edit:'+batchId+':'+operationId+':'+digest({revision,body});
    return this.transaction(async c=>{
      const t=await this.lockThread(c,threadId);
      const prior=(await c.query('SELECT * FROM agent_review_batches WHERE thread_id=$1 AND request_key=$2',[t.id,request])).rows[0];
      if(prior)return prior;
      const batch=(await c.query('SELECT * FROM agent_review_batches WHERE id=$1 AND thread_id=$2 FOR UPDATE',[batchId,t.id])).rows[0];
      if(!batch||batch.state!=='pending')throw new Error('Review batch changed or unavailable');
      const manifest=assertExactReviewBatch(batch.manifest,batch.manifest);
      const rows=await this.currentReviewOperations(c,t,manifest),op=rows.find(row=>row.id===operationId);
      if(!op||!['email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up','linkedin.invitation','email.manual_link'].includes(op.name)||op.revision!==revision)throw new Error('Email proposal changed or unavailable');
      if(op.name==='linkedin.invitation'&&(body.length>300||op.input.requiresHumanReview!==true))throw new Error('An invitation requires human review and at most 300 characters');
      if(op.conversation_id&&op.name!=='email.manual_link'&&containsAgentOutboundLink(body))throw new Error('A booking link requires a human handoff');
      const input={...op.input,body},hash=digest({name:op.name,input});
      json(input);
      await c.query('UPDATE agent_operations SET input=$2,input_digest=$3,revision=revision+1,updated_at=now() WHERE id=$1',[op.id,JSON.stringify(input),hash]);
      const next=manifest.map(item=>item.operationId===operationId?{...item,revision:revision+1,digest:hash}:item);
      await c.query("UPDATE agent_review_batches SET state='invalidated' WHERE id=$1",[batch.id]);
      return (await c.query(`INSERT INTO agent_review_batches(thread_id,organization_id,mandate_id,owner_user_id,request_key,manifest,manifest_digest)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,JSON.stringify(next),digest(next)])).rows[0];
    });
  }
  async createAuthorityGrant(threadId:string,raw:unknown){
    const input=z.object({id:uuid,actions:z.array(z.enum(['initial_email','reply_email','follow_up_email'])).min(1).max(3),recipientKeys:z.array(key).min(1).max(200),bindingDigest:z.string().regex(/^[a-f0-9]{64}$/),maxSends:z.number().int().min(1).max(100),expiresAt:z.string().datetime({offset:true})}).strict().parse(raw);
    return this.transaction(async c=>{
      const t=await this.lockThread(c,threadId);
      const prior=(await c.query('SELECT * FROM agent_authority_grants WHERE id=$1 AND thread_id=$2 FOR UPDATE',[input.id,t.id])).rows[0];
      if(prior){
        const original={id:prior.id,actions:prior.actions,recipientKeys:prior.recipient_keys,bindingDigest:prior.binding_digest,maxSends:prior.max_sends,expiresAt:prior.expires_at.toISOString()};
        if(digest(original)!==digest({...input,expiresAt:new Date(input.expiresAt).toISOString()}))throw new Error('Grant key reused with different scope');
        return prior;
      }
      const now=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
      authorityGrantSchema.parse({...input,organizationId:t.organization_id,mandateId:t.mandate_id,userId:t.owner_user_id,threadId:t.id,revision:1,channel:'email',usedSends:0,approvedBy:this.actor.userId,approvedAt:now.toISOString()});
      return (await c.query(`INSERT INTO agent_authority_grants(id,thread_id,organization_id,mandate_id,owner_user_id,channel,actions,recipient_keys,binding_digest,max_sends,expires_at,approved_by,approved_at)
       VALUES($1,$2,$3,$4,$5,'email',$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[input.id,t.id,t.organization_id,t.mandate_id,t.owner_user_id,JSON.stringify(input.actions),JSON.stringify(input.recipientKeys),input.bindingDigest,input.maxSends,input.expiresAt,this.actor.userId,now])).rows[0];
    });
  }
  async listAuthorityGrants(threadId:string){
    return this.transaction(async c=>{const t=await this.thread(c,threadId);return (await c.query('SELECT * FROM agent_authority_grants WHERE thread_id=$1 ORDER BY approved_at DESC,id LIMIT 100',[t.id])).rows;});
  }
  async revokeAuthorityGrant(threadId:string,grantId:string,revision:number){
    uuid.parse(grantId);z.number().int().positive().parse(revision);
    return this.transaction(async c=>{
      const t=await this.lockThread(c,threadId);
      const prior=(await c.query('SELECT * FROM agent_authority_grants WHERE id=$1 AND thread_id=$2 FOR UPDATE',[grantId,t.id])).rows[0];
      if(!prior)throw new Error('Authority grant not found');
      if(prior.revoked_at&&prior.revision===revision+1)return prior;
      if(prior.revision!==revision||prior.revoked_at)throw new Error('Authority grant changed');
      return (await c.query('UPDATE agent_authority_grants SET revoked_at=clock_timestamp(),revision=revision+1 WHERE id=$1 RETURNING *',[prior.id])).rows[0];
    });
  }
  async findThread(mandateId:string):Promise<AgentThread|undefined>{
    return this.transaction(async c=>(await c.query<AgentThread>('SELECT * FROM agent_threads WHERE organization_id=$1 AND mandate_id=$2 AND owner_user_id=$3',[this.actor.organizationId,uuid.parse(mandateId),this.actor.userId])).rows[0]);
  }
  async beginConversationTurn(threadId:string,requestKey:string,text:string):Promise<{kind:'started'|'busy'|'complete'|'failed';operationId:string;messageId?:string;text?:string}>{
    const request=key.parse(requestKey),question=z.string().trim().min(1).max(5000).parse(text);
    return this.transaction(async c=>{
      const t=await this.thread(c,threadId);
      await c.query('SELECT id FROM agent_threads WHERE id=$1 FOR UPDATE',[t.id]);
      // Read-only model work has no provider-side effect to reconcile. Expired
      // turns become interrupted; a new explicit request can proceed safely.
      await c.query("UPDATE agent_operations SET state='uncertain' WHERE thread_id=$1 AND name='conversation.answer' AND state='running' AND lease_until<=clock_timestamp()",[t.id]);
      await c.query("UPDATE agent_runs SET state='uncertain',stop_reason='interrupted' WHERE thread_id=$1 AND state='running' AND lease_until<=clock_timestamp()",[t.id]);
      const hash=digest({question});
      let op=(await c.query('SELECT * FROM agent_operations WHERE thread_id=$1 AND request_key=$2',[t.id,request])).rows[0];
      if(op){
        if(op.name!=='conversation.answer'||op.input_digest!==hash)throw new Error('Run key reused with different question');
        if(op.state==='complete')return {kind:'complete',operationId:op.id,...z.object({messageId:z.string().uuid(),text:z.string()}).parse(op.result)};
        return {kind:op.state==='running'?'busy':'failed',operationId:op.id};
      }
      if((await c.query("SELECT 1 FROM agent_runs WHERE thread_id=$1 AND state='running'",[t.id])).rowCount)return {kind:'busy',operationId:t.id};
      op=(await c.query(`INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state,lease_until)
        VALUES($1,$2,$3,$4,$5,'conversation.answer',$6,$7,'running',clock_timestamp()+interval '60 seconds') RETURNING *`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,JSON.stringify({question}),hash])).rows[0];
      await c.query(`INSERT INTO agent_runs(id,thread_id,organization_id,mandate_id,owner_user_id,state,lease_until) VALUES($1,$2,$3,$4,$5,'running',clock_timestamp()+interval '60 seconds')`,[op.id,t.id,t.organization_id,t.mandate_id,t.owner_user_id]);
      await c.query(`INSERT INTO agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES($1,$2,$3,$4,$5,'user',$6,$7)`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'turn:'+op.id+':user',JSON.stringify({text:question}),digest({role:'user',content:{text:question}})]);
      return {kind:'started',operationId:op.id};
    });
  }
  protected async persistConversationPlan(_c:PoolClient,_t:AgentThread,_operationId:string,_plan:unknown):Promise<unknown>{void _c;void _t;void _operationId;void _plan;throw new Error('Native chat proposals require the configured planner store');}
  async finishConversationTurn(operationId:string,text:string,guidance?:{id:string;revision:number}[],nativePlan?:unknown){
    const answer=z.string().trim().min(1).max(6000).parse(text);
    const references=z.array(z.object({id:uuid,revision:z.number().int().positive()}).strict()).max(5).parse(guidance??[]);
    return this.transaction(async c=>{
      const identity=(await c.query("SELECT thread_id FROM agent_operations WHERE id=$1 AND name='conversation.answer'",[uuid.parse(operationId)])).rows[0];
      if(!identity)throw new Error('Conversation turn is no longer active');
      // Use the same thread -> operation lock order as start/cancel/recovery.
      await c.query('SELECT id FROM agent_threads WHERE id=$1 FOR UPDATE',[identity.thread_id]);
      const op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND name='conversation.answer' AND state='running' AND lease_until>clock_timestamp() FOR UPDATE",[operationId])).rows[0];
      if(!op)throw new Error('Conversation turn is no longer active');
      const t=await this.thread(c,op.thread_id);
      if(references.length){
        const current=(await c.query("SELECT id,revision FROM agent_operations WHERE thread_id=$1 AND name='guidance.memory' AND state='approved' AND id=ANY($2::uuid[])",[t.id,references.map(item=>item.id)])).rows;
        if(references.some(item=>!current.some(row=>row.id===item.id&&row.revision===item.revision)))throw new Error('Guidance changed while preparing the answer');
      }
      const savedPlan=nativePlan===undefined?undefined:await this.persistConversationPlan(c,t,op.id,nativePlan);
      const content={text:answer,...(references.length?{appliedGuidance:references}:{})};
      const message=(await c.query(`INSERT INTO agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest) VALUES($1,$2,$3,$4,$5,'assistant',$6,$7) RETURNING id`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'turn:'+op.id+':assistant',JSON.stringify(content),digest({role:'assistant',content})])).rows[0];
      const result={messageId:message.id as string,text:answer,...(references.length?{appliedGuidance:references}:{}),...(savedPlan?{nativePlan:savedPlan}:{})};
      await c.query("UPDATE agent_operations SET state='complete',result=$2,updated_at=now() WHERE id=$1",[op.id,JSON.stringify(result)]);
      await c.query("UPDATE agent_runs SET state='complete',updated_at=now() WHERE id=$1",[op.id]);
      return result;
    });
  }
  async cancelConversationTurn(threadId:string,requestKey:string):Promise<'missing'|'complete'|'cancelled'>{
    return this.transaction(async c=>{
      const t=await this.thread(c,threadId);
      await c.query('SELECT id FROM agent_threads WHERE id=$1 FOR UPDATE',[t.id]);
      const op=(await c.query("SELECT id,state FROM agent_operations WHERE thread_id=$1 AND request_key=$2 AND name='conversation.answer' FOR UPDATE",[t.id,key.parse(requestKey)])).rows[0];
      if(!op)return 'missing';
      if(op.state==='complete')return 'complete';
      await c.query("UPDATE agent_operations SET state='rejected',updated_at=now() WHERE id=$1",[op.id]);
      await c.query("UPDATE agent_runs SET state='cancelled',stop_reason='cancelled',updated_at=now() WHERE id=$1 AND state IN ('running','uncertain','failed')",[op.id]);
      return 'cancelled';
    });
  }
  async failConversationTurn(operationId:string,reason:'failed'|'cancelled'){
    return this.transaction(async c=>{
      await c.query("UPDATE agent_operations SET state=$2,updated_at=now() WHERE id=$1 AND name='conversation.answer' AND state='running'",[uuid.parse(operationId),reason==='cancelled'?'rejected':'failed']);
      await c.query("UPDATE agent_runs SET state=$2,stop_reason=$2,updated_at=now() WHERE id=$1 AND state='running'",[operationId,reason]);
    });
  }

}

export const agentRecordDigest=digest;

export const agentRecordPayload=json;
