import{agentModelResponseFailureSchema}from'@/domain/agent-model-response-failure';
import {z} from 'zod';
import {AgentOutreachStore} from './agent-outreach-store';
import {agentRecordDigest as digest} from './agent-store';
import type {AgentExecutionFence} from './agent-execution-store';
import {modelBudgetUpperBound} from '@/domain/agent-budget';
import {nativeConversationDecisionSchema} from '@/lib/agent-conversation-engine';
const uuid=z.string().uuid(),units=z.string().regex(/^(0|[1-9]\d{0,11})$/);
const specification=z.object({conversationId:uuid,contextRevision:z.string().regex(/^[a-f0-9]{64}$/),model:z.string().min(1).max(150),maxInputTokens:z.number().int().min(1).max(64000),maxOutputTokens:z.number().int().min(1).max(2000),inputPriceMicroUsdPerMillion:units,outputPriceMicroUsdPerMillion:units,promptVersion:z.string().min(1).max(100)}).strict();
// Optional together for receipts written before token-detail accounting. Do not
// default absent details: that would alter immutable legacy receipt digests.
const usageSchema=z.object({inputTokens:z.number().int().min(1).max(1000000),outputTokens:z.number().int().min(0).max(1000000),cachedInputTokens:z.number().int().min(0).max(1000000).optional(),cacheWriteTokens:z.number().int().min(0).max(1000000).optional(),reasoningTokens:z.number().int().min(0).max(1000000).optional()}).strict().refine(value=>(value.cachedInputTokens===undefined)===(value.reasoningTokens===undefined),'Token details must be reported together').refine(value=>(value.cachedInputTokens??0)+(value.cacheWriteTokens??0)<=value.inputTokens&&(value.reasoningTokens??0)<=value.outputTokens,'Token detail exceeds total');
const rejectionSchema=z.object({httpStatus:z.union([z.literal(400),z.literal(401),z.literal(403),z.literal(404),z.literal(422)]),category:z.enum(['invalid_request','authentication_or_policy','model_unavailable']),code:z.enum(['invalid_json_schema','invalid_api_key','model_not_found','unsupported_parameter','unsupported_value','other']),parameter:z.enum(['response_format','response_format.json_schema','reasoning_effort','model','max_completion_tokens','other'])}).strict();
const outcomeSchema=z.object({model:z.string().min(1).max(150),usage:usageSchema.nullable(),response:nativeConversationDecisionSchema.optional(),reason:z.enum(['provider_outcome_unknown','provider_response_invalid','provider_request_rejected']).optional(),rejection:rejectionSchema.optional(),responseFailure:agentModelResponseFailureSchema.optional()}).strict().refine(v=>v.reason==='provider_request_rejected'?v.usage===null&&!v.response&&!!v.rejection:!v.rejection,'Rejection requires an unexecuted attempt').refine(v=>!v.responseFailure||!!v.reason&&v.reason!=='provider_request_rejected'&&v.response===undefined,'Response diagnosis requires a failed response attempt');
const chatSpecification=specification.omit({conversationId:true,contextRevision:true}).extend({requestDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const chatOutcomeSchema=z.object({model:z.string().min(1).max(150),usage:usageSchema.nullable(),response:z.json().optional(),reason:z.enum(['provider_outcome_unknown','provider_response_invalid','provider_request_rejected']).optional(),rejection:rejectionSchema.optional(),responseFailure:agentModelResponseFailureSchema.optional()}).strict().refine(v=>v.reason==='provider_request_rejected'?v.usage===null&&v.response===undefined&&!!v.rejection:!v.rejection,'Rejection requires an unexecuted attempt').refine(v=>!v.responseFailure||!!v.reason&&v.reason!=='provider_request_rejected'&&v.response===undefined,'Response diagnosis requires a failed response attempt');
export type NativeModelStart={kind:'started';operationId:string;fence:string}|{kind:'cached';operationId:string;response:unknown};
export class AgentModelStore extends AgentOutreachStore{
 async beginNativeModel(threadId:string,key:string,raw:unknown,authority?:AgentExecutionFence):Promise<NativeModelStart>{
  const input=specification.parse(raw),request='native-model:'+digest(z.string().trim().min(1).max(200).parse(key));
  const hash=digest({name:'conversation.decide',input});
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority,'model:'+request);
   const prior=(await c.query("SELECT * FROM agent_operations WHERE thread_id=$1 AND request_key=$2 FOR UPDATE",[t.id,request])).rows[0];
   if(prior){
    if(prior.input_digest!==hash)throw new Error('Model request changed; use a fresh reassessment');
    if(prior.state==='complete')return {kind:'cached',operationId:prior.id,response:nativeConversationDecisionSchema.parse(prior.result.response)};
    throw new Error('The saved model attempt is running or needs reconciliation; no automatic retry');
   }
   const row=await this.lockConversation(c,t,input.conversationId);
   if(row.context_revision!==input.contextRevision||row.phase!=='active'||row.driver_kind!=='agent'||!row.history_complete)throw new Error('Conversation changed or is unavailable');
   const eligible=(await c.query("SELECT $1::timestamptz<=clock_timestamp() AND $1::timestamptz>clock_timestamp()-interval '5 minutes' AND EXISTS(SELECT 1 FROM agent_responsibilities WHERE id=$2 AND state IN('ready','waiting')) AS allowed",[row.history_observed_at,row.responsibility_id])).rows[0]?.allowed;
   if(eligible!==true)throw new Error('Refresh history and supervision before the model call');
   const op=(await c.query(`INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,conversation_id,state,lease_until)
    VALUES($1,$2,$3,$4,$5,'conversation.decide',$6,$7,$8,'running',clock_timestamp()+interval '60 seconds') RETURNING *`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,JSON.stringify(input),hash,row.id])).rows[0];
   const money=modelBudgetUpperBound({...input,maxAttempts:1});
   if(money==='0')throw new Error('A positive reviewed model price ceiling is required');
   const keys=['organization','user:'+t.owner_user_id,'mandate:'+t.mandate_id].flatMap(scope=>['calls','usd_micro'].map(unit=>scope+':'+unit));
   const accounts=(await c.query("SELECT DISTINCT ON(scope_key) id,scope_key,unit FROM agent_budget_accounts WHERE organization_id=$1 AND scope_key=ANY($2::text[]) AND window_start<=clock_timestamp() AND window_end>clock_timestamp() ORDER BY scope_key,window_start DESC,id",[t.organization_id,keys])).rows;
   if(accounts.length!==keys.length||accounts.some(a=>!a.scope_key.endsWith(':'+a.unit)))throw new Error('Configure organisation, user and mandate model call/cost limits first');
   await c.query('SELECT agent_reserve_budget($1::uuid,$2::jsonb)',[op.id,JSON.stringify(accounts.map(a=>({accountId:a.id,amount:a.unit==='calls'?'1':money})))]);
   return {kind:'started',operationId:op.id as string,fence:String(op.fence)};
  });
 }
 async beginChatModel(threadId:string,answerOperationId:string,raw:unknown):Promise<NativeModelStart>{
  uuid.parse(answerOperationId);const input=chatSpecification.parse(raw),request='chat-model:'+answerOperationId,hash=digest({name:'conversation.answer.model',input});
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);
   const parent=(await c.query("SELECT id FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='conversation.answer' AND state='running' AND lease_until>clock_timestamp() FOR UPDATE",[answerOperationId,t.id])).rows[0];if(!parent)throw Error('Saved answer turn is no longer active');
   const prior=(await c.query('SELECT * FROM agent_operations WHERE thread_id=$1 AND request_key=$2 FOR UPDATE',[t.id,request])).rows[0];
   if(prior){if(prior.input_digest!==hash)throw Error('Chat model request changed');if(prior.state==='complete')return {kind:'cached',operationId:prior.id,response:prior.result.response};throw Error('Saved chat attempt needs reconciliation; no automatic retry');}
   const op=(await c.query("INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state,lease_until) VALUES($1,$2,$3,$4,$5,'conversation.answer.model',$6,$7,'running',clock_timestamp()+interval '60 seconds') RETURNING id,fence",[t.id,t.organization_id,t.mandate_id,t.owner_user_id,request,JSON.stringify(input),hash])).rows[0];
   const keys=['organization','user:'+t.owner_user_id,'mandate:'+t.mandate_id].flatMap(scope=>['calls','usd_micro'].map(unit=>scope+':'+unit)),money=modelBudgetUpperBound({...input,maxAttempts:1});
   const accounts=(await c.query("SELECT DISTINCT ON(scope_key) id,scope_key,unit FROM agent_budget_accounts WHERE organization_id=$1 AND scope_key=ANY($2::text[]) AND window_start<=clock_timestamp() AND window_end>clock_timestamp() ORDER BY scope_key,window_start DESC,id",[t.organization_id,keys])).rows;
   if(money==='0'||accounts.length!==6||accounts.some(a=>!a.scope_key.endsWith(':'+a.unit)))throw Error('Configure organisation, user and mandate model call/cost limits first');
   await c.query('SELECT agent_reserve_budget($1::uuid,$2::jsonb)',[op.id,JSON.stringify(accounts.map(a=>({accountId:a.id,amount:a.unit==='calls'?'1':money})))]);return {kind:'started',operationId:op.id,fence:String(op.fence)};
  });
 }
 async finishChatModel(threadId:string,operationId:string,fence:string,raw:unknown){return this.finishModelReceipt(threadId,operationId,fence,raw,'conversation.answer.model');}
 async finishNativeModel(threadId:string,operationId:string,fence:string,raw:unknown){return this.finishModelReceipt(threadId,operationId,fence,raw,'conversation.decide');}
 private async finishModelReceipt(threadId:string,operationId:string,fence:string,raw:unknown,name:'conversation.decide'|'conversation.answer.model'){
  uuid.parse(operationId);z.string().regex(/^\d+$/).parse(fence);const result=name==='conversation.decide'?outcomeSchema.parse(raw):chatOutcomeSchema.parse(raw),resultDigest=digest(result);
  if(Buffer.byteLength(JSON.stringify(result))>60000)throw Error('Model receipt exceeds bounded storage');
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);
   const op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name=$4 AND fence=$3::bigint FOR UPDATE",[operationId,t.id,fence,name])).rows[0];
   if(!op)throw new Error('Model operation fence changed');
   if(op.result?.receiptDigest){if(op.result.receiptDigest!==resultDigest)throw new Error('Different model usage receipt');return op.result;}
   if(!['running','uncertain'].includes(op.state))throw new Error('Model attempt cannot be completed');
   const spec=name==='conversation.decide'?specification.parse(op.input):chatSpecification.parse(op.input),sameModel=result.model===spec.model||result.model.startsWith(spec.model+'-');
   const rejected=result.reason==='provider_request_rejected'&&sameModel;
   const known=result.usage!==null&&sameModel;
   // Admission settles at the configured conservative price ceiling. Cached
   // tokens remain in input totals; reasoning is already inside output totals.
   // This estimate is not an assertion about the provider's final invoice.
   const estimatedCost=rejected?'0':known?((BigInt(result.usage!.inputTokens)*BigInt(spec.inputPriceMicroUsdPerMillion)+BigInt(result.usage!.outputTokens)*BigInt(spec.outputPriceMicroUsdPerMillion)+BigInt(999999))/BigInt(1000000)).toString():null;
   const reservations=(await c.query('SELECT r.account_id,a.unit FROM agent_budget_reservations r JOIN agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=$1 ORDER BY r.account_id',[op.id])).rows;
   if(reservations.length!==6)throw new Error('Exact recorded model reservations required');
   await c.query('SELECT agent_settle_budget($1::uuid,$2::jsonb)',[op.id,JSON.stringify(reservations.map(r=>({accountId:r.account_id,actual:r.unit==='calls'?'1':estimatedCost})))]);
   const state=rejected?'failed':known?(result.response?'complete':'failed'):'uncertain';
   const saved={...result,receiptDigest:resultDigest,estimatedCostMicroUsd:estimatedCost,costBasis:'configured_price_ceiling_no_cached_discount',usageDetails:rejected?'not_executed':result.usage===null?'unknown':result.usage.cachedInputTokens===undefined?'not_recorded':'reported'};
   await c.query('UPDATE agent_operations SET state=$2,result=$3,lease_until=NULL,updated_at=now() WHERE id=$1',[op.id,state,JSON.stringify(saved)]);
   await this.emit(c,t,'model-receipt:'+op.id,'model.accounted',{operationId:op.id,state,estimatedCostMicroUsd:estimatedCost});return saved;
  });
 }
}
