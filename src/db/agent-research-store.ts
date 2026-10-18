import {loadApprovedAgentGuidance} from '@/lib/agent-guidance-snapshot';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {AgentHandoffStore} from './agent-handoff-store';
import {agentRecordDigest as digest,type AgentThread} from './agent-store';
import type {AgentExecutionFence} from './agent-execution-store';
import {readableStoredBrief} from '@/domain/stored-brief';
import {briefSchema} from '@/domain/acquisition';
import {nativeResearchAttemptSchema,nativeResearchProviderReceiptSchema} from '@/lib/agent-research-provider-request';
import {agentResearchPlanSchema,agentResearchContextRevision,buildAgentResearchPlan} from '@/lib/agent-research-plan';
const scopeSchema=z.object({responsibilityId:z.string().uuid(),responsibilityRevision:z.number().int().positive(),mandateRevision:z.string().regex(/^\d{1,30}$/)}).strict();
export class AgentResearchStore extends AgentHandoffStore{
 protected async checkReviewContext(c:PoolClient,t:AgentThread,op:Parameters<AgentHandoffStore['checkReviewContext']>[2]){
  await super.checkReviewContext(c,t,op);
  if(op.name!=='research.start'||op.input?.nativeResearchPlanVersion!==1)return;
  const plan=agentResearchPlanSchema.parse(op.input);
  const r=(await c.query('SELECT * FROM agent_responsibilities WHERE id=$1 AND thread_id=$2',[plan.responsibilityId,t.id])).rows[0];
  if(!r||!['ready','waiting'].includes(r.state)||r.revision!==plan.responsibilityRevision||r.mandate_revision!==plan.mandateRevision||plan.contextRevision!==agentResearchContextRevision({responsibilityId:r.id,responsibilityRevision:r.revision,mandateRevision:r.mandate_revision,...(plan.guidance?{guidance:plan.guidance}:{})}))throw new Error('Research supervision changed; review the current plan');
  const mandate=(await c.query('SELECT filters FROM mandates WHERE id=$1 AND organization_id=$2',[t.mandate_id,t.organization_id])).rows[0];
  const guidance=await loadApprovedAgentGuidance(c,t,{categories:['qualification']});
  const current=buildAgentResearchPlan({...(guidance.items.length?{guidance}:{}),responsibilityId:r.id,responsibilityRevision:r.revision,mandateRevision:r.mandate_revision,researchJobId:plan.config.requestId,brief:briefSchema.parse(readableStoredBrief(mandate?.filters?.brief))});
  if(digest(current)!==digest(plan))throw new Error('Native research plan changed outside the bounded planning policy; prepare a new plan');
 }
 protected async checkResearchRunContext(c:PoolClient,t:AgentThread,op:Parameters<AgentResearchStore['checkReviewContext']>[2]){await this.checkReviewContext(c,t,op);}
 protected async checkResearchProviderContext(c:PoolClient,t:AgentThread,op:Parameters<AgentResearchStore['checkReviewContext']>[2],_targetId?:string){void _targetId;await this.checkResearchRunContext(c,t,op);}
 protected nativeResearchSpecification(op:{name:string;input:unknown}):{config:{requestId:string};providerPolicy:{requestCeilingMicroUsd:string;maxAttempts:Record<'search'|'page'|'ai'|'firmable',number>}}{return agentResearchPlanSchema.parse(op.input);}
 async researchSupervisionContext(threadId:string){
  return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId),r=(await c.query('SELECT * FROM agent_responsibilities WHERE thread_id=$1',[t.id])).rows[0];
   const mandate=(await c.query('SELECT xmin::text AS revision FROM mandates WHERE id=$1 AND organization_id=$2',[t.mandate_id,t.organization_id])).rows[0];
   if(!mandate)throw new Error('Mandate unavailable');
   return {responsibility:r?{id:r.id as string,revision:r.revision as number,state:r.state as string,mandateRevision:r.mandate_revision as string}:null,mandateRevision:mandate.revision as string};
  });
 }
 async proposeResearchPlan(threadId:string,key:string,raw:unknown,authority?:AgentExecutionFence){
  const input=scopeSchema.parse(raw);
  return this.command(threadId,key,'research.plan',input,async(c,t,commandId)=>{
   const r=(await c.query('SELECT * FROM agent_responsibilities WHERE id=$1 AND thread_id=$2 FOR UPDATE',[input.responsibilityId,t.id])).rows[0];
   const mandate=(await c.query('SELECT xmin::text AS revision,filters FROM mandates WHERE id=$1 AND organization_id=$2',[t.mandate_id,t.organization_id])).rows[0];
   if(!r||!['ready','waiting'].includes(r.state)||r.revision!==input.responsibilityRevision||r.mandate_revision!==input.mandateRevision||mandate?.revision!==input.mandateRevision)throw new Error('Mandate or research supervision changed; review the current goal');
   const guidance=await loadApprovedAgentGuidance(c,t,{categories:['qualification']});
   const contextRevision=agentResearchContextRevision({...input,...(guidance.items.length?{guidance}:{})});
   const previous=(await c.query("SELECT o.*,b.id AS batch_id FROM agent_operations o JOIN agent_review_batches b ON b.thread_id=o.thread_id AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id)) WHERE o.thread_id=$1 AND o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1' AND o.input->>'contextRevision'=$2 ORDER BY o.created_at LIMIT 1",[t.id,contextRevision])).rows[0];
   if(previous)return {id:previous.id as string,revision:previous.revision as number,status:previous.state as string,reviewBatchId:previous.batch_id as string};
   const brief=briefSchema.parse(readableStoredBrief(mandate.filters?.brief));
   const value=buildAgentResearchPlan({...input,brief,researchJobId:randomUUID(),...(guidance.items.length?{guidance}:{})}),hash=digest({name:'research.start',input:value});
   const op=(await c.query(`INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest)
    VALUES($1,$2,$3,$4,$5,'research.start',$6,$7) RETURNING id,revision`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'native-research:'+commandId,JSON.stringify(value),hash])).rows[0];
   const manifest=[{operationId:op.id,revision:op.revision,digest:hash,contextRevision}];
   const batch=(await c.query(`INSERT INTO agent_review_batches(thread_id,organization_id,mandate_id,owner_user_id,request_key,manifest,manifest_digest)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'native-research-review:'+commandId,JSON.stringify(manifest),digest(manifest)])).rows[0];
   await c.query("UPDATE agent_responsibilities SET milestone='research_review',child_operations=child_operations||jsonb_build_array($2::text),updated_at=now() WHERE id=$1",[r.id,op.id]);
   await this.controlNotice(c,t,'research-plan:'+commandId,'I prepared a research plan from your confirmed mandate criteria. Review it before research starts; no provider request has been made.',{operationId:op.id,reviewBatchId:batch.id,researchJobId:value.config.requestId,contextRevision});
   await this.emit(c,t,'research-plan:'+op.id,'research.proposed',{operationId:op.id,reviewBatchId:batch.id});
   return {id:op.id as string,revision:op.revision as number,status:'proposed',reviewBatchId:batch.id as string};
  },authority);
 }
 async beginNativeResearchDispatch(threadId:string,operationId:string,authority?:AgentExecutionFence){
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority,'research-dispatch:'+operationId);
   const parent=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name IN('research.start','research.people') AND state='running' FOR UPDATE",[z.string().uuid().parse(operationId),t.id])).rows[0];
   if(!parent)throw new Error('Current launched research required');await this.checkResearchRunContext(c,t,parent);
   const status=(await c.query('SELECT agent_native_research_status($1::uuid) AS status',[parent.id])).rows[0]?.status;
   if(!['firmable-company-v1','firmable-people-v1'].includes(status?.nativeAgent?.providerAdmission)||['complete','partial','failed','cancelled'].includes(status.status))throw new Error('Research is not ready for supported dispatch');
   const key='native-research-dispatch:'+parent.id,prior=(await c.query('SELECT * FROM agent_operations WHERE thread_id=$1 AND request_key=$2 FOR UPDATE',[t.id,key])).rows[0];
   if(prior){if(prior.state==='complete')return {kind:'cached' as const,operationId:prior.id as string,jobId:status.jobId as string};throw new Error('Research dispatch requires receipt reconciliation; it was not resubmitted');}
   const input={researchOperationId:parent.id,researchJobId:status.jobId},op=(await c.query(`INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state,lease_until) VALUES($1,$2,$3,$4,$5,'research.worker_dispatch',$6,$7,'running',clock_timestamp()+interval '30 seconds') RETURNING id`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,key,JSON.stringify(input),digest({name:'research.worker_dispatch',input})])).rows[0];
   return {kind:'started' as const,operationId:op.id as string,jobId:status.jobId as string};
  });
 }
 async finishNativeResearchDispatch(threadId:string,operationId:string,accepted:boolean){
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId),op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='research.worker_dispatch' FOR UPDATE",[z.string().uuid().parse(operationId),t.id])).rows[0];
   if(!op)throw new Error('Research dispatch not found');
   if(op.state==='complete')return;
   await c.query('UPDATE agent_operations SET state=$2,result=$3,lease_until=NULL,updated_at=now() WHERE id=$1',[op.id,accepted?'complete':'uncertain',JSON.stringify({accepted,jobId:op.input.researchJobId})]);
   await this.controlNotice(c,t,'research-dispatch-result:'+op.id,accepted?'The research worker accepted the saved job. Research is running; results still require qualification review.':'Research dispatch acknowledgement is uncertain. Its saved handle needs reconciliation before another dispatch.',{operationId:op.id,jobId:op.input.researchJobId,accepted});
  });
 }
 async finishNativeResearchJob(threadId:string,operationId:string){
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId),op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name IN('research.start','research.people') FOR UPDATE",[z.string().uuid().parse(operationId),t.id])).rows[0];
   if(!op)throw new Error('Native research operation not found');
   const status=(await c.query('SELECT agent_native_research_status($1::uuid) AS status',[op.id])).rows[0]?.status;
   if(!status||!['complete','partial','failed','cancelled'].includes(status.status))throw new Error('Research has not reached a terminal result');
   if(op.state==='complete')return status;
   await this.checkResearchRunContext(c,t,op);
   await c.query("UPDATE agent_operations SET state='complete',result=$2,lease_until=NULL,updated_at=now() WHERE id=$1",[op.id,JSON.stringify(status)]);
   await c.query("UPDATE agent_responsibilities SET milestone=CASE WHEN $2='research.people' THEN 'target_review' ELSE 'qualification_review' END,updated_at=now() WHERE thread_id=$1",[t.id,op.name]);
   await this.controlNotice(c,t,'research-terminal:'+op.id,`${op.name==='research.people'?'Email contact enrichment':'Company research'} finished with status ${status.status}: ${status.companies} companies and ${status.contacts} contacts saved. Company fit and the next contact-enrichment phase require review. No outreach was sent.`,{operationId:op.id,...status});
   await this.emit(c,t,'research-completed:'+op.id,'research.completed',{operationId:op.id,researchJobId:status.jobId,status:status.status});return status;
  });
 }
 async nativeResearchExecutionAllowed(threadId:string,operationId:string){
  return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId),op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name IN('research.start','research.people') AND state='running'",[z.string().uuid().parse(operationId),t.id])).rows[0];
   if(!op)return false;
   await this.checkResearchRunContext(c,t,op);
   const status=(await c.query('SELECT agent_native_research_status($1::uuid) AS status',[op.id])).rows[0]?.status;
   return Boolean(status&&['firmable-company-v1','firmable-people-v1'].includes(status.nativeAgent?.providerAdmission)&&!['complete','partial','failed','cancelled'].includes(status.status));
  });
 }
 async beginNativeResearchAttempt(threadId:string,key:string,raw:unknown){
  const input=nativeResearchAttemptSchema.parse(raw),request='research-attempt:'+digest(z.string().min(1).max(200).parse(key)),hash=digest({name:'research.provider',input});
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);
   const prior=(await c.query('SELECT * FROM agent_operations WHERE thread_id=$1 AND request_key=$2 FOR UPDATE',[t.id,request])).rows[0];
   if(prior){
    if(prior.input_digest!==hash)throw new Error('Provider attempt key reused with different request');
    if(prior.state==='complete')return {kind:'cached' as const,response:prior.result.response};
    throw new Error('Provider attempt is running or uncertain; reconcile before another request');
   }
   const parent=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name IN('research.start','research.people') AND state='running' FOR UPDATE",[input.researchOperationId,t.id])).rows[0];
   if(!parent)throw new Error('Current launched research operation required');
   await this.checkResearchProviderContext(c,t,parent,input.targetId);const plan=this.nativeResearchSpecification(parent);
   if(plan.config.requestId!==input.researchJobId)throw new Error('Provider request belongs to another research job');
   const status=(await c.query('SELECT agent_native_research_status($1::uuid) AS status',[parent.id])).rows[0]?.status;
   if(!['firmable-company-v1','firmable-people-v1'].includes(status?.nativeAgent?.providerAdmission))throw new Error('Configure current provider limits and prepare supported research first');
   if(!status||status.jobId!==input.researchJobId||['complete','partial','failed','cancelled'].includes(status.status))throw new Error('Research job is stopped or unavailable');
   const count=(await c.query("SELECT count(*)::int AS n FROM agent_operations WHERE thread_id=$1 AND name='research.provider' AND input->>'researchOperationId'=$2 AND input->>'provider'=$3",[t.id,parent.id,input.provider])).rows[0]?.n;
   if(typeof count!=='number'||count>=plan.providerPolicy.maxAttempts[input.provider])throw new Error('Research physical attempt limit reached');
   const op=(await c.query(`INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state,lease_until)
    VALUES($1,$2,$3,$4,$5,'research.provider',$6,$7,'running',clock_timestamp()+interval '60 seconds') RETURNING *`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,JSON.stringify(input),hash])).rows[0];
   const keys=['organization','user:'+t.owner_user_id,'mandate:'+t.mandate_id].flatMap(scope=>['calls','usd_micro'].map(unit=>scope+':'+unit));
   const accounts=(await c.query("SELECT DISTINCT ON(scope_key) id,scope_key,unit FROM agent_budget_accounts WHERE organization_id=$1 AND scope_key=ANY($2::text[]) AND window_start<=clock_timestamp() AND window_end>clock_timestamp() ORDER BY scope_key,window_start DESC,id",[t.organization_id,keys])).rows;
   if(accounts.length!==6||accounts.some(a=>!a.scope_key.endsWith(':'+a.unit)))throw new Error('Configure organisation, user and mandate provider call/cost limits first');
   await c.query('SELECT agent_reserve_budget($1::uuid,$2::jsonb)',[op.id,JSON.stringify(accounts.map(a=>({accountId:a.id,amount:a.unit==='calls'?'1':plan.providerPolicy.requestCeilingMicroUsd})))]);
   return {kind:'started' as const,operationId:op.id as string,fence:String(op.fence)};
  });
 }
 async finishNativeResearchAttempt(threadId:string,operationId:string,fence:string,raw:unknown,expectedResearchOperationId?:string){
  z.string().uuid().parse(operationId);z.string().regex(/^\d+$/).parse(fence);const result=nativeResearchProviderReceiptSchema.parse(raw),receiptDigest=digest(result);
  if(Buffer.byteLength(JSON.stringify(result))>55000)throw new Error('Provider receipt exceeds bounded storage');
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId),op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='research.provider' AND fence=$3::bigint FOR UPDATE",[operationId,t.id,fence])).rows[0];
   if(!op||expectedResearchOperationId&&op.input.researchOperationId!==z.string().uuid().parse(expectedResearchOperationId))throw new Error('Research provider attempt fence changed');
   if(op.result?.receiptDigest){if(op.result.receiptDigest!==receiptDigest)throw new Error('Provider receipt changed');return op.result;}
   if(!['running','uncertain'].includes(op.state))throw new Error('Provider attempt cannot be completed');
   const reservations=(await c.query('SELECT r.account_id,a.unit FROM agent_budget_reservations r JOIN agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=$1 ORDER BY r.account_id',[op.id])).rows;
   if(reservations.length!==6)throw new Error('Exact recorded provider reservations required');
   await c.query('SELECT agent_settle_budget($1::uuid,$2::jsonb)',[op.id,JSON.stringify(reservations.map(r=>({accountId:r.account_id,actual:r.unit==='calls'?'1':result.actualCostMicroUsd})))]);
   const state=result.reason||result.actualCostMicroUsd===null?'uncertain':'complete',saved={...result,receiptDigest};
   await c.query('UPDATE agent_operations SET state=$2,result=$3,lease_until=NULL,updated_at=now() WHERE id=$1',[op.id,state,JSON.stringify(saved)]);
   await this.emit(c,t,'research-provider-receipt:'+op.id,'research.provider_accounted',{operationId:op.id,state,costBasis:result.costBasis});return saved;
  });
 }
 async persistApprovedResearchLaunch(threadId:string,operationId:string,authority?:AgentExecutionFence){
  z.string().uuid().parse(operationId);
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority,'research-launch:'+operationId);
   const op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='research.start' AND state IN('approved','running') FOR UPDATE",[operationId,t.id])).rows[0];
   if(!op)throw new Error('Current approved native research operation required');
   const plan=agentResearchPlanSchema.parse(op.input);await this.checkReviewContext(c,t,op);
   if(op.input_digest!==digest({name:op.name,input:plan}))throw new Error('Native research operation changed');
   const receiptSchema=z.object({jobId:z.string().uuid(),status:z.string(),dispatchReady:z.boolean(),blockedReason:z.enum(['budgeted_provider_adapter_required','provider_budget_required']).optional()}).strict();
   await c.query('SELECT agent_create_research_job($1::uuid) AS receipt',[op.id]);
   const receipt=receiptSchema.parse((await c.query('SELECT agent_prepare_firmable_research($1::uuid) AS receipt',[op.id])).rows[0]?.receipt);
   await c.query("UPDATE agent_operations SET state='running',result=$2,updated_at=now() WHERE id=$1",[op.id,JSON.stringify(receipt)]);
   await this.emit(c,t,'research-dispatch:'+op.id,'research.dispatch',{operationId:op.id,researchJobId:receipt.jobId});
   await this.controlNotice(c,t,'research-saved:'+op.id,'The approved research job is saved. Provider execution is waiting for budget admission; queued does not mean research completed.',{operationId:op.id,...receipt});
   return receipt;
  });
 }
 /** The approved proposal is inspectable but cannot dispatch until providers
  * share durable budget/cancellation admission. Never substitute a raw fetch. */
 async approvedResearchPlan(threadId:string,operationId:string){
  z.string().uuid().parse(operationId);
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId),op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='research.start' AND state='approved' FOR UPDATE",[operationId,t.id])).rows[0];
   if(!op)throw new Error('Current approved native research operation required');
   const plan=agentResearchPlanSchema.parse(op.input);await this.checkReviewContext(c,t,op);
   const exact=[{operationId:op.id,revision:op.revision,digest:op.input_digest,contextRevision:plan.contextRevision}];
   const batch=(await c.query("SELECT id FROM agent_review_batches WHERE thread_id=$1 AND state='approved' AND manifest @> $2::jsonb LIMIT 1",[t.id,JSON.stringify(exact)])).rows[0];
   if(!batch||op.input_digest!==digest({name:op.name,input:plan}))throw new Error('Exact current native research approval required');
   return {operationId:op.id as string,reviewBatchId:batch.id as string,plan,dispatchReady:false as const,blockedReason:'budgeted_provider_adapter_required' as const};
  });
 }
}
