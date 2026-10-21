import type {AgentReviewContextOperation} from './agent-review-context';
import {buildHybridCompanyContinuationSource,hybridCompanyContinuationSchema,selectHybridCompanyContinuation,type HybridCompanyContinuationReview} from '@/domain/hybrid-company-continuation';
import{researchPhaseExposure,researchPhaseFunding}from'@/lib/agent-research-budget';
import{agentFieldsPlanSchema,buildAgentFieldsPlan,type AgentFieldsPlan}from'@/lib/agent-fields-plan';
import{nativeFieldsCompany}from'@/lib/agent-fields-source';
import {nativeResearchEngineCapability,requireNativeResearchEngine} from '@/lib/agent-research-engine';
import {loadApprovedAgentGuidance} from '@/lib/agent-guidance-snapshot';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {AgentHandoffStore} from './agent-handoff-store';
import {agentRecordDigest as digest,type AgentThread} from './agent-store';
import type {AgentExecutionFence} from './agent-execution-store';
import {readableStoredBrief} from '@/domain/stored-brief';
import {briefSchema,briefToMandate,criterion,searchReadiness} from '@/domain/acquisition';
import {nativeResearchAttemptSchema,nativeResearchProviderReceiptSchema} from '@/lib/agent-research-provider-request';
import {agentResearchPlanSchema,agentResearchContextRevision,buildAgentResearchPlan} from '@/lib/agent-research-plan';
const HYBRID_PREPARATION='public.agent_prepare_hybrid_native_research(uuid)';
const scopeSchema=z.object({responsibilityId:z.string().uuid(),responsibilityRevision:z.number().int().positive(),mandateRevision:z.string().regex(/^\d{1,30}$/),companyContinuation:hybridCompanyContinuationSchema.optional()}).strict();
export class AgentResearchStore extends AgentHandoffStore{
 protected async reviewBudgetProjection(c:PoolClient,t:AgentThread,op:{id:string;name:string;input:unknown}){
  if(!['research.start','research.people','research.fields'].includes(op.name))return undefined;
  try{this.nativeResearchSpecification(op);}catch{return undefined;}
  const exposure=researchPhaseExposure(op),accounts=(await c.query('SELECT * FROM agent_budget_accounts WHERE organization_id=$1',[t.organization_id])).rows,projection=researchPhaseFunding({organizationId:t.organization_id,userId:t.owner_user_id,mandateId:t.mandate_id},exposure,accounts);
  const installed=(await c.query("SELECT to_regprocedure('public.agent_research_phase_budget_status(uuid)') IS NOT NULL AS installed")).rows[0]?.installed;
  const phase=installed?(await c.query('SELECT public.agent_research_phase_budget_status($1) AS value',[op.id])).rows[0].value:null;
  return{...projection,funded:phase?.ready===true};
 }
 protected async fundResearchLaunch(c:PoolClient,t:AgentThread,op:{id:string;name:string},receipt:{jobId:string;status:string;dispatchReady:boolean}){
  if(!receipt.dispatchReady){const current=(await c.query('SELECT name,input FROM agent_operations WHERE id=$1 AND thread_id=$2',[op.id,t.id])).rows[0];const sql=current.name==='research.fields'?'SELECT public.agent_create_fields_job($1) AS receipt':current.name==='research.people'?'SELECT public.agent_create_people_job($1) AS receipt':current.input.execution.productionPipeline==='hybrid-firmable-v1'?'SELECT public.agent_prepare_hybrid_native_research($1) AS receipt':'SELECT public.agent_prepare_firmable_research($1) AS receipt';receipt=(await c.query(sql,[op.id])).rows[0].receipt;}
  const funding=(await c.query('SELECT public.agent_reserve_research_phase($1) AS value',[op.id])).rows[0].value;
  const saved={...receipt,dispatchReady:receipt.dispatchReady&&funding.ready===true,blockedReason:funding.ready===true?undefined:'phase_funding_required',funding};
  await c.query("UPDATE agent_operations SET state='running',result=$2,updated_at=now() WHERE id=$1",[op.id,JSON.stringify(saved)]);
  if(saved.dispatchReady)await this.emit(c,t,'research-dispatch:'+op.id,op.name==='research.fields'?'fields.dispatch':op.name==='research.people'?'people.dispatch':'research.dispatch',{operationId:op.id,researchJobId:receipt.jobId});
  else await this.controlNotice(c,t,'research-funding:'+op.id,'The approved research job is saved and waiting for its full phase reserve. Review the budget request in chat, then continue this saved job. No provider request was started.',{operationId:op.id,jobId:receipt.jobId,funding});
  return saved;
 }
 protected async assertResearchEngineInstalled(c:PoolClient,engine:string,discoveryPolicyVersion?:number){
  if(engine!=='hybrid-firmable-v1')return;
  if((await c.query('SELECT to_regprocedure($1) IS NOT NULL AS installed',[HYBRID_PREPARATION])).rows[0]?.installed!==true)throw Error('The configured company research workflow is not ready in agent mode. You can run research from the main workspace. No new research was started.');
  if(discoveryPolicyVersion===5&&(await c.query("SELECT bool_and(to_regprocedure(signature) IS NOT NULL) AS installed FROM unnest($1::text[]) signature",[['public.agent_research_v5_scope(jsonb)','public.agent_automatic_people_context(uuid,uuid,text)','public.agent_assert_automatic_people_target(uuid,uuid)','public.agent_record_automatic_people_candidates(uuid,uuid,jsonb)','public.agent_save_automatic_people_profile(uuid,uuid,jsonb)']])).rows[0]?.installed!==true)throw Error('Company and basic People research is not available yet. The specifically approved schema update is required; no company-only substitute was started.');
 }

 protected async checkReviewContext(c:PoolClient,t:AgentThread,op:AgentReviewContextOperation,checkContinuation=true){
  await super.checkReviewContext(c,t,op);
  if(op.name==='research.fields'){const plan=agentFieldsPlanSchema.parse(op.input),current=await this.fieldsSnapshot(c,t,plan.sourceRootId,plan.selected.map(s=>s.targetId),('id'in op?op.id:undefined)as string|undefined);if(digest(buildAgentFieldsPlan({...current,researchJobId:plan.config.requestId}))!==digest(plan))throw Error('Saved public companies or field supervision changed; review again');return;}
  if(op.name!=='research.start'||op.input?.nativeResearchPlanVersion!==1)return;
  const plan=agentResearchPlanSchema.parse(op.input);await this.assertResearchEngineInstalled(c,plan.execution.productionPipeline,plan.config.companyDiscoveryPolicy?.version);
  const r=(await c.query('SELECT * FROM agent_responsibilities WHERE id=$1 AND thread_id=$2',[plan.responsibilityId,t.id])).rows[0];
  if(!r||!['ready','waiting'].includes(r.state)||r.revision!==plan.responsibilityRevision||r.mandate_revision!==plan.mandateRevision||plan.contextRevision!==agentResearchContextRevision({productionPipeline:requireNativeResearchEngine().productionPipeline,...(plan.config.companyContinuation?{companyContinuation:plan.config.companyContinuation}:{}),...(plan.config.companyIdentityPolicyVersion===1?{companyIdentityPolicyVersion:1 as const}:{}),...(plan.config.companyDiscoveryPolicy?{discoveryPolicyVersion:plan.config.companyDiscoveryPolicy.version}:{}),responsibilityId:r.id,responsibilityRevision:r.revision,mandateRevision:r.mandate_revision,...(plan.guidance?{guidance:plan.guidance}:{})}))throw new Error('Research supervision changed; review the current plan');
  const mandate=(await c.query('SELECT filters FROM mandates WHERE id=$1 AND organization_id=$2',[t.mandate_id,t.organization_id])).rows[0];
  const guidance=await loadApprovedAgentGuidance(c,t,{categories:['qualification']});
  const current=buildAgentResearchPlan({... (plan.config.companyContinuation?{companyContinuation:plan.config.companyContinuation}:{}),productionPipeline:requireNativeResearchEngine().productionPipeline,discoveryPolicyVersion:plan.config.companyDiscoveryPolicy?.version??1,companyIdentityPolicyVersion:plan.config.companyIdentityPolicyVersion===1?1:0,...(guidance.items.length?{guidance}:{}),responsibilityId:r.id,responsibilityRevision:r.revision,mandateRevision:r.mandate_revision,researchJobId:plan.config.requestId,brief:briefSchema.parse(readableStoredBrief(mandate?.filters?.brief))});
  if(digest(current)!==digest(plan))throw new Error('Native research plan changed outside the bounded planning policy; prepare a new plan');
  if(checkContinuation&&plan.config.companyContinuation)await this.companyContinuationSnapshot(c,t,plan.config.companyContinuation,('id' in op?op.id:undefined) as string|undefined);
 }
 protected async checkResearchRunContext(c:PoolClient,t:AgentThread,op:AgentReviewContextOperation,checkContinuation=true){
  if(op.name!=='research.fields'){await this.checkReviewContext(c,t,op,checkContinuation);return;}
  const plan=agentFieldsPlanSchema.parse(op.input),r=(await c.query('SELECT r.*,m.xmin::text AS current_mandate_revision FROM agent_responsibilities r JOIN mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.thread_id=$1',[t.id])).rows[0],guidance=await loadApprovedAgentGuidance(c,t,{categories:['qualification']});
  if(!r||!['ready','waiting'].includes(r.state)||r.id!==plan.responsibilityId||r.revision!==plan.responsibilityRevision||r.mandate_revision!==plan.mandateRevision||r.current_mandate_revision!==plan.mandateRevision||digest(plan.guidance??null)!==digest(guidance.items.length?guidance:null))throw Error('Public-field supervision, mandate or approved guidance changed');
 }
 protected async checkResearchProviderContext(c:PoolClient,t:AgentThread,op:AgentReviewContextOperation,_targetId?:string){await this.checkResearchRunContext(c,t,op);if(op.name==='research.fields'){const plan=agentFieldsPlanSchema.parse(op.input),selected=plan.selected.find(s=>s.targetId===_targetId);if(!selected)throw Error('Physical public read needs its exact reviewed company');const snapshot=await this.fieldsSnapshot(c,t,plan.sourceRootId,[selected.targetId],('id'in op?op.id:undefined)as string|undefined),current=snapshot.companies[0];if(!current||current.sourceRevision!==selected.sourceRevision||current.blockedReasons.length)throw Error('Saved public company changed before physical read');}}
 protected nativeResearchSpecification(op:{name:string;input:unknown}):{config:{requestId:string};providerPolicy:{requestCeilingMicroUsd:string;maxAttempts:Record<'search'|'page'|'ai'|'firmable',number>}}{return op.name==='research.fields'?agentFieldsPlanSchema.parse(op.input):agentResearchPlanSchema.parse(op.input);}
 protected async companyContinuationSources(c:PoolClient,t:AgentThread,sourceRootId?:string):Promise<Array<{id:string;status:string;config:unknown;claimedKeys:string[];children:Array<{id:string;config:Record<string,unknown>}>}>>{
  const installed=(await c.query("SELECT to_regprocedure('public.agent_company_continuation_sources(uuid,uuid)') IS NOT NULL AS installed")).rows[0]?.installed;
  if(!installed){if(sourceRootId)throw Error('The scoped company continuation reader is not available yet');return[];}
  // The restricted agent role never receives direct research_jobs access. This
  // owned reader returns bounded source evidence only inside the existing gate.
  return(await c.query('SELECT public.agent_company_continuation_sources($1::uuid,$2::uuid) AS sources',[t.id,sourceRootId??null])).rows[0].sources;
 }
 protected async companyContinuationSnapshot(c:PoolClient,t:AgentThread,review:HybridCompanyContinuationReview,operationId?:string){
  const sources=await this.companyContinuationSources(c,t,review.sourceRootId),source=sources.find(row=>row.id===review.sourceRootId);
  if(!source)throw Error('Owned saved company source required');
  const selected=selectHybridCompanyContinuation(await buildHybridCompanyContinuationSource({sourceRootId:source.id,status:source.status,config:source.config}),review);
  if(Buffer.byteLength(JSON.stringify(selected))>1024*1024)throw Error('Saved company continuation exceeds a worker checkpoint; review a smaller selection');
  if(operationId)await c.query('SELECT public.agent_assert_company_continuation($1)',[operationId]);
  return selected;
 }
 async researchContinuationOptions(threadId:string):Promise<HybridCompanyContinuationReview[]>{return this.nativeTransaction(async c=>{
  const t=await this.thread(c,threadId),sources=await this.companyContinuationSources(c,t);
  const options:HybridCompanyContinuationReview[]=[];
  for(const row of sources){
   let source;try{source=await buildHybridCompanyContinuationSource({sourceRootId:row.id,status:row.status,config:row.config});}catch{continue;}
   const claimed=new Set(row.claimedKeys);
   const candidateKeys=source.candidates.filter(candidate=>{
    if(claimed.has(candidate.candidateKey!))return false;
    const h=createHash('sha256').update(`${row.id}:firmable:${candidate.candidateKey}`).digest('hex'),childId=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
    return !row.children.some(child=>child.id===childId||candidate.firmableRow&&(child.config.firmableCompanyId===candidate.firmableRow.id||child.config.hybridFirmableId===candidate.firmableRow.id)||candidate.domain&&(child.config.hybridExpectedDomain===candidate.domain||child.config.companyDomain===candidate.domain));
   }).map(candidate=>candidate.candidateKey!);
   if(candidateKeys.length)options.push(hybridCompanyContinuationSchema.parse({version:1,sourceRootId:source.sourceRootId,sourceDigest:source.sourceDigest,candidateKeys}));
  }
  return options;
 });}
 async nativeCompanyContinuation(threadId:string,operationId:string){return this.nativeTransaction(async c=>{
  const t=await this.lockThread(c,threadId),op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='research.start' AND state='running'",[z.string().uuid().parse(operationId),t.id])).rows[0];
  if(!op)throw Error('Current launched company continuation required');
  await this.checkResearchRunContext(c,t,op);
  const meta=agentResearchPlanSchema.parse(op.input).config.companyContinuation;if(!meta)throw Error('Reviewed company continuation required');
  return this.companyContinuationSnapshot(c,t,meta,op.id);
 });}
 async researchFundingState(threadId:string){return this.nativeTransaction(async c=>{const t=await this.thread(c,threadId),ops=(await c.query("SELECT * FROM agent_operations WHERE thread_id=$1 AND name IN('research.start','research.people','research.fields') AND state IN('approved','running') ORDER BY created_at LIMIT 20",[t.id])).rows;return Promise.all(ops.map(async op=>({operationId:op.id as string,name:op.name as string,revision:op.revision as number,contextRevision:op.input.contextRevision as string,jobId:op.result?.jobId as string|undefined,funding:await this.reviewBudgetProjection(c,t,op),canContinue:Boolean(op.result?.jobId&&!(await c.query("SELECT 1 FROM agent_operations WHERE thread_id=$1 AND name IN('research.worker_dispatch','research.provider') AND input->>'researchOperationId'=$2 LIMIT 1",[t.id,op.id])).rowCount)})));});}
 async continueResearchFunding(threadId:string,key:string,raw:unknown){const input=z.object({operationId:z.string().uuid(),revision:z.number().int().positive(),contextRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(raw);return this.command(threadId,key,'research.fund',input,async(c,t)=>{const op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name IN('research.start','research.people','research.fields') AND state='running' FOR UPDATE",[input.operationId,t.id])).rows[0];if(!op||op.revision!==input.revision||op.input.contextRevision!==input.contextRevision||!op.result?.jobId)throw Error('Exact saved approved research job required');await this.checkReviewContext(c,t,op);if((await c.query("SELECT 1 FROM agent_operations WHERE thread_id=$1 AND name IN('research.worker_dispatch','research.provider') AND input->>'researchOperationId'=$2 LIMIT 1",[t.id,op.id])).rowCount)throw Error('Original worker or provider attempts require reconciliation, not another dispatch');const receipt=await this.fundResearchLaunch(c,t,op,op.result);return{id:op.id as string,revision:op.revision as number,status:receipt.dispatchReady?'funded':'funding_required'};});}
 async researchSupervisionContext(threadId:string){
  return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId),r=(await c.query('SELECT * FROM agent_responsibilities WHERE thread_id=$1',[t.id])).rows[0];
   const mandate=(await c.query('SELECT xmin::text AS revision,filters FROM mandates WHERE id=$1 AND organization_id=$2',[t.mandate_id,t.organization_id])).rows[0];
   if(!mandate)throw new Error('Mandate unavailable');
   const parsed=briefSchema.safeParse(readableStoredBrief(mandate.filters?.brief));
   const issues=parsed.success?searchReadiness(parsed.data):['Review and save a valid acquisition Brief before research.'];
   if(parsed.success&&!issues.length){
    const subsectors=criterion(parsed.data,'subsectors');
    if(subsectors.state!=='specified'||subsectors.value.trim().length<2||subsectors.value.trim().length>960)issues.push('Confirm a specific subsector research scope of at most 960 characters.');
    if(!briefToMandate(parsed.data).states.length)issues.push('Confirm Australian states or National before research.');
   }
   let researchEngine=nativeResearchEngineCapability();if(researchEngine.kind==='supported'&&researchEngine.productionPipeline==='hybrid-firmable-v1'&&(await c.query('SELECT to_regprocedure($1) IS NOT NULL AS installed',[HYBRID_PREPARATION])).rows[0]?.installed!==true)researchEngine={kind:'blocked',productionPipeline:'hybrid-firmable-v1',missing:['native_hybrid_preparation_schema'],message:'The configured company research workflow is not ready in agent mode. You can run research from the main workspace. No new research was started.'};
   return {responsibility:r?{id:r.id as string,revision:r.revision as number,state:r.state as string,mandateRevision:r.mandate_revision as string}:null,mandateRevision:mandate.revision as string,researchEngine,researchReadiness:{issues,briefPath:'/mandates/'+t.mandate_id}};
  });
 }
 async proposeResearchPlan(threadId:string,key:string,raw:unknown,authority?:AgentExecutionFence){
  const input=scopeSchema.parse(raw);
  const productionPipeline=requireNativeResearchEngine().productionPipeline;
  return this.command(threadId,key,'research.plan',input,async(c,t,commandId)=>{
   await this.assertResearchEngineInstalled(c,productionPipeline,input.companyContinuation?4:5);
   const r=(await c.query('SELECT * FROM agent_responsibilities WHERE id=$1 AND thread_id=$2 FOR UPDATE',[input.responsibilityId,t.id])).rows[0];
   const mandate=(await c.query('SELECT xmin::text AS revision,filters FROM mandates WHERE id=$1 AND organization_id=$2',[t.mandate_id,t.organization_id])).rows[0];
   if(!r||!['ready','waiting'].includes(r.state)||r.revision!==input.responsibilityRevision||r.mandate_revision!==input.mandateRevision||mandate?.revision!==input.mandateRevision)throw new Error('Mandate or research supervision changed; review the current goal');
   if(input.companyContinuation)await this.companyContinuationSnapshot(c,t,input.companyContinuation);
   const guidance=await loadApprovedAgentGuidance(c,t,{categories:['qualification']});
   const contextRevision=agentResearchContextRevision({...input,productionPipeline,companyIdentityPolicyVersion:1,...(productionPipeline==='hybrid-firmable-v1'?{discoveryPolicyVersion:input.companyContinuation?4:5}:{}),...(guidance.items.length?{guidance}:{})});
   const previous=(await c.query("SELECT o.*,b.id AS batch_id FROM agent_operations o JOIN agent_review_batches b ON b.thread_id=o.thread_id AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id)) WHERE o.thread_id=$1 AND o.name='research.start' AND o.input->>'nativeResearchPlanVersion'='1' AND o.input->>'contextRevision'=$2 AND (NOT(o.input->'config' ? 'companyContinuation') OR o.state<>'rejected') ORDER BY o.created_at LIMIT 1",[t.id,contextRevision])).rows[0];
   if(previous)return {id:previous.id as string,revision:previous.revision as number,status:previous.state as string,reviewBatchId:previous.batch_id as string};
   const brief=briefSchema.parse(readableStoredBrief(mandate.filters?.brief));
   const value=buildAgentResearchPlan({...input,productionPipeline,...(productionPipeline==='hybrid-firmable-v1'?{discoveryPolicyVersion:input.companyContinuation?4 as const:5 as const}:{}),brief,researchJobId:randomUUID(),...(guidance.items.length?{guidance}:{})}),hash=digest({name:'research.start',input:value});
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
   const parent=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name IN('research.start','research.people','research.fields') AND state='running' FOR UPDATE",[z.string().uuid().parse(operationId),t.id])).rows[0];
   if(!parent)throw new Error('Current launched research required');await this.checkResearchRunContext(c,t,parent);
   if((await c.query('SELECT public.agent_research_phase_budget_status($1) AS value',[parent.id])).rows[0].value?.ready!==true)throw Error('Full current research phase funding required');
   const status=(await c.query('SELECT agent_native_research_status($1::uuid) AS status',[parent.id])).rows[0]?.status;
   if(!['firmable-company-v1','hybrid-company-v1','firmable-people-v1','public-fields-v1'].includes(status?.nativeAgent?.providerAdmission)||['complete','partial','failed','cancelled'].includes(status.status))throw new Error('Research is not ready for supported dispatch');
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
   const t=await this.lockThread(c,threadId),op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name IN('research.start','research.people','research.fields') FOR UPDATE",[z.string().uuid().parse(operationId),t.id])).rows[0];
   if(!op)throw new Error('Native research operation not found');
   const status=(await c.query('SELECT agent_native_research_status($1::uuid) AS status',[op.id])).rows[0]?.status;
   if(!status||!['complete','partial','failed','cancelled'].includes(status.status))throw new Error('Research has not reached a terminal result');
   if(op.state==='complete')return status;
   await this.checkResearchRunContext(c,t,op,false);
   await c.query("UPDATE agent_operations SET state='complete',result=$2,lease_until=NULL,updated_at=now() WHERE id=$1",[op.id,JSON.stringify(status)]);
   await c.query("UPDATE agent_responsibilities SET milestone=CASE WHEN $2='research.people' THEN 'target_review' ELSE 'qualification_review' END,updated_at=now() WHERE thread_id=$1",[t.id,op.name]);
   await this.controlNotice(c,t,'research-terminal:'+op.id,`${op.name==='research.people'?'Email contact enrichment':op.name==='research.fields'?'Public company fields':op.input?.config?.companyDiscoveryPolicy?.version===5?'Company and basic people research':'Company research'} finished with status ${status.status}: ${status.companies} companies and ${status.contacts} contacts saved. ${op.input?.config?.companyDiscoveryPolicy?.version===5?'Company fit and contact selection':'Company fit and the next contact-enrichment phase'} require review. No outreach was sent.`,{operationId:op.id,...status});
   await this.emit(c,t,'research-completed:'+op.id,'research.completed',{operationId:op.id,researchJobId:status.jobId,status:status.status});return status;
  });
 }
 async nativeResearchExecutionAllowed(threadId:string,operationId:string,terminal=false){
  return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId),op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name IN('research.start','research.people','research.fields') AND state='running'",[z.string().uuid().parse(operationId),t.id])).rows[0];
   if(!op)return false;
   await this.checkResearchRunContext(c,t,op,!terminal);
   const status=(await c.query('SELECT agent_native_research_status($1::uuid) AS status',[op.id])).rows[0]?.status;
   if((await c.query('SELECT public.agent_research_phase_budget_status($1) AS value',[op.id])).rows[0].value?.ready!==true)return false;
   return Boolean(status&&['firmable-company-v1','hybrid-company-v1','firmable-people-v1','public-fields-v1'].includes(status.nativeAgent?.providerAdmission)&&!['complete','partial','failed','cancelled'].includes(status.status));
  });
 }
 async beginNativeResearchAttempt(threadId:string,key:string,raw:unknown){
  const input=nativeResearchAttemptSchema.parse(raw),request='research-attempt:'+digest(z.string().min(1).max(200).parse(key)),hash=digest({name:'research.provider',input});
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);
   const prior=(await c.query('SELECT * FROM agent_operations WHERE thread_id=$1 AND request_key=$2 FOR UPDATE',[t.id,request])).rows[0];
   if(prior){
    if(prior.input_digest!==hash){
     // New workers derive a request class. An old, immutable request keeps its
     // original digest; class metadata cannot authorize replay of V4 effects.
     const originalParent=(await c.query('SELECT input FROM agent_operations WHERE id=$1 AND thread_id=$2 AND organization_id=$3 AND owner_user_id=$4',[prior.input.researchOperationId,t.id,t.organization_id,t.owner_user_id])).rows[0];
     const legacyInput={...input};delete legacyInput.requestClass;
     if(!input.requestClass||prior.input.requestClass!==undefined||!originalParent||originalParent.input?.config?.companyDiscoveryPolicy?.version===4||prior.input_digest!==digest({name:'research.provider',input:legacyInput}))throw new Error('Provider attempt key reused with different request');
    }
    if(prior.state==='complete')return {kind:'cached' as const,response:prior.result.response};
    throw new Error('Provider attempt is running or uncertain; reconcile before another request');
   }
   const parent=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name IN('research.start','research.people','research.fields') AND state='running' FOR UPDATE",[input.researchOperationId,t.id])).rows[0];
   if(!parent)throw new Error('Current launched research operation required');
   await this.checkResearchProviderContext(c,t,parent,input.targetId);const plan=this.nativeResearchSpecification(parent);
   if(parent.name==='research.start'&&agentResearchPlanSchema.parse(parent.input).config.companyDiscoveryPolicy?.version===4&&input.provider==='firmable'&&!['company_search','company_profile','auth'].includes(input.requestClass??''))throw new Error('Company-only research cannot perform this provider action');
   if(plan.config.requestId!==input.researchJobId)throw new Error('Provider request belongs to another research job');
   const status=(await c.query('SELECT agent_native_research_status($1::uuid) AS status',[parent.id])).rows[0]?.status;
   if(!['firmable-company-v1','hybrid-company-v1','firmable-people-v1','public-fields-v1'].includes(status?.nativeAgent?.providerAdmission))throw new Error('Configure current provider limits and prepare supported research first');
   if(!status||status.jobId!==input.researchJobId||['complete','partial','failed','cancelled'].includes(status.status))throw new Error('Research job is stopped or unavailable');
   if(parent.name==='research.fields'){const fieldPlan=agentFieldsPlanSchema.parse(parent.input),perCompany=fieldPlan.providerPolicy.perCompany[input.provider as 'search'|'page'];const n=(await c.query("SELECT count(*)::int AS n FROM agent_operations WHERE thread_id=$1 AND name='research.provider' AND input->>'researchOperationId'=$2 AND input->>'targetId'=$3 AND input->>'provider'=$4",[t.id,parent.id,input.targetId,input.provider])).rows[0]?.n;if(typeof perCompany!=='number'||typeof n!=='number'||n>=perCompany)throw Error('Public-field physical company attempt limit reached');}
   const count=(await c.query("SELECT count(*)::int AS n FROM agent_operations WHERE thread_id=$1 AND name='research.provider' AND input->>'researchOperationId'=$2 AND input->>'provider'=$3",[t.id,parent.id,input.provider])).rows[0]?.n;
   if(typeof count!=='number'||count>=plan.providerPolicy.maxAttempts[input.provider])throw new Error('Research physical attempt limit reached');
   const op=(await c.query(`INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state,lease_until)
    VALUES($1,$2,$3,$4,$5,'research.provider',$6,$7,'running',clock_timestamp()+interval '60 seconds') RETURNING *`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,JSON.stringify(input),hash])).rows[0];
   await c.query('SELECT public.agent_transfer_research_phase_attempt($1,$2)',[parent.id,op.id]);
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
   if(op.state==='running'&&op.result?.jobId){await this.checkResearchRunContext(c,t,op);return this.fundResearchLaunch(c,t,op,op.result);}
   const receiptSchema=z.object({jobId:z.string().uuid(),status:z.string(),dispatchReady:z.boolean(),blockedReason:z.enum(['budgeted_provider_adapter_required','provider_budget_required']).optional()}).strict();
   await c.query('SELECT agent_create_research_job($1::uuid) AS receipt',[op.id]);
   const receipt=receiptSchema.parse((await c.query(plan.execution.productionPipeline==='hybrid-firmable-v1'?'SELECT public.agent_prepare_hybrid_native_research($1::uuid) AS receipt':'SELECT agent_prepare_firmable_research($1::uuid) AS receipt',[op.id])).rows[0]?.receipt);
   return this.fundResearchLaunch(c,t,op,receipt);
  });
 }

 private async fieldsSnapshot(c:PoolClient,t:AgentThread,sourceRootId:string,targetIds?:string[],operationId?:string){
  const installed=(await c.query("SELECT to_regprocedure('public.agent_fields_company_snapshot(uuid,uuid,uuid[],uuid)') IS NOT NULL AS installed")).rows[0]?.installed;if(installed!==true)throw Error('Public company field research is not available yet. No new field research was started.');
  const snapshot=(await c.query('SELECT public.agent_fields_company_snapshot($1,$2,$3::uuid[],$4::uuid) AS snapshot',[t.id,z.string().uuid().parse(sourceRootId),targetIds??null,operationId??null])).rows[0].snapshot,guidance=await loadApprovedAgentGuidance(c,t,{categories:['qualification']});
  return{...snapshot,companies:await Promise.all(snapshot.companies.map(nativeFieldsCompany)),...(guidance.items.length?{guidance}:{})}as{mandateRevision:string;responsibilityId:string;responsibilityRevision:number;sourceRootId:string;companies:Awaited<ReturnType<typeof nativeFieldsCompany>>[];guidance?:AgentFieldsPlan['guidance']};
 }
 async proposeFieldsResearch(threadId:string,key:string,sourceRootId:string,authority?:AgentExecutionFence){
  const receipt=await this.command(threadId,key,'fields.plan',{sourceRootId:z.string().uuid().parse(sourceRootId)},async(c,t,commandId)=>{
   const prior=(await c.query("SELECT o.id,o.revision,o.state,b.id AS batch_id FROM agent_operations o JOIN agent_review_batches b ON b.thread_id=o.thread_id AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id)) WHERE o.thread_id=$1 AND o.name='research.fields' AND o.input->>'sourceRootId'=$2 AND o.state IN('proposed','approved','running') ORDER BY o.created_at LIMIT 1",[t.id,sourceRootId])).rows[0];
   if(prior)return{id:prior.id as string,revision:prior.revision as number,status:prior.state as string,reviewBatchId:prior.batch_id as string};
   const context=await this.fieldsSnapshot(c,t,sourceRootId);let plan:AgentFieldsPlan;try{plan=buildAgentFieldsPlan({...context,researchJobId:randomUUID()});}catch(error){if(error instanceof Error&&error.message==='No saved company currently needs unattempted public field research')return{id:t.id,revision:context.responsibilityRevision,status:'no_fields'};throw error;}
   const hash=digest({name:'research.fields',input:plan}),op=(await c.query("INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest) VALUES($1,$2,$3,$4,$5,'research.fields',$6,$7) RETURNING id,revision",[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'fields-plan:'+commandId,JSON.stringify(plan),hash])).rows[0],manifest=[{operationId:op.id,revision:op.revision,digest:hash,contextRevision:plan.contextRevision}],batch=(await c.query('INSERT INTO agent_review_batches(thread_id,organization_id,mandate_id,owner_user_id,request_key,manifest,manifest_digest) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'fields-review:'+commandId,JSON.stringify(manifest),digest(manifest)])).rows[0];
   await this.controlNotice(c,t,'fields-proposal:'+commandId,'Review public company field research for these saved companies. This retrieves published corporate facts and ABN evidence only. It does not enrich personal contacts, unlock phones, run AI or approve outreach.',{operationId:op.id,reviewBatchId:batch.id});await this.emit(c,t,'fields-proposed:'+op.id,'fields.proposed',{operationId:op.id,reviewBatchId:batch.id});return{id:op.id as string,revision:op.revision as number,status:'proposed',reviewBatchId:batch.id as string};
  },authority);return receipt.status==='no_fields'?null:receipt;
 }
 async persistApprovedFieldsLaunch(threadId:string,operationId:string,authority?:AgentExecutionFence){return this.nativeTransaction(async c=>{
  const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority,'fields-launch:'+operationId);const op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='research.fields' AND state IN('approved','running') FOR UPDATE",[z.string().uuid().parse(operationId),t.id])).rows[0];if(!op)throw Error('Exact approved public-field research required');
  // Replays after a child committed evidence retain original plan authority; new
  // physical requests still check their own unchanged target snapshot.
  if(op.state==='approved')await this.checkReviewContext(c,t,op);else{await this.checkResearchRunContext(c,t,op);if(op.result?.jobId)return this.fundResearchLaunch(c,t,op,op.result);}
  const receipt=(await c.query('SELECT public.agent_create_fields_job($1) AS receipt',[op.id])).rows[0].receipt;return this.fundResearchLaunch(c,t,op,receipt);
 });}
 async nativeFieldsPlan(threadId:string,operationId:string){return this.nativeTransaction(async c=>{const t=await this.thread(c,threadId),op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='research.fields' AND state='running'",[z.string().uuid().parse(operationId),t.id])).rows[0];if(!op)throw Error('Launched public-field operation required');await this.checkResearchRunContext(c,t,op);return agentFieldsPlanSchema.parse(op.input);});}

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
