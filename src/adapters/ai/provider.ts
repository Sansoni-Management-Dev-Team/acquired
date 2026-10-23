import { OpenAiStructuredProvider } from "./openai-provider";
import type { AiProvider } from "./types";
import { OpenRouterAiProvider } from "./openrouter";
import { FreeOpenRouterAiProvider } from "./free-provider";

export type AiProviderName = "openrouter" | "openrouter-free" | "openai" | "anthropic";

export function createAiProvider(name = process.env.AI_PROVIDER): AiProvider {
  if (name === "anthropic") return new AnthropicStructuredProvider();
  if (name === "openai") return new OpenAiStructuredProvider();
  if (name === "openrouter") return new OpenRouterAiProvider();
  if (name === "openrouter-free") return new FreeOpenRouterAiProvider();
  throw new Error('AI_PROVIDER must be explicitly set to "openai", "openrouter", "openrouter-free" or "anthropic"');
}


import {z} from 'zod';
import {completeOpenAiJson,OpenAiProviderRejection,OpenAiResponseFailure} from './openai';
import {completeAnthropicJson} from './anthropic';
import {AiCompletionError} from './errors';
import type {AiCompletion} from './types';
/** Shared single-attempt foundation. Selection is server-owned; never retry here. */
export const completeAiJson:AiCompletion=async(input,options={})=>{
 const provider=options.provider??'openai';
 if(input.signal?.aborted)throw new AiCompletionError('cancelled','rejected');
 if(provider!=='openai'&&provider!=='anthropic'||!options.model||!Number.isSafeInteger(input.max_tokens)||input.max_tokens<=0||input.timeoutMs!==undefined&&(!Number.isSafeInteger(input.timeoutMs)||input.timeoutMs<=0))throw new AiCompletionError('unsupported_request','rejected');
 let validator:ReturnType<typeof z.fromJSONSchema>;
 try{validator=z.fromJSONSchema(input.json_schema);}catch{throw new AiCompletionError('unsupported_request','rejected');}
 const timeout=AbortSignal.timeout(Math.min(input.timeoutMs??30000,40000));
 const signal=input.signal?AbortSignal.any([input.signal,timeout]):timeout;
 try{
  const result=await (provider==='anthropic'?completeAnthropicJson:completeOpenAiJson)({...input,requireUsage:true,timeoutMs:Math.min(input.timeoutMs??30000,40000),signal},options);
  if(signal.aborted)throw new AiCompletionError(input.signal?.aborted?'cancelled':'timeout','response');
  // OpenAI aliases can resolve to an immutable dated snapshot. A different
  // model family or arbitrary suffix cannot authorize an executable response.
  if(result.model!==options.model&&!(provider==='openai'&&result.model.startsWith(options.model+'-')&&/^\d{4}-\d{2}-\d{2}$/.test(result.model.slice(options.model.length+1))))throw new AiCompletionError('usage_invalid','response');
  if(!validator.safeParse(result.response).success)throw new AiCompletionError('schema_validation','response');
  return result;
 }catch(error){
  if(timeout.aborted&&!input.signal?.aborted)throw new AiCompletionError('timeout',error instanceof AiCompletionError?error.outcome:'unknown');
  throw normalizeAiError(error);
 }
};

export function normalizeAiError(error:unknown):AiCompletionError{
 if(error instanceof AiCompletionError)return error;
 if(error instanceof OpenAiProviderRejection)return new AiCompletionError(error.rejection.category==='authentication_or_policy'?'authentication':'unsupported_request','rejected',error.rejection);
 if(error instanceof OpenAiResponseFailure)return new AiCompletionError(error.category,'response');
 return new AiCompletionError('unknown');
}

class AnthropicStructuredProvider implements AiProvider {
 readonly name='anthropic';
 readonly model=process.env.ANTHROPIC_MODEL??'claude-haiku-5-5';
 isConfigured(){return Boolean(process.env.ANTHROPIC_API_KEY);}
 async generateStructured(request:import('./types').AiStructuredRequest){
  const result=await completeAiJson({operation:request.name,messages:[{role:'system',content:request.system},{role:'user',content:request.user}],json_schema:request.schema,max_tokens:request.maxTokens??2000,requireUsage:true},{provider:'anthropic',model:this.model});
  return {json:result.response,model:result.model,usage:result.usage};
 }
}
