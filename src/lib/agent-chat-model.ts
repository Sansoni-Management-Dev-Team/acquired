import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {AgentModelStore} from '@/db/agent-model-store';
import {completeAiJson,normalizeAiError} from '@/adapters/ai/provider';
import {AiCompletionError} from '@/adapters/ai/errors';
import type {AiCompletionUsage} from '@/adapters/ai/types';
import {configuredAgentModelSpecification,modelUsageCostMicroUsd} from '@/adapters/ai/model-specification';
const usageSchema=z.object({inputTokens:z.number().int().positive().max(1000000),outputTokens:z.number().int().nonnegative().max(1000000),cachedInputTokens:z.number().int().nonnegative().max(1000000),reasoningTokens:z.number().int().nonnegative().max(1000000).optional(),cacheWrite5mTokens:z.number().int().nonnegative().max(1000000).optional(),cacheWrite1hTokens:z.number().int().nonnegative().max(1000000).optional(),cacheWriteTokens:z.number().int().nonnegative().max(1000000).optional()}).strict().refine(v=>v.cachedInputTokens+(v.cacheWriteTokens??0)<=v.inputTokens&&(v.reasoningTokens??0)<=v.outputTokens);
/** One answer+proposal attempt. Validation happens before saving the model
 * receipt; callers still recheck current state before proposing any tool work. */
export async function runBudgetedChatModel<T>(options:{store:Pick<AgentModelStore,'beginChatModel'|'finishChatModel'>;threadId:string;answerOperationId:string;messages:{role:string;content:string}[];schema:Record<string,unknown>;validate:(value:unknown)=>T;signal?:AbortSignal;complete?:typeof completeAiJson}):Promise<T>{
 const nativeModelSpecification=configuredAgentModelSpecification();
 const serialized=JSON.stringify({messages:options.messages,schema:options.schema});
 if(new TextEncoder().encode(serialized).length>48000)throw Error('Chat model request exceeds reviewed context bound');
 const started=await options.store.beginChatModel(options.threadId,options.answerOperationId,{...nativeModelSpecification,promptVersion:'native-chat-v2-cache-write-ceiling',requestDigest:createHash('sha256').update(serialized).digest('hex')});
 if(started.kind==='cached')return options.validate(started.response);
 let usage:AiCompletionUsage|null=null,model:string=nativeModelSpecification.model,response:T;
 try{
  const result=await (options.complete??completeAiJson)({operation:'agent_chat_decision',messages:options.messages,json_schema:options.schema,max_tokens:nativeModelSpecification.maxOutputTokens,timeoutMs:30000,signal:options.signal,requireUsage:true},{provider:'provider' in nativeModelSpecification?nativeModelSpecification.provider:'openai',model,onUsage:(value,actualModel)=>{const parsed=usageSchema.safeParse(value);usage=parsed.success?parsed.data:null;model=actualModel;}});
  usage=usageSchema.parse(result.usage);model=result.model;if(modelUsageCostMicroUsd(nativeModelSpecification,usage,model)===null)throw new AiCompletionError('usage_invalid','response');if(options.signal?.aborted)throw new AiCompletionError('cancelled');response=options.validate(result.response);
 }catch(rawError){
  const error=normalizeAiError(rawError);
  await options.store.finishChatModel(options.threadId,started.operationId,started.fence,error instanceof AiCompletionError&&error.outcome==='rejected'&&error.rejection&&usage===null?{model,usage:null,reason:'provider_request_rejected',rejection:error.rejection}:{model,usage,reason:usage?'provider_response_invalid':'provider_outcome_unknown'});
  throw Error('The saved chat model attempt needs review; no fallback or retry was started.');
 }
 await options.store.finishChatModel(options.threadId,started.operationId,started.fence,{response,model,usage});return response;
}
