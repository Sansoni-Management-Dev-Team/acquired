import {AcquisitionWorkflowStore} from './acquisition-workflow-store';
import {agentChannelMessageSqlNames} from './agent-operation-sql';
import type {AgentTransactionPreset} from './agent-read-budget';
import {z} from 'zod';
import {AgentRunLimitError} from '@/domain/agent-events';
import type {PoolClient} from 'pg';
import {AgentRuntimeRegistryStore} from './agent-runtime-registry-store';
import {agentRecordDigest as digest,agentRecordPayload as payload,type AgentThread} from './agent-store';
import {outreachEmail} from '@/domain/outreach-contact';
import {nativeControlReceiptSchema,type NativeControlReceipt} from '@/domain/agent-execution';
const uuid=z.string().uuid(),revision=z.number().int().nonnegative();
const controlSchema=z.object({action:z.enum(['start','pause','resume']),expectedRevision:revision,mandateRevision:z.string().regex(/^\d+$/)}).strict();
const openSchema=z.discriminatedUnion('deliveryMode',[
 z.object({contactId:uuid,deliveryMode:z.literal('local_sink')}).strict(),
 z.object({contactId:uuid,deliveryMode:z.literal('communications'),bindingId:uuid}).strict(),
]);

export function recordedAgentBindingDigest(binding:Record<string,unknown>){
 return digest({applicationId:binding.application_id,tenantId:binding.organization_id,ownerId:binding.owner_user_id,connectionId:binding.service_connection_id,accountId:binding.service_account_id,generation:binding.generation,channel:binding.channel,platform:binding.platform,backend:binding.backend});
}
export type AgentExecutionFence={runId:string;eventId:string;leaseOwner:string;fence:string};
export class AgentExecutionStore extends AgentRuntimeRegistryStore{
 async configureExecutionBudget(threadId:string,key:string,raw:unknown){
  const input=z.object({scope:z.enum(['organization','user','mandate']),unit:z.enum(['calls','usd_micro','sends']),windowStart:z.string().datetime({offset:true}),windowEnd:z.string().datetime({offset:true}),cap:z.string().regex(/^(0|[1-9]\d{0,11})$/),expectedRevision:z.number().int().nonnegative()}).strict().parse(raw);
  return this.command(threadId,key,'budget.configure',input,async(c,t,commandId)=>{
   const scopeKey=({organization:'organization',user:'user:'+t.owner_user_id,mandate:'mandate:'+t.mandate_id})[input.scope]+':'+input.unit;
   await c.query('SELECT agent_configure_budget($1,$2,$3::timestamptz,$4::timestamptz,$5::bigint,$6::integer)',[scopeKey,input.unit,input.windowStart,input.windowEnd,input.cap,input.expectedRevision]);
   const account=(await c.query('SELECT id,revision FROM agent_budget_accounts WHERE organization_id=$1 AND scope_key=$2 AND window_start=$3::timestamptz',[t.organization_id,scopeKey,input.windowStart])).rows[0];
   await this.controlNotice(c,t,'budget:'+commandId,'You configured the '+input.scope+' '+input.unit+' budget. This limit does not approve research or messages.',{scopeKey,cap:input.cap,windowStart:input.windowStart,windowEnd:input.windowEnd});
   return {id:account.id as string,revision:account.revision as number,status:'configured'};
  });
 }
 protected async nativeTransaction<T>(work:(c:PoolClient)=>Promise<T>,preset?:AgentTransactionPreset,readOnly=false){
  return this.transaction(async c=>{
   const installed=(await c.query("SELECT to_regprocedure('public.agent_person_keys(text,uuid)') IS NOT NULL AS installed")).rows[0]?.installed;
   if(installed!==true)throw new Error('Native execution control schema has not been approved and installed');
   return work(c);
  },preset,readOnly);
 }
 protected async emit(c:PoolClient,t:AgentThread,key:string,kind:string,value:unknown,availableAt?:string){
  const data=payload(value);
  await c.query(`INSERT INTO agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest,available_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,${this.businessSql()})) ON CONFLICT(thread_id,event_key) DO NOTHING`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,key,kind,JSON.stringify(data),digest(data),availableAt??null]);
 }
 /** Operational retries retain their real not-before across business-clock advances. */
 protected async emitOperational(c:PoolClient,t:AgentThread,key:string,kind:string,value:unknown,notBefore:string){
  z.string().datetime({offset:true}).parse(notBefore);
  if(!this.businessTime)return this.emit(c,t,key,kind,value,notBefore);
  const data=payload(value);
  await c.query(`INSERT INTO agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest,available_at,operational_not_before_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,${this.businessSql()},$9::timestamptz) ON CONFLICT(thread_id,event_key) DO NOTHING`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,key,kind,JSON.stringify(data),digest(data),notBefore]);
 }
 protected async controlNotice(c:PoolClient,t:AgentThread,key:string,text:string,details:unknown){
  const content={text,details:payload(details)};
  await c.query(`INSERT INTO agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
   VALUES($1,$2,$3,$4,$5,'assistant',$6,$7) ON CONFLICT(thread_id,request_key) DO NOTHING`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,key,JSON.stringify(content),digest({role:'assistant',content})]);
 }
 protected async assertExecutionFence(c:PoolClient,t:AgentThread,authority?:AgentExecutionFence,stepKey?:string){
  if(!authority)return;
  uuid.parse(authority.runId);uuid.parse(authority.eventId);uuid.parse(authority.leaseOwner);z.string().regex(/^\d+$/).parse(authority.fence);
  const row=(await c.query(`SELECT r.id,r.usage,e.kind,e.workflow_execution_id,e.mandate_id,r.created_at+interval '45 seconds'>clock_timestamp() AS within_duration FROM agent_runs r JOIN agent_events e ON e.id=r.trigger_event_id
   WHERE r.id=$1 AND e.id=$2 AND r.thread_id=$3 AND e.thread_id=$3 AND r.state='running' AND e.state='leased'
   AND r.lease_owner=$4 AND e.lease_owner=$4 AND r.fence=$5::bigint AND e.fence=$5::bigint
   AND r.lease_until>clock_timestamp() AND e.lease_until>clock_timestamp() FOR UPDATE OF r,e`,[authority.runId,authority.eventId,t.id,authority.leaseOwner,authority.fence])).rows[0];
  if(!row||!await this.eventIsEligible(c,t.id,row.kind))throw new Error('Agent event authority expired or changed');
  await this.bindOriginalWorkflow(c,row);
  if(!row.within_duration)throw new AgentRunLimitError('run_duration_limit');
  if(stepKey){
   const step=digest(stepKey),steps=z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(32).parse(row.usage?.nativeSteps??[]);
   if(!steps.includes(step)){
    if(steps.length>=32)throw new AgentRunLimitError('run_step_limit');
    await c.query("UPDATE agent_runs SET usage=jsonb_set(usage,'{nativeSteps}',$2::jsonb),updated_at=now() WHERE id=$1",[row.id,JSON.stringify([...steps,step])]);
   }
  }
 }
 protected async command(threadId:string,requestKey:string,name:string,input:unknown,work:(c:PoolClient,t:AgentThread,commandId:string)=>Promise<NativeControlReceipt>,authority?:AgentExecutionFence){
  const request='control:'+digest(z.string().trim().min(1).max(200).parse(requestKey)),value=payload(input),hash=digest({name,input:value});
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority,'command:'+request);
   const prior=(await c.query('SELECT * FROM agent_operations WHERE thread_id=$1 AND request_key=$2',[t.id,request])).rows[0];
   if(prior){if(prior.name!==name||prior.input_digest!==hash||prior.state!=='complete')throw new Error('Command key reused with different or unfinished work');return nativeControlReceiptSchema.parse(prior.result);}
   const command=(await c.query(`INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state,lease_until)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'running',clock_timestamp()+interval '15 seconds') RETURNING id`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,name,JSON.stringify(value),hash])).rows[0];
   const result=nativeControlReceiptSchema.parse(await work(c,t,command.id));
   await c.query("UPDATE agent_operations SET state='complete',result=$2,updated_at=now() WHERE id=$1",[command.id,JSON.stringify(result)]);
   await this.emit(c,t,'command:'+command.id,'control.changed',{commandId:command.id,name,result});return result;
  });
 }
 async markWorkflowOutreach(id:string){
  const store=new AcquisitionWorkflowStore(this.pool,this.actor),execution=await store.read(id);
  if(!execution)throw Error('Workflow unavailable');
  if(execution.preset==='live-research-test')throw Error('Research-only workflow cannot start outreach');
  if(execution.state==='outreach')return;
  if(execution.state!=='ready')throw Error('Workflow is not ready for outreach');
  try{await store.transition(id,execution.revision,'outreach');}catch(error){if((await store.read(id))?.state!=='outreach')throw error;}
 }
 async executionState(threadId:string){
  return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId),mandate=(await c.query(`SELECT xmin::text AS revision,coalesce((SELECT mode FROM ${this.workflowModeTable(c)} WHERE mandate_id=mandates.id AND organization_id=mandates.organization_id),'real') AS execution_mode FROM mandates WHERE id=$1 AND organization_id=$2`,[t.mandate_id,t.organization_id])).rows[0];
   if(!mandate)throw new Error('Mandate not found');
   const responsibility=(await c.query('SELECT * FROM agent_responsibilities WHERE thread_id=$1',[t.id])).rows[0];
   const conversations=(await c.query(`SELECT id,contact_id,recipient_email,delivery_mode,driver_kind,phase,epoch::text,revision,engagement,next_wakeup_at,
    responsibility_id,human_user_id,sequence_enrolment_id,sequence_runtime,driver_generation,pending_driver,pause_reason,binding_digest,history_complete,history_observed_at,
    (history_complete AND history_observed_at BETWEEN ${this.businessSql()}-interval '5 minutes' AND ${this.businessSql()}) AS history_coverage_fresh,
    agent_context_revision(id) AS context_revision FROM agent_conversations WHERE thread_id=$1 ORDER BY created_at,id LIMIT 200`,[t.id])).rows;
   const workflowExecutionId=this.workflowId(c),workflow=workflowExecutionId?(await c.query('SELECT preset,state FROM acquisition_workflow_executions WHERE id=$1',[workflowExecutionId])).rows[0]:null;
   const mode=mandate.execution_mode as 'real'|'demo';
   const demoContacts=mode==='demo'?(await c.query('SELECT public.agent_demo_execution_readiness($1::uuid) AS readiness',[t.id])).rows[0]?.readiness:undefined;
   // Inspect the latest batch only: an old partial result must not obscure a
   // newer successful allocation or a fresh pending human selection review.
   const allocation=(await c.query("SELECT state,result FROM agent_operations WHERE thread_id=$1 AND name='target.select' ORDER BY created_at DESC,id DESC LIMIT 1",[t.id])).rows[0];
   const boundedCount=z.number().int().min(0).max(200),allocated=boundedCount.safeParse(allocation?.result?.allocated),needsReview=boundedCount.safeParse(allocation?.result?.needsReview);
   const allocationState=allocation?.state==='approved'?'queued' as const:allocation?.state==='running'?'running' as const:allocation?.state==='complete'&&needsReview.success&&needsReview.data>0?'needs_review' as const:undefined;
   const contactAllocation=allocationState?{state:allocationState,allocated:allocated.success?allocated.data:0,needsReview:needsReview.success?needsReview.data:0}:undefined;
   // An unchanged empty selection is a saved outcome, not another automatic
   // allocation request on every mount. Explicit contact review remains available.
   const selectionEmpty=(await c.query(`SELECT EXISTS(
    SELECT 1 FROM (SELECT state,result,input FROM agent_operations WHERE thread_id=$1 AND name='target.selection_plan' ORDER BY created_at DESC,id DESC LIMIT 1) o
    JOIN agent_responsibilities r ON r.thread_id=$1 AND r.id::text=o.result->>'id'
    LEFT JOIN agent_channel_policies p ON p.thread_id=r.thread_id
    WHERE o.state='complete' AND o.result->>'status'='needs_review'
    AND r.revision::text=o.result->>'revision' AND r.mandate_revision=$2
    AND (o.input->>'mode'<>'channels' OR p.revision::text=o.input->>'policyRevision')
   ) AS selection_empty`,[t.id,mandate.revision])).rows[0]?.selection_empty===true;
   return {mandateRevision:mandate.revision as string,executionMode:mode,...(workflow?{workflowExecutionId:workflowExecutionId!,workflowPreset:workflow.preset as 'demo'|'live'|'live-research-test'}:{}),...(demoContacts?{demoContacts}:{}),...(contactAllocation?{contactAllocation}:{}),...(selectionEmpty?{contactSelectionEmpty:true}:{}),responsibility,conversations:await this.executionChannelProgress(c,t,conversations)};
  },undefined,true);
 }
 protected async executionChannelProgress<T extends Record<string,unknown>>(_c:PoolClient,_t:AgentThread,conversations:T[]):Promise<T[]>{void _c;void _t;return conversations;}
 protected async invalidateNativeReviews(c:PoolClient,t:AgentThread,conversationId:string){
   const ids=(await c.query(`UPDATE agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=now() WHERE thread_id=$1 AND conversation_id=$2 AND name IN(${agentChannelMessageSqlNames}) AND state IN('proposed','approved') RETURNING id`,[t.id,conversationId])).rows.map(r=>r.id);
  if(ids.length)await c.query("UPDATE agent_review_batches b SET state='invalidated' WHERE b.thread_id=$1 AND b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item WHERE item->>'operationId'=ANY($2::text[]))",[t.id,ids]);
 }
 protected async revokePersonDelegations(c:PoolClient,t:AgentThread,conversationId:string,email:string|null){void conversationId;await c.query("UPDATE agent_authority_grants SET revoked_at=clock_timestamp(),revision=revision+1 WHERE thread_id=$1 AND revoked_at IS NULL AND recipient_keys ? $2",[t.id,'email:'+email]);}
 async controlResponsibility(threadId:string,key:string,raw:unknown){
  const input=controlSchema.parse(raw);
  return this.command(threadId,key,'control.'+input.action,input,async(c,t,commandId)=>{
   const mandate=(await c.query('SELECT xmin::text AS revision FROM mandates WHERE id=$1 AND organization_id=$2',[t.mandate_id,t.organization_id])).rows[0];
   if(mandate?.revision!==input.mandateRevision)throw new Error('Mandate changed; review the current goal before continuing');
   const prior=(await c.query('SELECT * FROM agent_responsibilities WHERE thread_id=$1 FOR UPDATE',[t.id])).rows[0];
   if((prior?.revision??0)!==input.expectedRevision)throw new Error('Agent control changed; refresh before continuing');
   if(!prior&&input.action!=='start')throw new Error('Start supervision before changing its state');
   const state=input.action==='pause'?'paused':'ready';
   const current=prior?(await c.query('UPDATE agent_responsibilities SET state=$2,revision=revision+1,mandate_revision=$3,next_wakeup_at=NULL,updated_at=now() WHERE id=$1 RETURNING *',[prior.id,state,mandate.revision])).rows[0]
    :(await c.query(`INSERT INTO agent_responsibilities(thread_id,organization_id,mandate_id,owner_user_id,state,mandate_revision)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,state,mandate.revision])).rows[0];
   await this.registerControlledRuntime(c,t,current);
   if(prior&&prior.mandate_revision!==mandate.revision)await c.query('UPDATE agent_authority_grants SET revoked_at=clock_timestamp(),revision=revision+1 WHERE thread_id=$1 AND revoked_at IS NULL',[t.id]);
   if(input.action==='pause'){
    await c.query("UPDATE agent_conversations SET phase='paused',pause_reason='supervisor_paused',epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,updated_at=now() WHERE thread_id=$1 AND driver_kind='agent' AND phase='active'",[t.id]);
   }else{
    const resumed=(await c.query(`UPDATE agent_conversations v SET phase='active',pause_reason=NULL,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=now()
     WHERE v.thread_id=$1 AND v.driver_kind='agent' AND v.phase='paused' AND v.pause_reason='supervisor_paused'
     AND v.pending_driver IS NULL AND v.engagement NOT IN('stopped','handoff')
     AND public.agent_mandate_person_has_unresolved_sends(v.mandate_id,v.contact_id,NULL::uuid)=false
     AND NOT EXISTS(SELECT 1 FROM agent_handoffs h WHERE h.conversation_id=v.id AND h.state NOT IN('dismissed','meeting_confirmed'))
     RETURNING v.id,v.recipient_email,v.epoch,v.reminder_generation`,[t.id])).rows;
    for(const person of resumed){
     await this.invalidateNativeReviews(c,t,person.id);await this.revokePersonDelegations(c,t,person.id,person.recipient_email);
     await this.emit(c,t,'supervisor-resumed:'+commandId+':'+person.id,'conversation.reassess',{conversationId:person.id,epoch:Number(person.epoch),reminderGeneration:person.reminder_generation});
    }
    // Starting an empty mandate launches its population workflow. Resuming an
    // already allocated population wakes its people, not a fresh research run.
    if(!(await c.query('SELECT 1 FROM agent_conversations WHERE thread_id=$1 LIMIT 1',[t.id])).rowCount)
     await this.emit(c,t,'supervise:'+current.id+':'+current.revision,'mandate.supervise',{responsibilityId:current.id,revision:current.revision});
   }
   const result={id:current.id as string,revision:current.revision as number,status:state};
   await this.controlNotice(c,t,'command-notice:'+commandId,input.action==='pause'?'Agent supervision is paused. Structured sequences keep their own controls.':'Agent supervision is ready. Outbound work still requires its current approval, ownership and budget checks.',result);return result;
  });
 }
 protected async checkTargetSelectionGuidance(_c:PoolClient,_t:AgentThread,_operationId:string){void _c;void _t;void _operationId;}
 async openConversation(threadId:string,key:string,raw:unknown,authority?:AgentExecutionFence,selection?:{operationId:string;sourceRevision:string}){
  const input=openSchema.parse(raw);
  const proof=selection?z.object({operationId:uuid,sourceRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(selection):undefined;
  return this.command(threadId,key,'conversation.open',proof?{...input,selection:proof}:input,async(c,t)=>{
   const responsibility=(await c.query("SELECT * FROM agent_responsibilities WHERE thread_id=$1 AND state IN('ready','waiting') FOR UPDATE",[t.id])).rows[0];
   if(!responsibility)throw new Error('Agent supervision is not active');
   // The scoped INSERT trigger performs the mandate/target membership check.
   // Avoid granting this role broader reads of mandate_targets.
   const contact=(await c.query('SELECT * FROM public.agent_delivery_contact_projection($1::uuid,$2::uuid)',[t.mandate_id,input.contactId])).rows[0];
   const email=outreachEmail(contact?.personal_data?.email);
   if(!contact||!email||contact.fictionalised!==false||contact.personal_data?.doNotContact===true)throw new Error('A permitted contact with a valid email is required');
   const unresolved=(await c.query('SELECT public.agent_mandate_person_has_unresolved_sends($1::uuid,$2::uuid,NULL::uuid) AS unresolved',[t.mandate_id,contact.id])).rows[0]?.unresolved;
   if(unresolved!==false)throw new Error('Reconcile unresolved sends before assigning a new driver');
   const occupied=(await c.query('SELECT public.agent_mandate_legacy_sequence_occupied($1::uuid,$2::uuid) AS occupied',[t.mandate_id,contact.id])).rows[0]?.occupied;
   if(occupied!==false)throw new Error('Existing sequence ownership needs an explicit reconciled handover');
   const identities=(await c.query('SELECT public.agent_mandate_person_keys($1::uuid,$2::uuid) AS identities',[t.mandate_id,contact.id])).rows[0].identities as string[];
   let bindingId:string|null=null,bindingDigest=digest({mode:'local_sink',organizationId:t.organization_id,userId:t.owner_user_id,version:1});
   if(input.deliveryMode==='communications'){
    const binding=(await c.query("SELECT * FROM communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 AND channel='email' AND backend='unipile' AND authority='service'",[input.bindingId,t.organization_id,t.owner_user_id])).rows[0];
    if(!binding)throw new Error('Recorded owned email binding required');bindingId=binding.id;bindingDigest=recordedAgentBindingDigest(binding);
   }
   if(proof){await this.checkTargetSelectionGuidance(c,t,proof.operationId);await c.query('SELECT agent_assert_target_allocation($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::uuid,$7)',[t.id,proof.operationId,contact.id,proof.sourceRevision,input.deliveryMode,bindingId,bindingDigest]);}
   const conversation=(await c.query(`INSERT INTO agent_conversations(thread_id,organization_id,mandate_id,owner_user_id,responsibility_id,contact_id,delivery_mode,binding_id,binding_digest,recipient_email,driver_kind,phase,history_revision,history_complete,history_source,history_observed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'agent','active',$11,$7='local_sink',CASE WHEN $7='local_sink' THEN 'local_fixture' ELSE 'unavailable' END,CASE WHEN $7='local_sink' THEN ${this.businessSql()} ELSE NULL END) RETURNING *`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,responsibility.id,contact.id,input.deliveryMode,bindingId,bindingDigest,email,digest([])])).rows[0];
   // The organisation-wide primary key rejects another actor/mandate even when
   // its claim is correctly invisible to this actor's RLS reads.
   for(const identity of identities)await c.query('INSERT INTO agent_person_claims(organization_id,identity_key,conversation_id,owner_user_id) VALUES($1,$2,$3,$4)',[t.organization_id,identity,conversation.id,t.owner_user_id]);
   await this.emit(c,t,'conversation:'+conversation.id+':1','conversation.reassess',{conversationId:conversation.id,epoch:1,reminderGeneration:1});
   return {id:conversation.id as string,revision:1,status:'active',epoch:1};
  },authority);
 }
 /** Eligibility is not decision or send authority. Full context is loaded after history. */
 async nativeConversationEligibility(threadId:string,conversationId:string){
  return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId);
   const row=(await c.query(`SELECT c.epoch,c.reminder_generation,c.driver_kind,c.phase,c.delivery_mode,EXISTS(SELECT 1 FROM agent_responsibilities r WHERE r.id=c.responsibility_id AND r.thread_id=c.thread_id AND r.state IN ('ready','waiting')) AS supervision_active FROM agent_conversations c WHERE c.id=$1 AND c.thread_id=$2`,[conversationId,t.id])).rows[0];
   if(!row)throw Error('Conversation not found');
   return {epoch:Number(row.epoch),reminderGeneration:row.reminder_generation,driver:row.driver_kind,phase:row.phase,deliveryMode:row.delivery_mode,supervisionActive:row.supervision_active};
  },undefined,true);
 }
 async conversation(threadId:string,conversationId:string){
  uuid.parse(conversationId);
  return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId);
   const row=(await c.query('SELECT c.*,agent_context_revision(c.id) AS context_revision FROM agent_conversations c WHERE c.id=$1 AND c.thread_id=$2',[conversationId,t.id])).rows[0];
   if(!row)throw new Error('Conversation not found');return row;
  },undefined,true);
 }
}
