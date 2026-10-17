import {loadApprovedAgentGuidance} from '@/lib/agent-guidance-snapshot';
import {assessCompanyGuidance} from '@/lib/agent-qualification-guidance';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {AgentTargetStore} from './agent-target-store';
import {agentRecordDigest as digest,type AgentThread} from './agent-store';
import type {AgentExecutionFence} from './agent-execution-store';
import {buildAgentPeoplePlan,agentPeoplePlanSchema} from '@/lib/agent-people-plan';
const uuid=z.string().uuid();
export class AgentPeopleStore extends AgentTargetStore{
 protected nativeResearchSpecification(op:{name:string;input:unknown}){return op.name==='research.people'?agentPeoplePlanSchema.parse(op.input):super.nativeResearchSpecification(op);}
 private async peopleSnapshot(c:PoolClient,t:AgentThread,ids?:string[],operationId?:string){
  const snapshot=(await c.query('SELECT agent_people_company_snapshot($1::uuid,$2::uuid[],$3::uuid) AS snapshot',[t.id,ids??null,operationId??null])).rows[0].snapshot,guidance=await loadApprovedAgentGuidance(c,t,{categories:['qualification']});
  if(!guidance.items.length)return snapshot;
  let evidence:Record<string,unknown>={};if(guidance.items.some(g=>g.input.qualificationPolicy)){
   const installed=(await c.query("SELECT to_regprocedure('public.agent_people_company_evidence(uuid,uuid[])') IS NOT NULL AS installed")).rows[0]?.installed;if(installed!==true)throw new Error('Company guidance evidence projection requires specific migration approval before people planning');
   evidence=(await c.query('SELECT agent_people_company_evidence($1::uuid,$2::uuid[]) AS evidence',[t.id,snapshot.companies.map((row:{targetId:string})=>row.targetId)])).rows[0].evidence;
  }
  return {...snapshot,guidance,companies:snapshot.companies.map((company:{targetId:string;name:string;blockedReasons:string[]})=>{const assessment=assessCompanyGuidance(guidance,evidence[company.targetId]??{name:company.name});return {...company,guidanceAssessment:assessment,blockedReasons:[...company.blockedReasons,...(assessment.excluded?['approved_qualification_guidance']:[])]};})};
 }
 async peopleResearchContext(threadId:string){return this.nativeTransaction(async c=>this.peopleSnapshot(c,await this.thread(c,threadId)));}
 protected async checkReviewContext(c:PoolClient,t:AgentThread,op:Parameters<AgentTargetStore['checkReviewContext']>[2]){
  await super.checkReviewContext(c,t,op);if(op.name!=='research.people')return;
  const plan=agentPeoplePlanSchema.parse(op.input),current=await this.peopleSnapshot(c,t,plan.selected.map(item=>item.targetId),('id' in op?op.id:undefined) as string|undefined);
  const rebuilt=buildAgentPeoplePlan({...current,researchJobId:plan.config.requestId});
  if(digest(rebuilt)!==digest(plan))throw new Error('Company selection, facts or people supervision changed; review again');
 }
 protected async checkResearchRunContext(c:PoolClient,t:AgentThread,op:Parameters<AgentTargetStore['checkReviewContext']>[2]){
  if(op.name!=='research.people')return super.checkResearchRunContext(c,t,op);
  const plan=agentPeoplePlanSchema.parse(op.input),r=(await c.query('SELECT r.*,m.xmin::text AS current_mandate_revision FROM agent_responsibilities r JOIN mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.thread_id=$1',[t.id])).rows[0];
  const currentGuidance=await loadApprovedAgentGuidance(c,t,{categories:['qualification']});if(digest(plan.guidance??null)!==digest(currentGuidance.items.length?currentGuidance:null))throw new Error('Approved qualification guidance changed before people execution');
  if(!r||!['ready','waiting'].includes(r.state)||r.id!==plan.responsibilityId||r.revision!==plan.responsibilityRevision||r.mandate_revision!==plan.mandateRevision||r.current_mandate_revision!==plan.mandateRevision)throw new Error('People supervision or mandate changed');
 }
 protected async checkResearchProviderContext(c:PoolClient,t:AgentThread,op:Parameters<AgentTargetStore['checkReviewContext']>[2],targetId?:string){
  if(op.name!=='research.people')return super.checkResearchProviderContext(c,t,op,targetId);
  await this.checkResearchRunContext(c,t,op);const plan=agentPeoplePlanSchema.parse(op.input),selected=plan.selected.find(s=>s.targetId===targetId);
  if(!selected)throw new Error('Physical request needs an exact approved company');
  const snapshot=await this.peopleSnapshot(c,t,[uuid.parse(targetId)],('id' in op?op.id:undefined) as string|undefined),current=snapshot.companies[0];
  if(!current||current.targetId!==selected.targetId||current.sourceRevision!==selected.sourceRevision||current.firmableId!==selected.firmableId||current.blockedReasons.length)throw new Error('This company changed or is no longer admissible');
 }
 async peopleIdentityNeedsReview(threadId:string,targetId:string,personId:string){
  return this.nativeTransaction(async c=>{await this.thread(c,threadId);const rows=(await c.query('SELECT target_id,personal_data,fictionalised FROM contacts WHERE organization_id=$1 AND firmable_person_id=$2',[this.actor.organizationId,z.string().regex(/^fp\d+$/).parse(personId)])).rows;return rows.some(row=>row.target_id!==uuid.parse(targetId)||row.fictionalised||row.personal_data?.doNotContact===true||Boolean(row.personal_data?.email));});
 }
 async peopleProfileOutcome(threadId:string,operationId:string,targetId:string,personId:string){
  return this.nativeTransaction(async c=>{const t=await this.thread(c,threadId),key='native-people-profile:'+digest({operationId,targetId,personId});const row=(await c.query("SELECT result FROM agent_operations WHERE thread_id=$1 AND request_key=$2 AND name='research.people.profile_result' AND state='complete'",[t.id,key])).rows[0];return row?{recorded:true as const,contactId:row.result.contactId as string|null}:null;});
 }
 async researchCompletionInfo(threadId:string,operationId:string){return this.nativeTransaction(async c=>{const t=await this.thread(c,threadId),row=(await c.query("SELECT name,state,result FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name IN('research.start','research.people')",[uuid.parse(operationId),t.id])).rows[0];if(!row||row.state!=='complete')throw new Error('Completed owned research required');return row as {name:string;state:string;result:unknown};});}
 async recordResearchNextStep(threadId:string,key:string,raw:unknown,authority?:AgentExecutionFence){
  const input=z.object({kind:z.enum(['cached_contacts','needs_review']),message:z.string().min(1).max(2000)}).strict().parse(raw);
  return this.command(threadId,key,'research.next_step',input,async(c,t,commandId)=>{
   const r=(await c.query("SELECT r.*,m.xmin::text AS current_mandate_revision FROM agent_responsibilities r JOIN mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.thread_id=$1 AND r.state IN('ready','waiting')",[t.id])).rows[0];
   if(!r||r.mandate_revision!==r.current_mandate_revision)throw new Error('Current supervision required');
   await this.controlNotice(c,t,'research-next:'+commandId,input.message,{action:input.kind==='cached_contacts'?'review_cached_contacts':'review_research_results'});return {id:r.id as string,revision:r.revision as number,status:'needs_review'};
  },authority);
 }
 async proposePeopleResearch(threadId:string,key:string,authority?:AgentExecutionFence){
  return this.command(threadId,key,'people.plan',{},async(c,t,commandId)=>{
   const context=await this.peopleSnapshot(c,t),plan=buildAgentPeoplePlan({...context,researchJobId:randomUUID()});
   const previous=(await c.query("SELECT o.*,b.id AS batch_id FROM agent_operations o JOIN agent_review_batches b ON b.thread_id=o.thread_id AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',o.id)) WHERE o.thread_id=$1 AND o.name='research.people' AND o.input->>'contextRevision'=$2 LIMIT 1",[t.id,plan.contextRevision])).rows[0];
   if(previous)return {id:previous.id as string,revision:previous.revision as number,status:previous.state as string,reviewBatchId:previous.batch_id as string};
   const hash=digest({name:'research.people',input:plan}),op=(await c.query("INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest) VALUES($1,$2,$3,$4,$5,'research.people',$6,$7) RETURNING id,revision",[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'people-plan:'+commandId,JSON.stringify(plan),hash])).rows[0],manifest=[{operationId:op.id,revision:op.revision,digest:hash,contextRevision:plan.contextRevision}];
   const batch=(await c.query('INSERT INTO agent_review_batches(thread_id,organization_id,mandate_id,owner_user_id,request_key,manifest,manifest_digest) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'people-review:'+commandId,JSON.stringify(manifest),digest(manifest)])).rows[0];
   await this.controlNotice(c,t,'people-proposal:'+commandId,plan.body,{operationId:op.id,reviewBatchId:batch.id});await this.emit(c,t,'people-proposed:'+op.id,'people.proposed',{operationId:op.id,reviewBatchId:batch.id});return {id:op.id as string,revision:op.revision as number,status:'proposed',reviewBatchId:batch.id as string};
  },authority);
 }
 async persistApprovedPeopleLaunch(threadId:string,operationId:string,authority?:AgentExecutionFence){
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority,'people-launch:'+operationId);
   const op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='research.people' AND state IN('approved','running') FOR UPDATE",[uuid.parse(operationId),t.id])).rows[0];
   if(!op)throw new Error('Current approved people research required');await this.checkReviewContext(c,t,op);
   if(op.input_digest!==digest({name:op.name,input:op.input}))throw new Error('People plan changed');
   const receipt=(await c.query('SELECT agent_create_people_job($1::uuid) AS receipt',[op.id])).rows[0].receipt;
   await c.query("UPDATE agent_operations SET state='running',result=$2,updated_at=now() WHERE id=$1",[op.id,JSON.stringify(receipt)]);
   await this.emit(c,t,'research-dispatch:'+op.id,'people.dispatch',{operationId:op.id,researchJobId:receipt.jobId});return {jobId:receipt.jobId as string,status:receipt.status as string,dispatchReady:receipt.dispatchReady===true};
  });
 }
 async nativePeoplePlan(threadId:string,operationId:string){return this.nativeTransaction(async c=>{const t=await this.thread(c,threadId),op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='research.people' AND state='running'",[uuid.parse(operationId),t.id])).rows[0];if(!op)throw new Error('Launched people operation required');await this.checkResearchRunContext(c,t,op);return agentPeoplePlanSchema.parse(op.input);});}
 async recordPeopleCandidates(threadId:string,operationId:string,targetId:string,ids:string[]){
  const candidates=z.array(z.string().regex(/^fp\d+$/)).max(3).parse(ids);return this.nativeTransaction(async c=>{const t=await this.lockThread(c,threadId),op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='research.people' AND state='running'",[uuid.parse(operationId),t.id])).rows[0];if(!op)throw new Error('Current people operation required');await this.checkResearchProviderContext(c,t,op,targetId);await c.query('SELECT agent_record_people_candidates($1::uuid,$2::uuid,$3::jsonb)',[op.id,uuid.parse(targetId),JSON.stringify(candidates)]);});
 }
 async savePeopleProfile(threadId:string,operationId:string,targetId:string,profile:unknown){
  const person=z.object({id:z.string().regex(/^fp\d+$/),name:z.string().max(300).optional(),position:z.string().max(300).optional(),email:z.string().max(300).optional(),emailLookupStatus:z.string().max(100).optional(),fictionalised:z.boolean(),doNotContact:z.boolean()}).strip().parse(profile);
  return this.nativeTransaction(async c=>{const t=await this.lockThread(c,threadId),op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='research.people' AND state='running'",[uuid.parse(operationId),t.id])).rows[0];if(!op)throw new Error('Current people operation required');await this.checkResearchProviderContext(c,t,op,targetId);const source={operationId:op.id,targetId:uuid.parse(targetId),personId:person.id},key='native-people-profile:'+digest(source),prior=(await c.query("SELECT result FROM agent_operations WHERE thread_id=$1 AND request_key=$2 AND name='research.people.profile_result'",[t.id,key])).rows[0];if(prior)return prior.result.contactId as string|null;
   const id=(await c.query('SELECT agent_save_people_profile($1::uuid,$2::uuid,$3::jsonb) AS id',[op.id,targetId,JSON.stringify(person)])).rows[0].id as string|null;
   await c.query("INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state,result) VALUES($1,$2,$3,$4,$5,'research.people.profile_result',$6,$7,'complete',$8)",[t.id,t.organization_id,t.mandate_id,t.owner_user_id,key,JSON.stringify(source),digest({name:'research.people.profile_result',input:source}),JSON.stringify({contactId:id})]);return id;});
 }
}
