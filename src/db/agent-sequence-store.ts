import {checkAgentSequenceDraftReviewContext} from './agent-sequence-review-context';
import type {AgentReviewContextOperation} from './agent-review-context';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {AgentPeopleStore} from './agent-people-store';
import {agentRecordDigest as digest,type AgentThread} from './agent-store';
import type {AgentExecutionFence} from './agent-execution-store';
import {agentGuidanceSnapshotSchema,type AgentGuidanceSnapshot} from '@/lib/agent-guidance-snapshot';
import {campaignDraftDefinition} from '@/domain/campaign';
import {previewAgentSequenceDraft} from '@/lib/agent-sequence-tools';
import {createCampaignDraft,saveCampaignDraft} from '@/lib/campaign-draft-store';
const uuid=z.string().uuid(),token=z.string().regex(/^\d{1,30}$/);
const inputSchema=z.object({name:z.string().trim().min(1).max(100),definition:campaignDraftDefinition,sequenceId:uuid.optional(),expectedRevision:token.optional()}).strict().refine(value=>Boolean(value.sequenceId)===Boolean(value.expectedRevision),'Existing draft ID and reviewed revision must be supplied together');
type SequencePlan={nativeSequenceDraftVersion:1;mandateRevision:string;responsibilityId:string;responsibilityRevision:number;sequenceId:string;mode:'create'|'update';baseRevision:string|null;name:string;definition:z.infer<typeof campaignDraftDefinition>;contextRevision:string;body:string;generationGuidance?:AgentGuidanceSnapshot};
export class AgentSequenceStore extends AgentPeopleStore{
 protected async checkReviewContext(c:PoolClient,t:AgentThread,op:AgentReviewContextOperation){
  await super.checkReviewContext(c,t,op);if(op.name!=='sequence.prepare'||op.input?.nativeSequenceDraftVersion!==1)return;
  await checkAgentSequenceDraftReviewContext(c,t,op.input as SequencePlan);
 }
 async sequenceDrafts(threadId:string){return this.nativeTransaction(async c=>{const t=await this.thread(c,threadId);return(await c.query('SELECT id,name,draft,published_version,xmin::text AS revision FROM campaign_sequences WHERE organization_id=$1 AND owner_user_id=$2 AND mandate_id=$3 ORDER BY updated_at DESC LIMIT 100',[t.organization_id,t.owner_user_id,t.mandate_id])).rows;});}
 async proposeSequenceDraft(threadId:string,key:string,raw:unknown,authority?:AgentExecutionFence,generation?:{guidanceSnapshot:unknown}){
  const input=inputSchema.parse(raw),guidanceSnapshot=generation?agentGuidanceSnapshotSchema.parse(generation.guidanceSnapshot):undefined,preview=previewAgentSequenceDraft(input.definition);
  return this.command(threadId,key,'sequence.draft_plan',{...input,...(guidanceSnapshot?{generationGuidance:guidanceSnapshot}:{})},async(c,t,commandId)=>{
   const r=(await c.query("SELECT * FROM agent_responsibilities WHERE thread_id=$1 AND state IN('ready','waiting') FOR UPDATE",[t.id])).rows[0],m=(await c.query('SELECT xmin::text AS revision FROM mandates WHERE id=$1 AND organization_id=$2',[t.mandate_id,t.organization_id])).rows[0];
   if(!r||r.mandate_revision!==m?.revision)throw new Error('Current active mandate supervision required');
   const source={nativeSequenceDraftVersion:1 as const,mandateRevision:m.revision as string,responsibilityId:r.id as string,responsibilityRevision:r.revision as number,sequenceId:input.sequenceId??randomUUID(),mode:input.sequenceId?'update' as const:'create' as const,baseRevision:input.expectedRevision??null,...(guidanceSnapshot?{generationGuidance:guidanceSnapshot}:{}),name:input.name,definition:preview.definition};
   const guidanceNotice=guidanceSnapshot?'\nApproved generation guidance (preferences only; no authority or criteria changes):\n'+guidanceSnapshot.items.map(item=>item.input.text+' [guidance '+item.id+', revision '+item.revision+']').join('\n'):'',plan:SequencePlan={...source,contextRevision:digest(source),body:'Save this sequence draft only. This does not publish, enroll or send.\n'+JSON.stringify({name:source.name,definition:source.definition},null,2)+guidanceNotice};
   await this.checkReviewContext(c,t,{name:'sequence.prepare',input:plan});
   if(Buffer.byteLength(JSON.stringify(plan))>60000)throw new Error('This draft exceeds the bounded agent review size; use the main builder.');
   const hash=digest({name:'sequence.prepare',input:plan}),op=(await c.query("INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest) VALUES($1,$2,$3,$4,$5,'sequence.prepare',$6,$7) RETURNING id,revision",[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'sequence-draft:'+commandId,JSON.stringify(plan),hash])).rows[0],manifest=[{operationId:op.id,revision:op.revision,digest:hash,contextRevision:plan.contextRevision}];
   const batch=(await c.query('INSERT INTO agent_review_batches(thread_id,organization_id,mandate_id,owner_user_id,request_key,manifest,manifest_digest) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'sequence-draft-review:'+commandId,JSON.stringify(manifest),digest(manifest)])).rows[0];
   await this.controlNotice(c,t,'sequence-draft:'+commandId,'Review the complete sequence draft before saving it. Publishing and enrolling contacts are separate actions; no n8n workflow or email was created.',{operationId:op.id,reviewBatchId:batch.id,sequenceId:plan.sequenceId,publishable:preview.publishable,issues:preview.issues});await this.emit(c,t,'sequence-draft-proposed:'+op.id,'sequence.draft_proposed',{operationId:op.id});
   return {id:op.id as string,revision:op.revision as number,status:'proposed',reviewBatchId:batch.id as string};
  },authority);
 }
 async saveApprovedSequenceDraft(threadId:string,operationId:string,authority?:AgentExecutionFence){return this.nativeTransaction(async c=>{
  const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority,'sequence-draft-save:'+operationId);const op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='sequence.prepare' FOR UPDATE",[uuid.parse(operationId),t.id])).rows[0];
  if(!op||op.input.nativeSequenceDraftVersion!==1)throw new Error('Reviewed native sequence draft required');if(op.state==='complete')return op.result;if(op.state!=='approved')throw new Error('Human approval is required before saving the draft');
  const plan=op.input as SequencePlan;await this.checkReviewContext(c,t,op);const exact=[{operationId:op.id,revision:op.revision,digest:op.input_digest,contextRevision:plan.contextRevision}];
  if(op.input_digest!==digest({name:op.name,input:plan})||!(await c.query("SELECT id FROM agent_review_batches WHERE thread_id=$1 AND state='approved' AND manifest @> $2::jsonb",[t.id,JSON.stringify(exact)])).rowCount)throw new Error('Exact draft approval required');
  const definition=campaignDraftDefinition.parse(plan.definition),saved=plan.mode==='create'?await createCampaignDraft(c,this.actor,t.mandate_id,plan.name,definition,plan.sequenceId):await saveCampaignDraft(c,this.actor,plan.sequenceId,plan.name,definition,plan.baseRevision!);
  const result={sequenceId:saved.id,draftRevision:saved.draftRevision,name:saved.name,published:false,enrolled:false,providerCalled:false};
  await c.query("UPDATE agent_operations SET state='complete',result=$2,updated_at=now() WHERE id=$1",[op.id,JSON.stringify(result)]);await c.query('SELECT agent_audit_completed_sequence($1::uuid)',[op.id]);
  await this.controlNotice(c,t,'sequence-draft-saved:'+op.id,'The reviewed draft is saved in the existing sequence builder. It is not published and no contacts were enrolled.',{operationId:op.id,...result});await this.emit(c,t,'sequence-draft-saved:'+op.id,'sequence.draft_saved',{operationId:op.id,...result});return result;
 });}
}
