import {z} from 'zod';
/** Historical operations retain their original ceiling and receipt semantics.
 * Existing review: 2026-10-17, https://developers.openai.com/api/docs/models/gpt-6-luna
 * 125000 micro-USD/M input includes the 1.25x cache-write admission ceiling. */
export const nativeModelSpecification={model:'gpt-6-luna',maxInputTokens:64000,maxOutputTokens:2000,inputPriceMicroUsdPerMillion:'125000',outputPriceMicroUsdPerMillion:'500000',promptVersion:'native-conversation-v9-exact-channel-schema'} as const;
export const nativeEvaluationNanoSpecification={...nativeModelSpecification,model:'gpt-5-nano',inputPriceMicroUsdPerMillion:'50000',outputPriceMicroUsdPerMillion:'400000'} as const;
const price=z.string().regex(/^(0|[1-9]\d{0,11})$/);
export const modelRatesSchema=z.object({input:price,cachedInput:price,cacheWrite5m:price,cacheWrite1h:price,output:price,longContextThreshold:z.number().int().positive(),longContextMultiplier:z.number().int().positive()}).strict();
/** Reviewed 2026-10-24: USD / million tokens, converted to micro-USD / million.
 * https://platform.claude.com/docs/en/about-claude/pricing
 * Global standard Messages requests: .10 input, .50 output, .01 cache reads,
 * .125 5-minute writes, .20 1-hour writes; all rates x5 above 100,000 total
 * input tokens. No batch, geographic, fast-mode or server-tool modifiers.
 * Admission uses the most expensive short-context input category; settlement
 * records every reported category and any observed context overrun.
 */
export const anthropicModelSpecification={...nativeModelSpecification,provider:'anthropic',model:'claude-haiku-5-5',pricingVersion:'anthropic-haiku-5-5-global-2026-10-24',inputPriceMicroUsdPerMillion:'200000',rates:{input:'100000',cachedInput:'10000',cacheWrite5m:'125000',cacheWrite1h:'200000',output:'500000',longContextThreshold:100000,longContextMultiplier:5}} as const;
export function configuredAgentModelSpecification(env:Record<string,string|undefined>=process.env){
 const provider=env.AGENT_AI_PROVIDER??'openai';
 if(provider==='openai'&&(!env.AGENT_DECISION_MODEL||env.AGENT_DECISION_MODEL===nativeModelSpecification.model))return nativeModelSpecification;
 if(provider==='anthropic'&&env.AGENT_DECISION_MODEL===anthropicModelSpecification.model)return anthropicModelSpecification;
 throw Error('Agent provider/model needs reviewed pricing and evaluation');
}
type Specification={model:string;provider?:'openai'|'anthropic';pricingVersion?:string;inputPriceMicroUsdPerMillion:string;outputPriceMicroUsdPerMillion:string;rates?:z.infer<typeof modelRatesSchema>};
type Usage={inputTokens:number;outputTokens:number;cachedInputTokens?:number;reasoningTokens?:number;cacheWriteTokens?:number;cacheWrite5mTokens?:number;cacheWrite1hTokens?:number};
export function matchesRecordedModel(spec:Specification,actualModel:string){return actualModel===spec.model||spec.provider!=='anthropic'&&actualModel.startsWith(spec.model+'-');}
/** Returns null for incomplete/inconsistent accounting, never an invented zero.
 * Only recorded specification values determine historical settlement. */
export function modelUsageCostMicroUsd(spec:Specification,usage:Usage|null,actualModel:string):string|null{
 if(!usage||!matchesRecordedModel(spec,actualModel))return null;
 const values=Object.values(usage);if(values.some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0))||usage.inputTokens<=0)return null;
 const read=usage.cachedInputTokens??0,write=usage.cacheWriteTokens??0;
 if(read+write>usage.inputTokens||(usage.reasoningTokens??0)>usage.outputTokens)return null;
 if(spec.provider!=='anthropic'){
  if((usage.cachedInputTokens===undefined)!==(usage.reasoningTokens===undefined))return null;
  return ((BigInt(usage.inputTokens)*BigInt(spec.inputPriceMicroUsdPerMillion)+BigInt(usage.outputTokens)*BigInt(spec.outputPriceMicroUsdPerMillion)+BigInt(999999))/BigInt(1000000)).toString();
 }
 const rates=spec.rates;
 if(!rates||!spec.pricingVersion||usage.cachedInputTokens===undefined||write>0&&(usage.cacheWrite5mTokens===undefined||usage.cacheWrite1hTokens===undefined))return null;
 const writes5m=usage.cacheWrite5mTokens??0,writes1h=usage.cacheWrite1hTokens??0;
 if(writes5m+writes1h!==write)return null;
 const multiplier=BigInt(usage.inputTokens>rates.longContextThreshold?rates.longContextMultiplier:1);
 const cost=(BigInt(usage.inputTokens-read-write)*BigInt(rates.input)+BigInt(read)*BigInt(rates.cachedInput)+BigInt(writes5m)*BigInt(rates.cacheWrite5m)+BigInt(writes1h)*BigInt(rates.cacheWrite1h)+BigInt(usage.outputTokens)*BigInt(rates.output))*multiplier;
 return ((cost+BigInt(999999))/BigInt(1000000)).toString();
}
