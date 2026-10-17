import {assertSameBinding,assertSubmissionReceiptMatches,type ConnectionBinding,type DeliveryOutcome,type MessageSubmission,type ReceiptLookup} from '../../communications/packages/contracts/src';
import type {CommunicationsClient} from '../../communications/packages/sdk/src';
import type {AcquireSendAdmission,AcquireCoverageScope,AcquireNoSubmissionResolution} from './campaign-send-admission';
import {agentCommunicationsSourceSchema,type AgentCommunicationsIntentSource} from './agent-communications-source';
/** Original-intent lookup always precedes fresh history/source/window checks.
 * A prepared but unconfirmed intent is retained; null lookup is not proof of
 * no submission and never creates another send or operation key. */
export function createAgentCommunicationsDelivery(options:{binding:ConnectionBinding;admission:AcquireSendAdmission;client:Pick<CommunicationsClient,'submit'|'lookup'|'lookupDetails'>}){
 const binding=structuredClone(options.binding);
 if(!['email','whatsapp','linkedin'].includes(binding.channel)||binding.backend!=='unipile'||binding.applicationId!=='acquire')throw Error('Recorded native communications account required');
 assertSameBinding(binding,binding);
 async function validate(raw:DeliveryOutcome|null,lookup:ReceiptLookup):Promise<DeliveryOutcome>{
  let result=raw;if(result===null)return {status:'unknown'};
  if(result.status!=='submitted')return result;
  assertSubmissionReceiptMatches(lookup.snapshot,lookup.expectedRecipient!,result.receipt);
  const invitation=lookup.snapshot.operation==='invitation';
  if(invitation?!('operation'in result.receipt):!('message'in result.receipt))return {status:'unknown'};
  if(!result.receipt.submittedAt){
   const originalId='message'in result.receipt?result.receipt.message.id:result.receipt.operation.id;
   result=await options.client.lookupDetails({...lookup,...('message'in result.receipt?{message:result.receipt.message}:{})});
   if(result?.status!=='submitted')return {status:'unknown'};
   if(invitation){if(!('operation'in result.receipt)||result.receipt.operation.id!==originalId)return {status:'unknown'};}
   else if(!('message'in result.receipt)||result.receipt.message.id!==originalId)return {status:'unknown'};
   assertSubmissionReceiptMatches(lookup.snapshot,lookup.expectedRecipient!,result.receipt);
  }
  if(!result.receipt.submittedAt||!Number.isFinite(Date.parse(result.receipt.submittedAt))||Date.parse(result.receipt.submittedAt)>Date.now())return {status:'unknown'};
  return result;
 }
 async function recover(operationId:string):Promise<{found:false}|{found:true;outcome:DeliveryOutcome}|{found:true;noSubmission:AcquireNoSubmissionResolution}>{
  const original=await options.admission.getPreparedIntent({sourceKind:'agent',sourceId:operationId});
  if(!original)return {found:false};
  assertSameBinding(binding,original.submission.snapshot.binding);const lookup={snapshot:original.submission.snapshot,expectedRecipient:original.submission.message.recipient};
  let outcome:DeliveryOutcome;try{outcome=await validate(await options.client.lookup(lookup),lookup);}catch{outcome={status:'unknown'};}
  if(outcome.status!=='submitted'&&options.admission.resolveNoSubmission){try{const noSubmission=await options.admission.resolveNoSubmission(original.submission.snapshot);if(noSubmission)return {found:true,noSubmission};}catch{/*No proof means no release or retry.*/}}
  return {found:true,outcome};
 }
 return {recover,async dispatch(input:{source:AgentCommunicationsIntentSource;message:MessageSubmission['message'];coverageScopes:AcquireCoverageScope[]}):Promise<DeliveryOutcome>{
  const source=agentCommunicationsSourceSchema.parse(input.source),original=await recover(source.operationId);
  if(original.found)return 'outcome'in original?original.outcome:{status:'unknown'};
  const prepared=await options.admission.prepare(structuredClone(input));assertSameBinding(binding,prepared.submission.snapshot.binding);
  const lookup={snapshot:prepared.submission.snapshot,expectedRecipient:prepared.submission.message.recipient};
  try{return await validate(await options.client.submit(prepared.submission),lookup);}catch{return {status:'unknown'};}
 }};
}
