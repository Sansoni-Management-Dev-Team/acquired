import {z} from 'zod';
import {agentRecordDigest as digest} from '@/db/agent-store';
export const nativeResearchRequestClassSchema=z.enum(['company_search','company_profile','auth','people_search','person_profile','phone_reveal','unsupported']);
export const nativeResearchAttemptSchema=z.object({researchOperationId:z.string().uuid(),researchJobId:z.string().uuid(),targetId:z.string().uuid().optional(),provider:z.enum(['search','page','ai','firmable']),requestClass:nativeResearchRequestClassSchema.optional(),requestDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const nativeResearchProviderReceiptSchema=z.object({actualCostMicroUsd:z.string().regex(/^(0|[1-9]\d{0,11})$/).nullable(),costBasis:z.enum(['observed_provider_usage','configured_rate_estimate','unknown']),response:z.json().optional(),reason:z.enum(['request_outcome_unknown','response_invalid']).optional()}).strict().refine(v=>(v.actualCostMicroUsd===null)===(v.costBasis==='unknown'),'Unknown cost must remain unknown');
export interface NativeResearchRequestPort{
 beginNativeResearchAttempt(threadId:string,key:string,input:unknown):Promise<{kind:'started';operationId:string;fence:string}|{kind:'cached';response:unknown}>;
 finishNativeResearchAttempt(threadId:string,operationId:string,fence:string,result:unknown):Promise<unknown>;
}
/** Wrap ONE physical request, never a retrying logical adapter. The transport
 * callback must disable its own retries; each further attempt needs a new key.
 * Network uncertainty remains reserved and cannot be replayed as another call. */
export async function performNativeResearchProviderRequest<T>(options:{store:NativeResearchRequestPort;threadId:string;key:string;request:{researchOperationId:string;researchJobId:string;provider:'search'|'page'|'ai'|'firmable';payload:unknown};execute:()=>Promise<{response:T;actualCostMicroUsd:string|null;costBasis:'observed_provider_usage'|'configured_rate_estimate'|'unknown'}>}){
 const {payload,...scope}=options.request;
 const begun=await options.store.beginNativeResearchAttempt(options.threadId,options.key,{...scope,requestDigest:digest(payload)});
 if(begun.kind==='cached')return begun.response as T;
 let observed:Awaited<ReturnType<typeof options.execute>>;
 try{observed=await options.execute();}
 catch(error){await options.store.finishNativeResearchAttempt(options.threadId,begun.operationId,begun.fence,{actualCostMicroUsd:null,costBasis:'unknown',reason:'request_outcome_unknown'});throw error;}
 const receipt=nativeResearchProviderReceiptSchema.safeParse(observed);
 if(!receipt.success){await options.store.finishNativeResearchAttempt(options.threadId,begun.operationId,begun.fence,{actualCostMicroUsd:null,costBasis:'unknown',reason:'response_invalid'});throw new Error('Provider result needs reconciliation');}
 await options.store.finishNativeResearchAttempt(options.threadId,begun.operationId,begun.fence,receipt.data);
 return receipt.data.response as T;
}
