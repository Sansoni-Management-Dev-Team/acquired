import 'server-only';
import type {CampaignActor} from '@/db/campaign-client';
import {replyReviewCodes,type ReplyChannel} from '@/domain/campaign-replies';
import {ReplyCheckPending,ReplyCheckReview} from '@/lib/campaign-reply-status';
import {assertSubmissionReceiptMatches,assertSameBinding,type DeliveryOutcome,type MessageSubmission,type Readiness,type ReceiptLookup} from '../../../communications/packages/contracts/src';
import {messageDigest} from '../../../communications/packages/core/src/message-digest';
import type {CommunicationsClient} from '../../../communications/packages/sdk/src';
import type {CampaignDeliveryProvider,DeliveryInput,DeliveryLookupInput} from './delivery-provider';
export interface CommunicationsDeliveryPorts {
 prepare(input:DeliveryInput):Promise<MessageSubmission>;
 original(input:DeliveryLookupInput):Promise<ReceiptLookup|null>;
 readiness(actor:CampaignActor):Promise<Readiness>;
 client(actor:CampaignActor):Promise<Pick<CommunicationsClient,'submit'|'lookup'>&Partial<Pick<CommunicationsClient,'lookupDetails'>>>;
}
/** Acquire translates domain outcomes; durable preparation resolves the original stored
 * binding/content/epoch. This bridge never reads a default to recover an old attempt. */
export function createCommunicationsDeliveryProvider(channel:ReplyChannel,ports:CommunicationsDeliveryPorts):CampaignDeliveryProvider{
 const prepare=Function.prototype.bind.call(ports.prepare,ports),original=Function.prototype.bind.call(ports.original,ports),readiness=Function.prototype.bind.call(ports.readiness,ports),client=Function.prototype.bind.call(ports.client,ports);
 function scoped(binding:MessageSubmission['snapshot']['binding'],actor:CampaignActor){assertSameBinding(binding,binding);if(binding.applicationId!=='acquire'||binding.backend!=='unipile'||binding.channel!==channel||binding.tenantId!==actor.organizationId||binding.ownerId!==actor.userId)throw new ReplyCheckReview('account_changed',channel);}
 function translated(result:DeliveryOutcome|null,lookup:ReceiptLookup):import('@/domain/channel-delivery').DeliveryOutcome|null{
  if(result===null)return null;
  if(result.status==='unknown')return {status:'unknown'};
  if(result.status==='waiting')return {status:'waiting',code:result.code,retryAt:result.retryAt??new Date(Date.now()+60000).toISOString()};
  if(result.status==='review')return {status:'review',code:replyReviewCodes.includes(result.code as never)?result.code as typeof replyReviewCodes[number]:'protocol'};
  if(result.status!=='submitted')return {status:'review',code:'protocol'};
  const r=result.receipt;assertSubmissionReceiptMatches(lookup.snapshot,lookup.expectedRecipient??r.recipient,r);
  if(lookup.message&&(!('message'in r)||r.message.id!==lookup.message.id))return {status:'unknown'};
  if(!r.submittedAt||!Number.isFinite(Date.parse(r.submittedAt)))return {status:'unknown'};
  if(lookup.snapshot.operation==='message'&&!('message'in r)||lookup.snapshot.operation==='invitation'&&!('operation'in r))return {status:'unknown'};
  return {status:'submitted',id:'message'in r?r.message.id:r.operation.id,sentAt:r.submittedAt,...('conversation'in r&&r.conversation?{threadId:r.conversation.id}:{})};
 }
 async function supplemental(api:Awaited<ReturnType<CommunicationsDeliveryPorts['client']>>,result:DeliveryOutcome|null,lookup:ReceiptLookup):Promise<DeliveryOutcome|null>{
  if(result?.status!=='submitted'||result.receipt.submittedAt||!api.lookupDetails)return result;
  const accepted=result.receipt,details=await api.lookupDetails({...lookup,...('message'in accepted?{message:accepted.message}:{}),expectedRecipient:accepted.recipient});
  if(details?.status!=='submitted')return null;const learned=details.receipt;
  if('message'in accepted&&(!('message'in learned)||learned.message.id!==accepted.message.id)||'operation'in accepted&&(!('operation'in learned)||learned.operation.id!==accepted.operation.id))return null;
  return details;
 }
 return {channel,capabilities:{durableIdempotency:true,receiptLookup:true,connectionRequests:channel==='linkedin'},
  async ready(actor){const r=await readiness(structuredClone(actor));if(r.status==='waiting')throw new ReplyCheckPending(r.code,channel,r.retryAt?new Date(r.retryAt):undefined);if(r.status==='review')throw new ReplyCheckReview(replyReviewCodes.includes(r.code as never)?r.code as typeof replyReviewCodes[number]:'protocol',channel);if(r.status!=='ready')throw new ReplyCheckReview('protocol',channel);},
  async submit(value){const input=structuredClone(value),s=structuredClone(await prepare(structuredClone(input)));scoped(s.snapshot.binding,input.actor);
   const kind={email:'email',whatsapp:'phone',linkedin:'linkedin_profile'}[channel],recipient=channel==='email'?input.recipient.trim().toLowerCase():input.recipient;
   if(s.message.recipient.kind!==kind||s.message.recipient.value!==recipient||s.message.text!==input.text||s.message.subject!==input.subject||s.snapshot.operation!==(input.operation==='connect'?'invitation':'message')||messageDigest(s.snapshot.operation,s.message)!==s.snapshot.payloadDigest)throw new ReplyCheckReview('protocol',channel);
   const api=await client(input.actor);try{const lookup={snapshot:s.snapshot,expectedRecipient:s.message.recipient};return translated(await supplemental(api,await api.submit(s),lookup),lookup)??{status:'unknown'};}catch{return {status:'unknown'};}
  },
  async lookup(value){const input=structuredClone(value),lookup=structuredClone(await original(input));if(!lookup)return {status:'review',code:'unresolved_send'};scoped(lookup.snapshot.binding,input.actor);
   const api=await client(input.actor);try{return translated(await supplemental(api,await api.lookup(lookup),lookup),lookup);}catch{return {status:'unknown'};}
  },
 };
}
