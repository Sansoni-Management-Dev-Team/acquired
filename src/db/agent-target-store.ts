import type {AgentReviewContextOperation} from './agent-review-context';
import {loadMandateExecutionContext} from '@/lib/mandate-execution-context';
import {agentPersonChannelRecipientSchema} from '@/domain/agent-person-channel';
import {loadApprovedAgentGuidance} from '@/lib/agent-guidance-snapshot';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {AgentResearchStore} from './agent-research-store';
import {agentRecordDigest as digest,type AgentThread} from './agent-store';
import type {AgentExecutionFence} from './agent-execution-store';
import {recordedAgentBindingDigest} from './agent-execution-store';
import {briefSchema} from '@/domain/acquisition';
import {readableStoredBrief} from '@/domain/stored-brief';
import {emptyAgentTargetText} from '@/lib/agent-target-empty-notice';
import {agentTargetDeliverySchema,buildAgentTargetSelection,type AgentTargetContext,type AgentTargetDelivery} from '@/lib/agent-target-supervisor';
const uuid=z.string().uuid();
type AllocationFailureCategory='database_busy'|'allocation_timeout'|'authorization_changed'|'saved_context_conflict'|'allocation_needs_review';
/** Error text and arbitrary codes may contain recipient/provider data. Only
 * known SQL states become diagnostics; accessors never run for logging. */
function allocationFailureCategory(cause:unknown):AllocationFailureCategory{
 try{
  const property=cause&&typeof cause==='object'?Object.getOwnPropertyDescriptor(cause,'code'):undefined;
  const code=property&&'value'in property?property.value:undefined;
  if(['40001','40P01','55P03'].includes(code))return 'database_busy';
  if(code==='57014')return 'allocation_timeout';
  if(code==='42501')return 'authorization_changed';
  if(['23503','23505','23514'].includes(code))return 'saved_context_conflict';
 }catch{/* Opaque/hostile errors still have a safe generic outcome. */}
 return 'allocation_needs_review';
}
export class AgentTargetStore extends AgentResearchStore{
 private async targetContext(c:PoolClient,t:AgentThread,ids?:string[]):Promise<AgentTargetContext>{
  const context=(await c.query('SELECT agent_owned_target_snapshot($1::uuid,$2::uuid[]) AS snapshot',[t.id,ids??null])).rows[0].snapshot;
  const guidance=await loadApprovedAgentGuidance(c,t,{categories:['qualification']});
  return {...context,...(guidance.items.length?{guidance}:{}),brief:briefSchema.parse(readableStoredBrief(context.brief))};
 }
 private async channelTargetContext(c:PoolClient,t:AgentThread,context:AgentTargetContext,policyRevision:number){
  const policy=(await c.query('SELECT * FROM agent_channel_policies WHERE thread_id=$1',[t.id])).rows[0];if(!policy||policy.revision!==policyRevision)throw Error('Review the current channel policy before selecting contacts');
  const contacts=(await c.query('SELECT id,xmin::text AS revision,personal_data FROM contacts WHERE id=ANY($1::uuid[]) AND organization_id=$2',[context.candidates.map(x=>x.contactId),t.organization_id])).rows;
  const bindings=(await c.query('SELECT * FROM communication_bindings WHERE organization_id=$1 AND owner_user_id=$2 AND id=ANY($3::uuid[])',[t.organization_id,t.owner_user_id,policy.bindings.map((x:{bindingId:string})=>x.bindingId)])).rows;
  const candidates=[];
  for(const candidate of context.candidates){if(candidate.blockedReasons.length){candidates.push({...candidate,channels:[]});continue;}const person=contacts.find(p=>p.id===candidate.contactId);const channels=[];const execution=await loadMandateExecutionContext(c,{actor:{organizationId:t.organization_id,userId:t.owner_user_id},origin:{kind:'agent_target',threadId:t.id,contactId:candidate.contactId}});
   for(const channel of policy.channel_order as Array<'email'|'whatsapp'|'linkedin'>){const ref=policy.bindings.find((x:{channel:string})=>x.channel===channel),b=bindings.find(b=>b.id===ref?.bindingId);if(!person||!b||recordedAgentBindingDigest(b)!==ref.bindingDigest||!execution.allowedBindings.some(x=>x.id===b.id&&x.digest===ref.bindingDigest&&x.channel===channel))throw Error('Exact reviewed channel account changed');
    const value=execution.contact.effectiveRecipients[channel];
    const parsed=agentPersonChannelRecipientSchema.safeParse({channel,recipient:{kind:channel==='email'?'email':channel==='whatsapp'?'phone':'linkedin_profile',value}});
    if(!parsed.success)continue;channels.push({...parsed.data,bindingId:b.id as string,bindingDigest:ref.bindingDigest as string,identityProof:{kind:'recorded_contact' as const,revision:execution.contact.sourceRevision},senderLabel:[b.channel,b.platform,b.service_account_id].join(' · ')});
   }
   candidates.push({...candidate,channels,blockedReasons:[...candidate.blockedReasons,...(channels.length!==policy.channel_order.length?['selected_channel_identity_missing']:[])]});
  }return {...context,candidates};
 }
 async targetDeliveryOptions(mandateId:string){return this.nativeTransaction(async c=>{
  if(!(await c.query('SELECT id FROM mandates WHERE id=$1 AND organization_id=$2',[uuid.parse(mandateId),this.actor.organizationId])).rowCount)throw new Error('Mandate unavailable');
  const rows=(await c.query("SELECT id,platform,service_account_id FROM communication_bindings WHERE organization_id=$1 AND owner_user_id=$2 AND channel='email' AND backend='unipile' AND authority='service' AND public.agent_allowed_mandate_binding($3::uuid,id) ORDER BY created_at,id LIMIT 100",[this.actor.organizationId,this.actor.userId,mandateId])).rows;
  return {simulationEnabled:process.env.AGENT_LOCAL_SIMULATION_ENABLED==='true',bindings:rows.map(row=>({id:row.id as string,label:String(row.platform)+' · '+String(row.service_account_id)+' · recorded account'}))};
 });}
 async targetSelectionContext(threadId:string){return this.nativeTransaction(async c=>this.targetContext(c,await this.thread(c,threadId)));}
 protected async checkReviewContext(c:PoolClient,t:AgentThread,op:AgentReviewContextOperation){
  await super.checkReviewContext(c,t,op);if(op.name!=='target.select')return;
  const plan=op.input as ReturnType<typeof buildAgentTargetSelection>,delivery=agentTargetDeliverySchema.parse(plan.delivery),context=await this.targetContext(c,t,plan.selected.map(item=>uuid.parse(item.contactId)));
  if(digest(context.guidance??null)!==digest(plan.guidance??null))throw new Error('Approved qualification guidance changed; review current contacts');
  if(context.mandateRevision!==plan.mandateRevision||context.responsibilityId!==plan.responsibilityId||context.responsibilityRevision!==plan.responsibilityRevision||context.candidates.length!==plan.selected.length||plan.selected.some(item=>!context.candidates.some(current=>current.contactId===item.contactId&&current.sourceRevision===item.sourceRevision&&current.blockedReasons.length===0)))throw new Error('Target facts, ownership or supervision changed; review current contacts');
  if(delivery.mode==='channels'){
   const current=await this.channelTargetContext(c,t,context,delivery.policyRevision);
   if(plan.selected.some(item=>digest(item.channels)!==digest(current.candidates.find(x=>x.contactId===item.contactId)?.channels)))throw Error('Reviewed channel identities or accounts changed');
  }
  if(delivery.mode==='communications'){
   const binding=(await c.query("SELECT * FROM communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 AND channel='email' AND backend='unipile' AND authority='service'",[delivery.bindingId,t.organization_id,t.owner_user_id])).rows[0];
   if(!binding||recordedAgentBindingDigest(binding)!==delivery.bindingDigest)throw new Error('Approved email account changed');
  }
 }
 async proposeTargetSelection(threadId:string,key:string,rawDelivery:unknown,authority?:AgentExecutionFence){
  const requested=z.discriminatedUnion('mode',[z.object({mode:z.literal('channels'),policyRevision:z.number().int().positive()}).strict(),z.object({mode:z.literal('local_sink')}).strict(),z.object({mode:z.literal('communications'),bindingId:uuid}).strict()]).parse(rawDelivery);
  if(requested.mode==='local_sink'&&process.env.AGENT_LOCAL_SIMULATION_ENABLED!=='true')throw new Error('Explicit server local simulation mode is required');
  return this.command(threadId,key,'target.selection_plan',requested,async(c,t,commandId)=>{
   // Demo mode never derives routes from the real source contact. Until its
   // separate immutable CLI mapping is admitted, do not even propose them.
   await c.query('SELECT public.agent_assert_mandate_outreach_mode($1::uuid)',[t.mandate_id]);
   let delivery:AgentTargetDelivery=requested.mode==='communications'?{...requested,bindingDigest:''}:requested;
   if(requested.mode==='communications'){
    const binding=(await c.query("SELECT * FROM communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 AND channel='email' AND backend='unipile' AND authority='service'",[requested.bindingId,t.organization_id,t.owner_user_id])).rows[0];
    if(!binding)throw new Error('Explicit original owned email account required');delivery={...requested,bindingDigest:recordedAgentBindingDigest(binding)};
   }
   const baseContext=await this.targetContext(c,t),context=delivery.mode==='channels'?await this.channelTargetContext(c,t,baseContext,delivery.policyRevision):baseContext,plan=buildAgentTargetSelection(context,delivery);
   if(!plan.selected.length){
    const outcomeKey=digest({contextRevision:plan.contextRevision,counts:plan.counts,excluded:plan.excluded,sources:context.candidates.map(person=>[person.contactId,person.sourceRevision])});
    await this.controlNotice(c,t,'target-empty:'+outcomeKey,emptyAgentTargetText,{counts:plan.counts,excluded:plan.excluded});
    return {id:context.responsibilityId,revision:context.responsibilityRevision,status:'needs_review'};
   }
   // Reuse live review/execution only. A fresh explicit human request may review
   // currently eligible contacts after an old partial/rejected/invalidated
   // batch; the old command key, review and allocation receipts stay immutable.
   const previous=(await c.query("SELECT o.id,o.revision,o.state,b.id AS batch_id FROM agent_operations o JOIN agent_review_batches b ON b.thread_id=o.thread_id AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id)) WHERE o.thread_id=$1 AND o.name='target.select' AND o.input->>'contextRevision'=$2 AND o.state IN('proposed','approved','running') AND b.state IN('pending','approved') LIMIT 1",[t.id,plan.contextRevision])).rows[0];
   if(previous)return {id:previous.id as string,revision:previous.revision as number,status:previous.state as string,reviewBatchId:previous.batch_id as string};
   const hash=digest({name:'target.select',input:plan}),op=(await c.query("INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest) VALUES($1,$2,$3,$4,$5,'target.select',$6,$7) RETURNING id,revision",[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'target-selection:'+commandId,JSON.stringify(plan),hash])).rows[0],manifest=[{operationId:op.id,revision:op.revision,digest:hash,contextRevision:plan.contextRevision}];
   const batch=(await c.query('INSERT INTO agent_review_batches(thread_id,organization_id,mandate_id,owner_user_id,request_key,manifest,manifest_digest) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'target-review:'+commandId,JSON.stringify(manifest),digest(manifest)])).rows[0];
   await c.query("UPDATE agent_responsibilities SET milestone='target_review',updated_at=now() WHERE id=$1",[context.responsibilityId]);
   await this.controlNotice(c,t,'target-plan:'+commandId,`Review ${plan.selected.length} cached contacts for agent-managed conversations. Missing or estimated mandate fit is labelled in the proposal. No email has been approved or sent.`,{reviewBatchId:batch.id,operationId:op.id,counts:plan.counts});await this.emit(c,t,'target-proposed:'+op.id,'target.proposed',{operationId:op.id,reviewBatchId:batch.id});
   return {id:op.id as string,revision:op.revision as number,status:'proposed',reviewBatchId:batch.id as string};
  },authority);
 }
 protected async checkTargetSelectionGuidance(c:PoolClient,t:AgentThread,operationId:string){const op=(await c.query("SELECT input FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='target.select'",[operationId,t.id])).rows[0];const current=await loadApprovedAgentGuidance(c,t,{categories:['qualification']});if(!op||digest(op.input.guidance??null)!==digest(current.items.length?current:null))throw new Error('Approved qualification guidance changed before allocation');}
 async allocateApprovedTargets(threadId:string,operationId:string,authority?:AgentExecutionFence){
  const plan=await this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority);
   const op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='target.select' AND state IN('approved','running','complete') FOR UPDATE",[uuid.parse(operationId),t.id])).rows[0];
   if(!op)throw new Error('Approved target selection required');if(op.state==='complete')return {complete:true as const,result:op.result};
   const value=op.input as ReturnType<typeof buildAgentTargetSelection>;if(digest({name:op.name,input:value})!==op.input_digest)throw new Error('Target proposal changed');
   if(value.delivery.mode==='local_sink'&&process.env.AGENT_LOCAL_SIMULATION_ENABLED!=='true')throw new Error('Explicit local simulation mode is disabled');
   await c.query("UPDATE agent_operations SET state='running',updated_at=now() WHERE id=$1",[op.id]);return {complete:false as const,value,trace:{mandateId:t.mandate_id,threadId:t.id,operationId:op.id as string}};
  });if(plan.complete)return plan.result;
  const results:{contactId:string;status:string;conversationId?:string;failureCategory?:AllocationFailureCategory}[]=[];
  for(const contact of plan.value.selected){
   try{if(plan.value.delivery.mode==='channels'){
    const result=await this.command(threadId,'target:'+operationId+':'+contact.contactId,'conversation.open_channels',{operationId,contactId:contact.contactId,sourceRevision:contact.sourceRevision},async(c,t)=>{await this.checkTargetSelectionGuidance(c,t,operationId);const row=(await c.query('SELECT public.agent_allocate_channel_target($1::uuid,$2::uuid,$3::uuid,$4) AS conversation',[t.id,operationId,contact.contactId,contact.sourceRevision])).rows[0].conversation;await this.emit(c,t,'conversation:'+row.id+':channels','conversation.reassess',{conversationId:row.id,epoch:row.epoch,reminderGeneration:row.reminderGeneration});return {id:row.id as string,revision:row.revision as number,status:'active'};},authority);
    results.push({contactId:contact.contactId,status:'allocated',conversationId:result.id});continue;
   }const input=plan.value.delivery.mode==='local_sink'?{contactId:contact.contactId,deliveryMode:'local_sink'}:{contactId:contact.contactId,deliveryMode:'communications',bindingId:plan.value.delivery.bindingId};const result=await this.openConversation(threadId,'target:'+operationId+':'+contact.contactId,input,authority,{operationId,sourceRevision:contact.sourceRevision});results.push({contactId:contact.contactId,status:'allocated',conversationId:result.id});}
   catch(cause){
    const failureCategory=allocationFailureCategory(cause);
    results.push({contactId:contact.contactId,status:'needs_review',failureCategory});
    try{console.warn(JSON.stringify({module:'agent-target-allocation',stage:'contact_allocation_failed',...plan.trace,category:failureCategory}));}catch{/* Diagnostics never change the saved allocation outcome. */}
   }
  }
  return this.nativeTransaction(async c=>{const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority);const op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 FOR UPDATE",[operationId,t.id])).rows[0];if(op.state==='complete')return op.result;
   const result={results,allocated:results.filter(item=>item.status==='allocated').length,needsReview:results.filter(item=>item.status==='needs_review').length};
   await c.query("UPDATE agent_operations SET state='complete',result=$2,updated_at=now() WHERE id=$1",[op.id,JSON.stringify(result)]);await c.query("UPDATE agent_responsibilities SET milestone=$2,updated_at=now() WHERE id=$1",[plan.value.responsibilityId,result.needsReview?'target_allocation_review':'conversations_active']);
   await this.controlNotice(c,t,'target-result:'+op.id,`${result.allocated} contacts allocated to agent-managed conversations; ${result.needsReview} need individual review. No email was sent by this allocation.`,{operationId:op.id,...result});await this.emit(c,t,'target-allocated:'+op.id,'target.allocated',{operationId:op.id,...result});return result;
  });
 }
}
