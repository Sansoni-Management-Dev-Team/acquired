import {approvedDispatchEvent,dispatchRunLimits,legacyRunLimits,runDurationSql,runDurationMs} from './agent-dispatch-budget';
import {agentNativeDispatchSqlNames} from './agent-operation-sql';
import {acquisitionWorkflowContext,withAcquisitionWorkflowContext} from '@/lib/acquisition-workflow-context';
import {bindAgentWorkflowContext,resolveAgentWorkflowContext} from './agent-workflow-context';
import {AsyncLocalStorage} from 'node:async_hooks';
import {loadAgentReviewPeople} from './agent-review-people';
import {insertAgentReviewBatch,persistAgentReviewDecision} from './agent-review-ledger';
import {agentRecordDigest as digest} from '@/lib/agent-record-digest';
import {agentJson as json,openAgentThread,appendAgentMessage} from './agent-message-persistence';
import {checkAgentResearchMandateReviewContext,type AgentReviewContextOperation} from './agent-review-context';
import {isAgentReviewableOperation,isAgentEditableMessageOperation} from '@/domain/agent-operation-classifications';
import{installAgentBusinessTimeSql}from'@/lib/agent-business-time-sql';
import {businessNow,businessSql} from '../../communications/packages/core/src/business-clock';
import {assertAgentBusinessTimeScope,type AgentBusinessTimeContext,type AgentBusinessTimeScope} from '@/lib/agent-business-time';
import {installAgentReadBudget,type AgentTransactionPreset} from './agent-read-budget';
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
export type AgentThread = { id: string; organization_id: string; mandate_id: string; owner_user_id: string; revision: number };
export type AgentEvent = { id: string; thread_id: string; mandate_id?:string; created_at?:Date|string; workflow_execution_id?:string|null; kind: string; payload: unknown; lease_owner: string; fence: string; attempts: number };

export type AgentStoreOptions={workflowExecutionId?:string|null;businessTime?:{context:AgentBusinessTimeContext;scope:AgentBusinessTimeScope}};

/** Server-owned scope. This class does not accept credentials, execute tools or send. */
export class AgentStore {
  private readonly workflowClients=new WeakMap<PoolClient,{id:string|null;mandateId?:string}>();
  private readonly workflowExecutionId?:string|null;
  private readonly readClient = new AsyncLocalStorage<{client:PoolClient;active:boolean}>();
  /** Only fixed read projections may use this bundle; provider work stays outside.
   * Context is per store/actor and expires before the outer transaction settles. */
  protected readBundle<T>(work:()=>Promise<T>):Promise<T>{
    return this.transaction(client=>{
      const scope={client,active:true};
      return this.readClient.run(scope,async()=>{try{return await work();}finally{scope.active=false;}});
    });
  }
  protected actor: AgentActor;
  protected readonly businessTime?:AgentBusinessTimeContext;
  constructor(protected pool: Pick<Pool, 'connect'>, actor: AgentActor, options:AgentStoreOptions={}) {
    this.actor = agentActorSchema.parse(actor);
    this.workflowExecutionId=options.workflowExecutionId===undefined?undefined:options.workflowExecutionId===null?null:uuid.parse(options.workflowExecutionId);
    const time=options.businessTime;
    if(time){
      if(time.scope.organizationId!==this.actor.organizationId||time.scope.userId!==this.actor.userId)throw Error('Agent business time scope unavailable');
      assertAgentBusinessTimeScope(time.context,time.scope);this.businessTime=time.context;
    }
  }
  protected businessNow(){return businessNow(this.businessTime);}
  protected businessSql(){return businessSql(this.businessTime);}
  /** The caller must first verify the exact persisted original delivery proof. */
  protected reconciliationBusinessAnchor(proof:Record<string,unknown>):Date{
    if(!this.businessTime)return proof.updated_at as Date;
    const completion=proof.business_completed_at;
    const delivery=proof.result&&typeof proof.result==='object'&&'delivery'in proof.result?proof.result.delivery:undefined;
    const submitted=delivery&&typeof delivery==='object'&&'status'in delivery&&delivery.status==='submitted'&&'submittedAt'in delivery?delivery.submittedAt:undefined;
    const raw=completion??submitted;
    const instant=raw instanceof Date?raw.getTime():typeof raw==='string'?Date.parse(raw):NaN;
    if(!Number.isFinite(instant)||instant>this.businessNow())throw Error('Business reconciliation anchor unavailable');
    return new Date(instant);
  }
  protected async transaction<T>(work: (client: PoolClient) => Promise<T>,preset?:AgentTransactionPreset,readOnly=false) {
    const bundled=this.readClient.getStore();
    if(bundled){
      if(!bundled.active||preset!==undefined)throw new Error('Invalid nested agent read transaction');
      return work(bundled.client);
    }
    const client = await this.pool.connect();
    try {
      await client.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
      if(preset!==undefined)await installAgentReadBudget(client,preset);
      await client.query('SET LOCAL ROLE acquire_agent_user');
      const role = (await client.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
      if (role.name !== 'acquire_agent_user' || role.rolsuper || role.rolbypassrls) throw new Error('Agent role must enforce RLS');
      await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)", [this.actor.organizationId,this.actor.userId]);
      const runtime=agentTransactionRuntimeContext();
      if(runtime.runtimeId)await client.query("SELECT set_config('app.acquire_runtime_id',$1,true),set_config('app.acquire_channel_simulation',$2,true)",[runtime.runtimeId,runtime.channelSimulation?'true':'false']);
      if(this.businessTime)await installAgentBusinessTimeSql(client,{context:this.businessTime,scope:this.businessTime.scope},this.actor);
      if(!this.businessTime&&runtime.runtimeId){
        const installed=(await client.query("SELECT to_regprocedure('public.local_simulator_business_now()') IS NOT NULL AS installed")).rows[0]?.installed;
        if(typeof installed!=='boolean')throw Error('Agent business clock availability is unknown');
        if(installed)await client.query('SELECT public.local_simulator_business_now()');
      }
      // Read projections use a consistent snapshot, RLS and current membership.
      // PostgreSQL forbids writes; mutation/admission transactions retain the gate.
      if(!readOnly){
        const gate=(await client.query("SELECT to_regprocedure('public.agent_lock_send_gate()') IS NOT NULL AS installed")).rows[0];
        if(typeof gate?.installed!=='boolean')throw new Error('Agent gate availability is unknown');
        if(gate.installed)await client.query('SELECT public.agent_lock_send_gate()');
      }
      const member=readOnly?await client.query("SELECT EXISTS(SELECT 1 FROM member WHERE organization_id=$1 AND user_id=$2) AS allowed",[this.actor.organizationId,this.actor.userId]):await client.query('SELECT agent_lock_member() AS allowed');
      if (!member.rows[0]?.allowed) throw new Error('Agent actor is no longer a member');
      const workflow=acquisitionWorkflowContext();
      if(workflow&&(workflow.organizationId!==this.actor.organizationId||workflow.ownerUserId!==this.actor.userId))throw Error('Workflow actor scope changed');
      const workflowId=workflow?workflow.id:this.workflowExecutionId;
      if(workflowId!==undefined){await bindAgentWorkflowContext(client,this.actor,workflowId);this.workflowClients.set(client,{id:workflowId});}
      const result = await work(client);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { this.workflowClients.delete(client);client.release(); }
  }
  protected async thread(client: PoolClient, id: string): Promise<AgentThread> {
    const row = (await client.query<AgentThread>('SELECT * FROM agent_threads WHERE id=$1',[uuid.parse(id)])).rows[0];
    if (!row) throw new Error('Agent thread not found');
    await this.bindMandateWorkflow(client,row.mandate_id);
    return row;
  }
  /** Read projection and new-command scope also exists before a chat thread. */
  protected async bindMandateWorkflow(client:PoolClient,mandateId:string){
    const original=this.workflowClients.get(client);
    if(!original){const id=await resolveAgentWorkflowContext(client,this.actor,mandateId);this.workflowClients.set(client,{id,mandateId});}
    else if(original.id!==null&&original.mandateId!==mandateId){await bindAgentWorkflowContext(client,this.actor,original.id,mandateId);original.mandateId=mandateId;}
  }
  /** Async request scope follows the persisted event/effect, never a thread's later execution. */
  withWorkflowExecution<T>(id:string|null,work:()=>Promise<T>){return withAcquisitionWorkflowContext({id,organizationId:this.actor.organizationId,ownerUserId:this.actor.userId},work);}
  protected async bindOriginalWorkflow(client:PoolClient,row:{workflow_execution_id?:string|null;mandate_id?:string}){
    if(!Object.prototype.hasOwnProperty.call(row,'workflow_execution_id'))return; // pre-expansion compatibility
    const id=row.workflow_execution_id??null;
    await bindAgentWorkflowContext(client,this.actor,id,row.mandate_id);
    this.workflowClients.set(client,{id,mandateId:row.mandate_id});
  }
  protected workflowId(client:PoolClient){return this.workflowClients.get(client)?.id??null;}
  protected workflowModeTable(client:PoolClient){return this.workflowClients.get(client)?.id?'agent_effective_execution_modes':'agent_mandate_execution_modes';}
  /** Saved display data only: no context digest, row lock or sending authority. */
  async operationDisplayRecord(threadId:string,operationId:string){
    uuid.parse(threadId);uuid.parse(operationId);
    return this.transaction(async c=>{
      const row=(await c.query(`SELECT
        jsonb_build_object('id',o.id,'name',o.name,'state',o.state,'result',o.result) AS operation,
        jsonb_build_object('id',c.id,'phase',c.phase,'pause_reason',c.pause_reason,
          'history_complete',c.history_complete,'history_observed_at',c.history_observed_at,'history',c.history) AS conversation,
        CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'channel',r.channel) END AS route
        FROM agent_operations o
        INNER JOIN agent_threads t ON t.id=o.thread_id AND o.organization_id=t.organization_id AND o.owner_user_id=t.owner_user_id AND o.mandate_id=t.mandate_id
        INNER JOIN agent_conversations c ON c.id=o.conversation_id AND c.thread_id=t.id AND c.organization_id=t.organization_id AND c.owner_user_id=t.owner_user_id AND c.mandate_id=t.mandate_id
        LEFT JOIN agent_conversation_channels r ON r.id::text=o.input->>'routeId' AND r.conversation_id=c.id AND r.thread_id=t.id AND r.organization_id=t.organization_id AND r.owner_user_id=t.owner_user_id AND r.mandate_id=t.mandate_id
        WHERE o.id=$1 AND t.id=$2 AND t.organization_id=$3 AND t.owner_user_id=$4
          AND o.name IN(${agentNativeDispatchSqlNames})`,[operationId,threadId,this.actor.organizationId,this.actor.userId])).rows[0];
      if(!row)throw Error('Owned operation display unavailable');
      return {operation:row.operation,conversation:row.conversation,route:row.route};
    },undefined,true);
  }
  async openThread(mandateId: string): Promise<AgentThread> {
    return this.transaction(c => openAgentThread(c,this.actor,mandateId));
  }
  async appendMessage(threadId: string, requestKey: string, role: 'user'|'assistant', content: unknown) {
    return this.transaction(async c => {
      const t=await this.thread(c,threadId);
      return appendAgentMessage(c,t,requestKey,role,content);
    });
  }
  async messages(threadId: string, limit=100) {
    return this.transaction(async c => {
      await this.thread(c,threadId); z.number().int().min(1).max(200).parse(limit);
      const rows=(await c.query(`SELECT recent.id,recent.role,recent.content,recent.request_key,recent.sequence,recent.created_at,
        person.display_name AS lead_name,v.id AS lead_conversation_id,
        (SELECT jsonb_build_object('text',left(h->>'text',500),'channel',coalesce(h->>'channel','email'),'at',h->>'at')
          FROM jsonb_array_elements(v.history) h WHERE h->>'direction'='inbound'
          AND h->>'at' ~ '^\\d{4}-\\d{2}-\\d{2}T' AND (h->>'at')::timestamptz<=recent.created_at
          ORDER BY (h->>'at')::timestamptz DESC,h->>'id' DESC LIMIT 1) AS lead_reply
        FROM (SELECT * FROM agent_messages WHERE thread_id=$1 ORDER BY sequence DESC LIMIT $2) recent
        LEFT JOIN LATERAL (
          SELECT o.conversation_id FROM agent_operations o
          WHERE recent.content->'details'->>'conversationId' IS NULL
            AND recent.request_key ~ '^no-submission:[a-fA-F0-9-]{36}$'
            AND recent.request_key='no-submission:'||o.id::text
            AND o.id=CASE WHEN recent.content->>'operationId' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' THEN (recent.content->>'operationId')::uuid END
            AND o.thread_id=recent.thread_id AND o.organization_id=recent.organization_id
            AND o.mandate_id=recent.mandate_id AND o.owner_user_id=recent.owner_user_id
          UNION ALL
          SELECT h.conversation_id FROM agent_handoffs h
          WHERE recent.content->'details'->>'conversationId' IS NULL
            AND h.id=CASE
              WHEN recent.request_key ~ '^task-reminder:[a-fA-F0-9-]{36}$' AND recent.content->'details'->>'taskId' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' THEN (recent.content->'details'->>'taskId')::uuid
              WHEN recent.request_key ~ '^handoff-notice:[a-fA-F0-9-]{36}$' AND recent.content->'details'->>'id' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' THEN (recent.content->'details'->>'id')::uuid
            END
            AND h.thread_id=recent.thread_id AND h.organization_id=recent.organization_id
            AND h.mandate_id=recent.mandate_id AND h.owner_user_id=recent.owner_user_id
          UNION ALL
          SELECT COALESCE(CASE WHEN e.payload->>'conversationId' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' THEN (e.payload->>'conversationId')::uuid END,reconcile_operation.conversation_id,review_operation.conversation_id) AS conversation_id
          FROM agent_events e
          LEFT JOIN LATERAL (
            SELECT reconcile_operation.conversation_id FROM agent_operations reconcile_operation
            WHERE e.kind IN('email.reconcile','whatsapp.reconcile','linkedin.reconcile','email.proposed','whatsapp.proposed','linkedin.proposed')
              AND reconcile_operation.id=CASE WHEN e.payload->>'operationId' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' THEN (e.payload->>'operationId')::uuid END
              AND reconcile_operation.thread_id=e.thread_id AND reconcile_operation.organization_id=e.organization_id
              AND reconcile_operation.mandate_id=e.mandate_id AND reconcile_operation.owner_user_id=e.owner_user_id
            LIMIT 1
          ) reconcile_operation ON true
          LEFT JOIN LATERAL (
            SELECT CASE WHEN count(DISTINCT o.conversation_id)=1 THEN min(o.conversation_id::text)::uuid END AS conversation_id
            FROM agent_review_batches b JOIN agent_operations o ON o.thread_id=b.thread_id
              AND o.id IN(SELECT (item->>'operationId')::uuid FROM jsonb_array_elements(b.manifest) item)
            WHERE e.kind='review.approved' AND b.id=CASE WHEN e.payload->>'reviewBatchId' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' THEN (e.payload->>'reviewBatchId')::uuid END
              AND b.thread_id=e.thread_id AND b.organization_id=e.organization_id AND b.mandate_id=e.mandate_id AND b.owner_user_id=e.owner_user_id
              AND o.organization_id=e.organization_id AND o.mandate_id=e.mandate_id AND o.owner_user_id=e.owner_user_id
          ) review_operation ON true
          WHERE recent.content->'details'->>'conversationId' IS NULL
            AND recent.request_key ~ '^event-review:[a-fA-F0-9-]{36}:[1-9][0-9]*$'
            AND split_part(recent.request_key,':',2)=e.id::text
            AND e.id=CASE WHEN recent.content->>'triggerEventId' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' THEN (recent.content->>'triggerEventId')::uuid END
            AND e.kind IN('conversation.reassess','conversation.history_changed','conversation.reminder','channel.due','email.reconcile','whatsapp.reconcile','linkedin.reconcile','review.approved','email.proposed','whatsapp.proposed','linkedin.proposed')
            AND e.thread_id=recent.thread_id AND e.organization_id=recent.organization_id
            AND e.mandate_id=recent.mandate_id AND e.owner_user_id=recent.owner_user_id
          LIMIT 1
        ) source ON true
        LEFT JOIN agent_conversations v ON v.id=COALESCE(
          CASE WHEN recent.content->'details'->>'conversationId' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' THEN (recent.content->'details'->>'conversationId')::uuid END,
          source.conversation_id)
          AND v.thread_id=recent.thread_id AND v.organization_id=recent.organization_id
          AND v.mandate_id=recent.mandate_id AND v.owner_user_id=recent.owner_user_id
        LEFT JOIN contacts person ON person.id=v.contact_id AND person.organization_id=v.organization_id
        ORDER BY recent.sequence`,[threadId,limit])).rows;
      // Resolve company labels once per owned person, rather than once per log record.
      const ids=[...new Set(rows.map(row=>row.lead_conversation_id).filter(Boolean))];
      const companies=ids.length?(await c.query("SELECT id,public.agent_public_conversation_facts(id)->>'companyName' AS name FROM unnest($1::uuid[]) AS id",[ids])).rows:[];
      const names=new Map(companies.map(company=>[company.id,company.name]));
      return rows.map(row=>({...row,...(names.has(row.lead_conversation_id)?{lead_company:names.get(row.lead_conversation_id)}:{})}));
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
    return this.transaction(async c => {
      const eligible=await this.eventEligibilityPredicate(c);
      const event=(await c.query<AgentEvent>(`SELECT e.* FROM agent_events e WHERE ${eligible} AND available_at<=${this.businessSql()}${this.businessTime?" AND (e.operational_not_before_at IS NULL OR e.operational_not_before_at<=clock_timestamp())":''}
       AND (state='pending' OR (state='leased' AND lease_until<=clock_timestamp())) AND ($1::uuid IS NULL OR e.mandate_id=$1::uuid)
       AND NOT EXISTS(SELECT 1 FROM agent_runs r WHERE r.thread_id=e.thread_id AND r.state='running' AND (r.lease_until IS NULL OR r.lease_until>clock_timestamp()))
       ORDER BY CASE WHEN e.kind IN ('email.reconcile','whatsapp.reconcile','linkedin.reconcile') THEN e.available_at-interval '60 seconds' ELSE e.available_at END,e.available_at,e.id
       FOR UPDATE SKIP LOCKED LIMIT 1`,[mandateId??null])).rows[0];
      if(!event)return undefined;
      await this.bindOriginalWorkflow(c,event);
      return (await c.query<AgentEvent>(`UPDATE agent_events SET state='leased',lease_owner=$1,lease_until=clock_timestamp()+($2::int*interval '1 millisecond'),fence=fence+1,attempts=attempts+1 WHERE id=$3 RETURNING *`,[workerId,leaseMs===60000&&await approvedDispatchEvent(c,event)?dispatchRunLimits.eventLeaseMs:leaseMs,event.id])).rows[0];
    });
  }
  async completeEvent(eventId: string, workerId: string, fence: string) {
    uuid.parse(eventId);uuid.parse(workerId);z.string().regex(/^\d+$/).parse(fence);
    return this.transaction(async c => {const original=(await c.query('SELECT * FROM agent_events WHERE id=$1',[eventId])).rows[0];if(original)await this.bindOriginalWorkflow(c,original);return !!(await c.query(`UPDATE agent_events SET state='done',lease_owner=NULL,lease_until=NULL
      WHERE id=$1 AND state='leased' AND lease_owner=$2 AND fence=$3::bigint AND lease_until>clock_timestamp() RETURNING id`,[eventId,workerId,fence])).rowCount;});
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
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,${this.businessSql()})) ON CONFLICT(thread_id,event_key) DO NOTHING`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,name,JSON.stringify(value),hash,date]);
      const row=(await c.query('SELECT * FROM agent_events WHERE thread_id=$1 AND event_key=$2',[t.id,request])).rows[0];
      if(row.kind!==name||row.payload_digest!==hash)throw new Error('Event key reused with different work');return row;
    });
  }
  private eventIdentity(event:AgentEvent){
    uuid.parse(event.id);uuid.parse(event.thread_id);uuid.parse(event.lease_owner);z.string().regex(/^\d+$/).parse(event.fence);
    return [event.id,event.thread_id,event.lease_owner,event.fence];
  }
  async beginEventRun(event:AgentEvent):Promise<{kind:'started';runId:string;deadlineAt?:string;durationMs?:number}|{kind:'busy'}|{kind:'lost'}>{
    const identity=this.eventIdentity(event);
    return this.transaction(async c=>{
      const t=await this.lockThread(c,event.thread_id);
      const current=(await c.query("SELECT * FROM agent_events WHERE id=$1 AND thread_id=$2 AND lease_owner=$3 AND fence=$4::bigint AND state='leased' AND lease_until>clock_timestamp() FOR UPDATE",identity)).rows[0];
      if(!current||!await this.eventIsEligible(c,t.id,current.kind))return {kind:'lost'};
      const prior=(await c.query("SELECT id,created_at,lease_until,model_config FROM agent_runs WHERE trigger_event_id=$1 AND state='running' AND lease_owner=$2 AND fence=$3::bigint AND lease_until>clock_timestamp()",[event.id,event.lease_owner,event.fence])).rows[0];
      if(prior){const durationMs=current.kind==='review.approved'?runDurationMs(prior.model_config?.nativeLimits):45000;return {kind:'started',runId:prior.id,durationMs,deadlineAt:new Date(Math.min(new Date(prior.created_at).getTime()+durationMs,new Date(prior.lease_until).getTime()-10000)).toISOString()};}
      await c.query("UPDATE agent_runs SET state='uncertain',stop_reason='interrupted_event',updated_at=now() WHERE thread_id=$1 AND state='running' AND lease_until<=clock_timestamp()",[t.id]);
      if((await c.query("SELECT id FROM agent_runs WHERE thread_id=$1 AND state='running'",[t.id])).rowCount)return {kind:'busy'};
      // Transaction-start now() includes lock waits before a run exists. Start
      // its duration at insertion; retain the original event lease unchanged.
      const limits=await approvedDispatchEvent(c,current)?dispatchRunLimits:legacyRunLimits;
      const run=(await c.query(`INSERT INTO agent_runs(thread_id,organization_id,mandate_id,owner_user_id,trigger_event_id,state,lease_owner,lease_until,fence,model_config,created_at)
       VALUES($1,$2,$3,$4,$5,'running',$6,$7,$8::bigint,$9::jsonb,clock_timestamp()) RETURNING id,created_at,lease_until`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,event.id,event.lease_owner,current.lease_until,event.fence,JSON.stringify({nativeLimits:limits})])).rows[0];
      return {kind:'started',runId:run.id,durationMs:limits.maxDurationMs,deadlineAt:new Date(Math.min(new Date(run.created_at).getTime()+limits.maxDurationMs,new Date(run.lease_until).getTime()-10000)).toISOString()};
    });
  }
  async eventRunCurrent(runId:string,event:AgentEvent){
    uuid.parse(runId);const identity=this.eventIdentity(event);
    return this.transaction(async c=>{const eligible=await this.eventEligibilityPredicate(c);return !!(await c.query(`SELECT r.id FROM agent_runs r JOIN agent_events e ON e.id=r.trigger_event_id
      WHERE ${eligible} AND e.id=$1 AND e.thread_id=$2 AND e.lease_owner=$3 AND e.fence=$4::bigint AND e.state='leased' AND e.lease_until>clock_timestamp()
      AND r.id=$5 AND r.state='running' AND r.lease_owner=e.lease_owner AND r.fence=e.fence AND r.lease_until>clock_timestamp() AND r.created_at+${runDurationSql('r')}>clock_timestamp()`,[...identity,runId])).rowCount;},undefined,true);
  }
  async deferEvent(event:AgentEvent,wakeAt:string){
    const identity=this.eventIdentity(event);z.string().datetime({offset:true}).parse(wakeAt);
    return this.transaction(async c=>!!(await c.query(`UPDATE agent_events SET state='pending',${this.businessTime?'operational_not_before_at':'available_at'}=$5::timestamptz,lease_owner=NULL,lease_until=NULL
      WHERE id=$1 AND thread_id=$2 AND lease_owner=$3 AND fence=$4::bigint AND state='leased' AND lease_until>clock_timestamp()
      AND $5::timestamptz>clock_timestamp() AND $5::timestamptz<=clock_timestamp()+interval '30 days' RETURNING id`,[...identity,wakeAt])).rowCount);
  }
  async finishEventRun(runId:string,event:AgentEvent,raw:AgentEventOutcome){
    uuid.parse(runId);const identity=this.eventIdentity(event),outcome=agentEventOutcomeSchema.parse(raw);
    // Validate operational retry horizons at receipt, before lock/checkout waits.
    const receivedAt=new Date().toISOString();
    if(outcome.kind==='defer'&&outcome.timeBasis==='business'&&!this.businessTime)throw Error('Selected business clock required');
    return this.transaction(async c=>{
      const t=await this.lockThread(c,event.thread_id);
      const current=(await c.query(`SELECT r.id FROM agent_runs r JOIN agent_events e ON e.id=r.trigger_event_id
       WHERE e.id=$1 AND e.thread_id=$2 AND e.lease_owner=$3 AND e.fence=$4::bigint AND e.state='leased' AND e.lease_until>clock_timestamp()
       AND r.id=$5 AND r.state='running' AND r.lease_owner=e.lease_owner AND r.fence=e.fence AND r.lease_until>clock_timestamp() FOR UPDATE OF e,r`,[...identity,runId])).rows[0];
      if(!current)return false;
      if(outcome.kind==='defer'){
        const business=outcome.timeBasis==='business',basis=business?this.businessSql():'clock_timestamp()';
        const lower=business?basis:'$2::timestamptz';
        const due=(await c.query(`SELECT $1::timestamptz>${lower} AND $1::timestamptz<=${basis}+interval '30 days' AS allowed`,business?[outcome.wakeAt]:[outcome.wakeAt,receivedAt])).rows[0];
        if(!due.allowed)throw new Error('Reassessment is outside the allowed horizon');
        if(business){
          // The current event/run is already locked and its lease is real. Only
          // a spent operational hold may be removed; a new real retry wins.
          const rescheduled=await c.query("UPDATE agent_events SET state='pending',available_at=$2::timestamptz,operational_not_before_at=NULL,lease_owner=NULL,lease_until=NULL WHERE id=$1 AND (operational_not_before_at IS NULL OR operational_not_before_at<=clock_timestamp()) RETURNING id",[event.id,outcome.wakeAt]);
          if(!rescheduled.rowCount)throw Error('Operational retry hold changed');
        }else await c.query(`UPDATE agent_events SET state='pending',${this.businessTime?'operational_not_before_at':'available_at'}=$2::timestamptz,lease_owner=NULL,lease_until=NULL WHERE id=$1`,[event.id,outcome.wakeAt]);
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
    const workflowIds=new Set(rows.filter(row=>row.workflow_execution_id!==undefined).map(row=>row.workflow_execution_id));
    if(workflowIds.size>1)throw new Error('Review operations belong to different workflow executions');
    if(rows[0])await this.bindOriginalWorkflow(c,rows[0]);
    for(const item of manifest){
      const op=rows.find(row=>row.id===item.operationId)!;
      if(!isAgentReviewableOperation(op.name))throw new Error('Operation is not reviewable');
      if(op.state!=='proposed'||op.revision!==item.revision||op.input_digest!==item.digest||op.input?.contextRevision!==item.contextRevision)throw new Error('Operation changed; refresh and review again');
      await this.checkReviewContext(c,t,op);
      if(op.conversation_id){const current=(await c.query('SELECT agent_context_revision($1::uuid) AS revision',[op.conversation_id])).rows[0];if(current.revision!==item.contextRevision)throw new Error('Conversation changed; reassess before approval');}
    }
    return rows;
  }
  /** Additional current-context guards run under the same review transaction. */
  protected async checkReviewContext(c:PoolClient,t:AgentThread,op:AgentReviewContextOperation){
    await checkAgentResearchMandateReviewContext(c,t,op);
  }
  async createReviewBatch(threadId:string,requestKey:string,items:unknown){
    const manifest=assertExactReviewBatch(items,items).sort((a,b)=>a.operationId.localeCompare(b.operationId)),request=key.parse(requestKey);
    return this.transaction(async c=>{
      const t=await this.lockThread(c,threadId);
      const prior=(await c.query('SELECT * FROM agent_review_batches WHERE thread_id=$1 AND request_key=$2',[t.id,request])).rows[0];
      if(prior){assertExactReviewBatch(prior.manifest,manifest);return prior;}
      await this.currentReviewOperations(c,t,manifest);
      return insertAgentReviewBatch(c,t,request,manifest);
    });
  }
  protected async reviewBudgetProjection(_c:PoolClient,_t:AgentThread,_op:{id:string;name:string;input:unknown}):Promise<unknown>{void _c;void _t;void _op;return undefined;}
  async listReviewBatches(threadId:string,options:{pendingOnly?:boolean}={}){
    const filter=z.object({pendingOnly:z.boolean().optional()}).strict().parse(options);
    return this.transaction(async c=>{
      const t=await this.thread(c,threadId);
      const batches=(await c.query("SELECT * FROM agent_review_batches WHERE thread_id=$1 AND ($2::boolean=false OR state='pending') ORDER BY created_at DESC,id LIMIT 50",[t.id,filter.pendingOnly===true])).rows;
      for(const batch of batches){
        const manifest=assertExactReviewBatch(batch.manifest,batch.manifest);
        batch.operations=(await c.query('SELECT o.id,o.name,o.input,o.input_digest,o.revision,o.state,o.conversation_id,review_person.display_name AS lead_name,review_person.role AS lead_role,CASE WHEN current_conversation.id IS NOT NULL THEN public.agent_public_conversation_facts(current_conversation.id)->>\'companyName\' ELSE NULL END AS lead_company,CASE WHEN current_conversation.id IS NOT NULL THEN public.agent_context_revision(current_conversation.id) ELSE NULL END AS current_context_revision FROM agent_operations o LEFT JOIN agent_conversations current_conversation ON current_conversation.id=o.conversation_id AND current_conversation.thread_id=o.thread_id AND current_conversation.organization_id=o.organization_id AND current_conversation.owner_user_id=o.owner_user_id LEFT JOIN contacts review_person ON review_person.id=current_conversation.contact_id AND review_person.organization_id=current_conversation.organization_id WHERE o.thread_id=$1 AND o.id=ANY($2::uuid[]) ORDER BY o.id',[t.id,manifest.map(item=>item.operationId)])).rows;
        let contextStale=false;
        for(const op of batch.operations){
          if(op.conversation_id&&op.current_context_revision!==op.input?.contextRevision)contextStale=true;
          if(op.current_context_revision){op.conversationId=op.conversation_id;if(op.lead_name)op.leadName=op.lead_name;if(op.lead_role)op.leadRole=op.lead_role;if(op.lead_company)op.leadCompany=op.lead_company;}
          delete op.lead_name;delete op.lead_role;delete op.lead_company;delete op.current_context_revision;delete op.conversation_id;
          // A database guard may reject an old proposal. Keep that proposal
          // visibly stale without leaving the surrounding read transaction
          // aborted and hiding the other reviews. Approval guards still fail
          // the entire decision transaction in currentReviewOperations.
          await c.query('SAVEPOINT review_context_check');
          try{await this.checkReviewContext(c,t,op);}
          catch{await c.query('ROLLBACK TO SAVEPOINT review_context_check');contextStale=true;}
          await c.query('RELEASE SAVEPOINT review_context_check');
          const funding=await this.reviewBudgetProjection(c,t,op);if(funding!==undefined)op.funding=funding;
        }
        batch.stale=contextStale||batch.operations.length!==manifest.length||manifest.some(item=>!batch.operations.some((op:{id:string;revision:number;input_digest:string;input:{contextRevision?:string}})=>op.id===item.operationId&&op.revision===item.revision&&op.input_digest===item.digest&&op.input.contextRevision===item.contextRevision));
      }
      const selectedIds=batches.flatMap(batch=>batch.operations.flatMap((op:{name:string;input?:{selected?:{contactId?:unknown}[]}})=>op.name==='target.select'&&Array.isArray(op.input?.selected)?op.input.selected.flatMap(person=>typeof person.contactId==='string'?[person.contactId]:[]):[]));
      const people=await loadAgentReviewPeople(c,t,selectedIds);
      for(const batch of batches)for(const op of batch.operations)if(op.name==='target.select'&&Array.isArray(op.input?.selected))op.people=people.filter(person=>op.input.selected.some((selected:{contactId:string})=>selected.contactId===person.id));
      return batches;
    });
  }
  async decideReviewBatch(threadId:string,batchId:string,revision:number,presented:unknown,decision:'approved'|'rejected',approvalSource?:'automatic_demo'){
    uuid.parse(batchId);z.number().int().positive().parse(revision);z.enum(['approved','rejected']).parse(decision);
    return this.transaction(async c=>{
      const t=await this.lockThread(c,threadId);
      if(approvalSource!==undefined){
        z.literal('automatic_demo').parse(approvalSource);
        const mode=(await c.query(`SELECT mode FROM ${this.workflowModeTable(c)} WHERE mandate_id=$1 AND organization_id=$2`,[t.mandate_id,t.organization_id])).rows[0]?.mode;
        if(mode!=='demo'||decision!=='approved')throw new Error('Automatic demo attribution requires an approved demo review');
      }
      const batch=(await c.query('SELECT * FROM agent_review_batches WHERE id=$1 AND thread_id=$2 FOR UPDATE',[batchId,t.id])).rows[0];
      if(!batch)throw new Error('Review batch not found');
      const manifest=assertExactReviewBatch(batch.manifest,presented);
      if(batch.revision!==revision)throw new Error('Review batch changed');
      if(batch.state===decision)return batch;
      if(batch.state!=='pending')throw new Error('Review batch was already decided or invalidated');
      await this.currentReviewOperations(c,t,manifest);
      return persistAgentReviewDecision(c,t,this.actor.userId,{batchId:batch.id,manifest,decision,approvalSource});
    });
  }
  async editProposedOperation(threadId:string,operationId:string,revision:number,input:unknown){
    uuid.parse(operationId);z.number().int().positive().parse(revision);const value=json(input);
    z.object({contextRevision:key}).passthrough().parse(value);
    return this.transaction(async c=>{
      const t=await this.lockThread(c,threadId);
      const op=(await c.query('SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 FOR UPDATE',[operationId,t.id])).rows[0];
      if(!op||!isAgentReviewableOperation(op.name)||op.state!=='proposed'||op.revision!==revision)throw new Error('Operation changed or unavailable');
      await this.bindOriginalWorkflow(c,op);
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
      if(!op||!isAgentEditableMessageOperation(op.name)||op.revision!==revision)throw new Error('Email proposal changed or unavailable');
      if(op.name==='linkedin.invitation'&&(body.length>300||op.input.requiresHumanReview!==true))throw new Error('An invitation requires human review and at most 300 characters');
      if(op.conversation_id&&op.name!=='email.manual_link'&&containsAgentOutboundLink(body))throw new Error('A booking link requires a human handoff');
      const input={...op.input,body},hash=digest({name:op.name,input});
      json(input);
      await c.query('UPDATE agent_operations SET input=$2,input_digest=$3,revision=revision+1,updated_at=now() WHERE id=$1',[op.id,JSON.stringify(input),hash]);
      const next=manifest.map(item=>item.operationId===operationId?{...item,revision:revision+1,digest:hash}:item);
      await c.query("UPDATE agent_review_batches SET state='invalidated' WHERE id=$1",[batch.id]);
      return insertAgentReviewBatch(c,t,request,next);
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
    return this.transaction(async c=>(await c.query<AgentThread>('SELECT * FROM agent_threads WHERE organization_id=$1 AND mandate_id=$2 AND owner_user_id=$3',[this.actor.organizationId,uuid.parse(mandateId),this.actor.userId])).rows[0],undefined,true);
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
      await this.bindOriginalWorkflow(c,op);
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
