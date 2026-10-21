import 'server-only';
import type {ReplyChannel} from '@/domain/campaign-replies';
import type {CampaignDeliveryProvider} from './delivery-provider';
import {createCommunicationsDeliveryProvider} from './communications-delivery';
import {resolveRecordedApplicationConnection} from '@/lib/communications-bindings';
import {configuredAcquireCommunicationsForBinding} from '@/lib/communications-configuration';
import {actorCommunicationsClient} from '@/lib/communications-client';
import {withCampaignDb} from '@/db/campaign-client';
import {ReplyCheckReview,ReplyCheckPending} from '@/lib/campaign-reply-status';
import type {DeliveryInput,DeliveryLookupInput} from './delivery-provider';
import type {AcquireIntentSource} from '@/lib/campaign-send-admission';
import{captureOriginalSubmission}from'@/lib/communications-submission-projection';
import{assertSameBinding}from'../../../communications/packages/contracts/src';
import type {MessageSubmission} from '../../../communications/packages/contracts/src';
export function configuredCommunicationsProvider(channel:ReplyChannel):CampaignDeliveryProvider{
 async function authority(input:DeliveryLookupInput){
  if(!!input.enrolmentId===!!input.draftId)throw new ReplyCheckReview('protocol',channel);
  const recorded=await resolveRecordedApplicationConnection(input.actor,channel,input.enrolmentId?{enrolmentId:input.enrolmentId}:{draftId:input.draftId});
  if(!recorded)throw new ReplyCheckReview('account_changed',channel);
  // An authenticated read renews bounded service authority before local intent work.
  await (await actorCommunicationsClient(input.actor)).connectionStatus(recorded.binding);
  return {...recorded,admission:await (await configuredAcquireCommunicationsForBinding(input.actor,recorded.binding)).host.admission(recorded.binding)};
 }
 function source(input:DeliveryInput):AcquireIntentSource{
  if(input.draftId){if(channel!=='email'||!input.draftRevision)throw new ReplyCheckReview('protocol',channel);return {kind:'draft',messageId:input.draftId,revision:input.draftRevision};}
  if(!input.attemptId||!input.enrolmentId||!input.sourceVersionId||!input.stepId||!Number.isSafeInteger(input.stepIndex)||!['legacy','n8n'].includes(input.runtime??''))throw new ReplyCheckReview('protocol',channel);
  return {kind:'campaign',attemptId:input.attemptId,enrolmentId:input.enrolmentId,versionId:input.sourceVersionId,stepId:input.stepId,stepIndex:input.stepIndex!,runtime:input.runtime!};
 }
 return createCommunicationsDeliveryProvider(channel,{
  client:actorCommunicationsClient,
  async recordSubmitted(input,lookup,result){const recorded=await resolveRecordedApplicationConnection(input.actor,channel,input.enrolmentId?{enrolmentId:input.enrolmentId}:{draftId:input.draftId});if(!recorded)throw new ReplyCheckReview('account_changed',channel);assertSameBinding(recorded.binding,lookup.snapshot.binding);const sourceId=input.draftId??input.attemptId;if(!sourceId)throw new ReplyCheckReview('protocol',channel);const r=result.receipt;if(lookup.snapshot.operation!=='message'&&lookup.snapshot.operation!=='invitation')throw new ReplyCheckReview('protocol',channel);await captureOriginalSubmission(input.actor,{bindingId:recorded.bindingId,binding:lookup.snapshot.binding,sourceKind:input.draftId?'draft':'campaign',sourceId},{effect:lookup.snapshot.operation,providerReference:'message'in r?r.message.id:r.operation.id,submittedAt:r.submittedAt!});},
  async readiness(actor){const snapshot=await (await actorCommunicationsClient(actor)).connections({applicationId:'acquire',tenantId:actor.organizationId,ownerId:actor.userId});if(!snapshot.available)return {status:'waiting',code:'unavailable'};const selected=snapshot.connections.find(c=>c.binding.channel===channel&&c.isDefault);return selected?.readiness??{status:'review',code:'reconnect'};},
  async prepare(input){
   const capturedSource=source(input),a=await authority(input);if(a.recoveryOnly)throw new ReplyCheckReview('unresolved_send',channel);
   const scopes=await withCampaignDb(input.actor,async client=>{
    const sql=input.enrolmentId?`SELECT m.binding_id,m.scope_digest FROM public.campaign_channel_bindings w JOIN public.communication_reply_monitors m ON m.binding_id=w.binding_id AND m.organization_id=w.organization_id AND m.owner_user_id=w.owner_user_id WHERE w.enrolment_id=$1 AND w.organization_id=$2 AND w.owner_user_id=$3`:`SELECT m.binding_id,m.scope_digest FROM public.outreach_draft_bindings w JOIN public.communication_reply_monitors m ON m.binding_id=w.binding_id AND m.organization_id=w.organization_id AND m.owner_user_id=w.owner_user_id WHERE w.message_id=$1 AND w.organization_id=$2 AND w.owner_user_id=$3`;
    const result=await client.query<{binding_id:string;scope_digest:string}>(sql,[input.enrolmentId??input.draftId,input.actor.organizationId,input.actor.userId]);
    if(result.rows.length<1||result.rows.length>3||new Set(result.rows.map(r=>r.binding_id)).size!==result.rows.length||result.rows.some(r=>!r.binding_id||! /^[a-f0-9]{64}$/.test(r.scope_digest)))throw new ReplyCheckPending('incomplete',channel);
    return result.rows.map(r=>({bindingId:r.binding_id,scopeDigest:r.scope_digest}));
   });
   const message:MessageSubmission['message']={recipient:{kind:channel==='email'?'email':channel==='whatsapp'?'phone':'linkedin_profile',value:channel==='email'?input.recipient.trim().toLowerCase():input.recipient},text:input.text,...(input.subject===undefined?{}:{subject:input.subject}),...(channel==='email'&&input.messageId?{rfcMessageId:input.messageId}:{})};
   return (await a.admission.prepare({source:capturedSource,message,coverageScopes:scopes})).submission;
  },
  async original(input){const a=await authority(input),sourceId=input.attemptId??input.draftId;if(!sourceId)return null;const original=await a.admission.getPreparedIntent({sourceKind:input.draftId?'draft':'campaign',sourceId});if(!original)return null;return {snapshot:original.submission.snapshot,expectedRecipient:original.submission.message.recipient};}
 });
}
