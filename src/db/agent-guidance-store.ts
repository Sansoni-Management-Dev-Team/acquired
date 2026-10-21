import {z} from 'zod';
import type {PoolClient} from 'pg';
import {AgentStore,agentRecordDigest as digest,type AgentThread} from './agent-store';
import {guidanceInputSchema,selectAgentGuidance,type AgentGuidanceView} from '@/domain/agent-guidance';
import {agentFeedbackSchema,agentFeedbackOperationNames} from '@/domain/agent-feedback';
import {manualFeedbackInputSchema} from '@/domain/agent-manual-feedback';
const uuid=z.string().uuid(),revision=z.number().int().positive();
const requestKey=z.string().trim().min(1).max(200);
export class AgentGuidanceStore extends AgentStore{
 private async source(c:PoolClient,t:AgentThread,input:ReturnType<typeof guidanceInputSchema.parse>){
  const row=(await c.query("SELECT id,content FROM agent_messages WHERE id=$1 AND thread_id=$2 AND role='user'",[input.sourceMessageId,t.id])).rows[0];
  if(!row)throw new Error('Guidance must reference a saved human message in this conversation');
  const recorded=row.content?.feedback?.sourceEntity;
  if((recorded||input.sourceEntity)&&(!recorded||!input.sourceEntity||digest(recorded)!==digest(input.sourceEntity)))throw new Error('Guidance entity provenance must match its recorded human feedback');
 }
 async captureFeedback(threadId:string,key:string,raw:unknown){
  const input=agentFeedbackSchema.parse(raw),request='entity-feedback:'+z.string().trim().min(1).max(150).parse(key),hash=digest(input);
  return this.transaction(async c=>{
   const t=await this.lockThread(c,threadId);
   const prior=(await c.query("SELECT * FROM agent_operations WHERE thread_id=$1 AND request_key=$2",[t.id,request])).rows[0];
   if(prior){const message=(await c.query("SELECT content FROM agent_messages WHERE thread_id=$1 AND request_key=$2 AND role='user'",[t.id,request])).rows[0];if(prior.name!=='guidance.memory'||message?.content?.feedback?.requestDigest!==hash)throw new Error('Feedback request key reused with different correction');return prior;}
   const entity=input.source.kind==='operation'
    ?(await c.query("SELECT id,revision,name,state,input,input_digest,result FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name=ANY($3::text[])",[input.source.id,t.id,agentFeedbackOperationNames])).rows[0]
    :(await c.query('SELECT id,revision,state,context,human_evidence FROM agent_handoffs WHERE id=$1 AND thread_id=$2 AND owner_user_id=$3',[input.source.id,t.id,this.actor.userId])).rows[0];
   if(entity&&input.source.kind==='handoff'){
    const inbox=(await c.query('SELECT agent_handoff_inbox($1::uuid) AS inbox',[t.mandate_id])).rows[0]?.inbox;
    entity.context_revision=inbox?.tasks?.find((item:{id:string;context_revision:string})=>item.id===entity.id)?.context_revision;
   }
   if(!entity||entity.revision!==input.source.revision||(input.source.kind==='handoff'&&entity.context_revision!==input.source.contextRevision))throw new Error('Feedback entity changed or is unavailable; review its current version');
   const sourceEntity={kind:input.source.kind,id:entity.id,revision:entity.revision,digest:digest(entity)},sourceSnapshot={name:entity.name??'human.handoff',state:entity.state,inputDigest:entity.input_digest??null,preview:JSON.stringify(entity.input??entity.context).slice(0,6000)},content={text:input.reason,feedback:{sourceEntity,sourceSnapshot,requestDigest:hash,preference:input.preference,category:input.category}};
   const message=(await c.query(`INSERT INTO agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
    VALUES($1,$2,$3,$4,$5,'user',$6,$7) RETURNING id`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,JSON.stringify(content),digest({role:'user',content})])).rows[0];
   const value=guidanceInputSchema.parse({text:input.preference,category:input.category,sourceMessageId:message.id,sourceEntity,triggerTerms:[]});
   const op=(await c.query(`INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,result)
    VALUES($1,$2,$3,$4,$5,'guidance.memory',$6,$7,$8) RETURNING *`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,JSON.stringify(value),digest({name:'guidance.memory',input:value}),JSON.stringify({feedbackDigest:hash})])).rows[0];
   await this.notice(c,t,op,'proposed');return op;
  });
 }
 async captureManualFeedback(threadId:string,key:string,raw:unknown){
  const input=manualFeedbackInputSchema.parse(raw),request='manual-feedback:'+z.string().trim().min(1).max(150).parse(key),hash=digest(input);
  return this.transaction(async c=>{
   const t=await this.lockThread(c,threadId);
   const prior=(await c.query('SELECT * FROM agent_operations WHERE thread_id=$1 AND request_key=$2',[t.id,request])).rows[0];
   if(prior){const message=(await c.query("SELECT content FROM agent_messages WHERE thread_id=$1 AND request_key=$2 AND role='user'",[t.id,request])).rows[0];if(prior.name!=='guidance.memory'||message?.content?.feedback?.requestDigest!==hash)throw new Error('Feedback request key reused with different correction');return prior;}
   const installed=(await c.query("SELECT to_regprocedure('public.agent_manual_feedback_source(uuid,text,uuid)') IS NOT NULL AS installed")).rows[0]?.installed;
   if(!installed)throw new Error('Manual feedback requires separately approved migration0035');
   const entityId=input.source.kind==='target_review'?input.source.targetId:input.source.sequenceId;
   const entity=(await c.query('SELECT public.agent_manual_feedback_source($1::uuid,$2::text,$3::uuid) AS source',[t.id,input.source.kind,entityId])).rows[0]?.source;
   if(!entity||entity.revision!==input.source.revision)throw new Error('Saved manual source changed; review its current version');
   const sourceEntity={kind:input.source.kind,id:entityId,revision:entity.revision,digest:digest(entity)},sourceSnapshot={name:input.source.kind,preview:JSON.stringify(entity).slice(0,6000)},content={text:input.reason,feedback:{sourceEntity,sourceSnapshot,requestDigest:hash,preference:input.preference,category:input.category}};
   const message=(await c.query(`INSERT INTO agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
    VALUES($1,$2,$3,$4,$5,'user',$6,$7) RETURNING id`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,JSON.stringify(content),digest({role:'user',content})])).rows[0];
   const value=guidanceInputSchema.parse({text:input.preference,category:input.category,sourceMessageId:message.id,sourceEntity,triggerTerms:[]});
   const op=(await c.query(`INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,result)
    VALUES($1,$2,$3,$4,$5,'guidance.memory',$6,$7,$8) RETURNING *`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,JSON.stringify(value),digest({name:'guidance.memory',input:value}),JSON.stringify({feedbackDigest:hash})])).rows[0];
   await this.notice(c,t,op,'proposed');return op;
  });
 }
 private async notice(c:PoolClient,t:AgentThread,op:{id:string;revision:number;state:string;input:unknown},kind:string){
  const payload={guidanceId:op.id,revision:op.revision,state:op.state,input:op.input,actorId:this.actor.userId};
  const key='guidance:'+op.id+':'+kind+':'+op.revision;
  await c.query(`INSERT INTO agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,key,'guidance.'+kind,JSON.stringify(payload),digest(payload)]);
  const content={text:kind==='approved'?'You approved this guidance for this mandate.':kind==='rejected'?'You revoked or rejected this guidance.':'You proposed or edited guidance. It needs your confirmation before use.',...payload};
  await c.query(`INSERT INTO agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
   VALUES($1,$2,$3,$4,$5,'user',$6,$7)`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,key,JSON.stringify(content),digest({role:'user',content})]);
 }
 async proposeGuidance(threadId:string,key:string,raw:unknown){
  const input=guidanceInputSchema.parse(raw),request=requestKey.parse(key),hash=digest({name:'guidance.memory',input});
  return this.transaction(async c=>{
   const t=await this.lockThread(c,threadId);await this.source(c,t,input);
   const prior=(await c.query('SELECT * FROM agent_operations WHERE thread_id=$1 AND request_key=$2',[t.id,request])).rows[0];
   if(prior){if(prior.name!=='guidance.memory'||prior.input_digest!==hash)throw new Error('Request key reused with different guidance');return prior;}
   const op=(await c.query(`INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest)
    VALUES($1,$2,$3,$4,$5,'guidance.memory',$6,$7) RETURNING *`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,JSON.stringify(input),hash])).rows[0];
   await this.notice(c,t,op,'proposed');return op;
  });
 }
 async decideGuidance(threadId:string,operationId:string,expectedRevision:number,decision:'approved'|'rejected'){
  uuid.parse(operationId);revision.parse(expectedRevision);z.enum(['approved','rejected']).parse(decision);
  return this.transaction(async c=>{
   const t=await this.lockThread(c,threadId);
   const op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='guidance.memory' FOR UPDATE",[operationId,t.id])).rows[0];
   if(!op)throw new Error('Guidance not found');
   if(op.state===decision&&op.result?.fromRevision===expectedRevision&&op.result?.actorId===this.actor.userId)return op;
   if(op.revision!==expectedRevision)throw new Error('Guidance changed; review again');
   if(op.state===decision)return op;
   if(decision==='approved'&&op.state!=='proposed')throw new Error('Guidance changed; an edited candidate needs fresh review');
   if(!['proposed','approved'].includes(op.state))throw new Error('Guidance changed or was revoked');
   await this.source(c,t,guidanceInputSchema.parse(op.input));
   const updated=(await c.query('UPDATE agent_operations SET state=$2,revision=revision+1,result=$3,updated_at=now() WHERE id=$1 RETURNING *',[op.id,decision,JSON.stringify({decision,fromRevision:expectedRevision,actorId:this.actor.userId})])).rows[0];
   await this.notice(c,t,updated,decision);return updated;
  });
 }
 async editGuidance(threadId:string,operationId:string,expectedRevision:number,raw:unknown){
  uuid.parse(operationId);revision.parse(expectedRevision);const input=guidanceInputSchema.parse(raw),hash=digest({name:'guidance.memory',input});
  return this.transaction(async c=>{
   const t=await this.lockThread(c,threadId);await this.source(c,t,input);
   const op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='guidance.memory' FOR UPDATE",[operationId,t.id])).rows[0];
   if(!op)throw new Error('Guidance not found');
   const original=guidanceInputSchema.parse(op.input);
   if(original.sourceEntity&&(input.sourceMessageId!==original.sourceMessageId||digest(input.sourceEntity??null)!==digest(original.sourceEntity)))throw new Error('Original entity feedback provenance cannot change; propose a separate suggestion');
   if(op.revision===expectedRevision+1&&op.state==='proposed'&&op.input_digest===hash)return op;
   if(op.revision!==expectedRevision||!['proposed','approved','rejected'].includes(op.state))throw new Error('Guidance changed; review again');
   const updated=(await c.query("UPDATE agent_operations SET state='proposed',input=$2,input_digest=$3,revision=revision+1,result=NULL,updated_at=now() WHERE id=$1 RETURNING *",[op.id,JSON.stringify(input),hash])).rows[0];
   await this.notice(c,t,updated,'edited');return updated;
  });
 }
 async listGuidance(threadId:string):Promise<AgentGuidanceView[]>{
  return this.transaction(async c=>{
   const t=await this.thread(c,threadId);
   const rows=(await c.query("SELECT id,revision,state,input FROM agent_operations WHERE thread_id=$1 AND name='guidance.memory' AND state IN ('proposed','approved','rejected') ORDER BY updated_at DESC,id LIMIT 100",[t.id])).rows;
   return rows.map(row=>({...row,organizationId:t.organization_id,mandateId:t.mandate_id,userId:t.owner_user_id} as AgentGuidanceView));
  });
 }
 async relevantGuidance(threadId:string,query:string){
  const items=await this.listGuidance(threadId);
  if(!items.length)return [];
  return selectAgentGuidance(items,{organizationId:this.actor.organizationId,userId:this.actor.userId,mandateId:items[0].mandateId},query);
 }
}
