import 'server-only';
import {withCampaignDb,type CampaignActor} from '@/db/campaign-client';
import type {DeliveryOutcome} from '@/domain/channel-delivery';
import {deliveryProvider} from '@/lib/channels/delivery-registry';
import {refreshConfiguredDraft} from './communications-configured-monitor';
import {outreachEmail} from '@/domain/outreach-contact';
import {ReplyCheckReview} from './campaign-reply-status';
/** Approval and send are separate actions. Dispatch persists its original intent before
 * provider I/O; an uncertain result is recovered against that same recorded intent. */
export async function sendSavedOutreachDraft(actor:CampaignActor,id:string):Promise<DeliveryOutcome>{
 const saved=await withCampaignDb(actor,async c=>{
  const r=await c.query(`SELECT m.id,m.state,m.subject,m.body,m.updated_at,m.sent_at,m.provider_message_id,m.provider_thread_id,c.personal_data FROM public.messages m JOIN public.sequence_enrolments e ON e.id=m.enrolment_id AND e.organization_id=m.organization_id JOIN public.contacts c ON c.id=e.contact_id AND c.organization_id=m.organization_id JOIN public.outreach_draft_bindings w ON w.message_id=m.id AND w.organization_id=m.organization_id WHERE m.id=$1 AND m.organization_id=$2 AND w.owner_user_id=$3`,[id,actor.organizationId,actor.userId]);
  if(r.rows.length!==1)throw new ReplyCheckReview('account_changed','email');return r.rows[0];
 });
 if(saved.state==='sent'&&saved.provider_message_id&&saved.sent_at)return {status:'submitted',id:saved.provider_message_id,sentAt:new Date(saved.sent_at).toISOString(),...(saved.provider_thread_id?{threadId:saved.provider_thread_id}:{})};
 if(saved.state!=='approved')throw new ReplyCheckReview('delivery_disabled','email');
 const provider=deliveryProvider('email'),lookup={actor,key:`draft:${id}`,draftId:id,draftRevision:new Date(saved.updated_at).toISOString()};
 const prior=await withCampaignDb(actor,async c=>(await c.query(`SELECT id FROM public.communication_dispatch_intents WHERE organization_id=$1 AND owner_user_id=$2 AND source_kind='draft' AND source_id=$3 LIMIT 1`,[actor.organizationId,actor.userId,id])).rows.length>0);
 let result:DeliveryOutcome;
 let recovered:DeliveryOutcome|null=null;if(prior){recovered=await provider.lookup(lookup);if(!recovered)return {status:'unknown'};if(recovered.status==='unknown'||recovered.status==='review')return recovered;}
 if(recovered?.status==='submitted')result=recovered;else{const recipient=outreachEmail(saved.personal_data?.email);if(!recipient)throw new ReplyCheckReview('protocol','email');await refreshConfiguredDraft(actor,id);result=await provider.submit({...lookup,recipient,text:saved.body,subject:saved.subject,messageId:`<acquire-draft-${id}@outreach.project-acquire.invalid>`});}
 if(result.status!=='submitted')return result;
 if(!result.sentAt||!Number.isFinite(Date.parse(result.sentAt))||Date.parse(result.sentAt)>Date.now())return {status:'unknown'};
 try{return await withCampaignDb(actor,async c=>{
  const updated=await c.query(`UPDATE public.messages SET state='sent',provider_message_id=$4,provider_thread_id=$5,sent_at=$6::timestamptz,updated_at=clock_timestamp() WHERE id=$1 AND organization_id=$2 AND EXISTS(SELECT 1 FROM public.outreach_draft_bindings w WHERE w.message_id=messages.id AND w.organization_id=$2 AND w.owner_user_id=$3) AND subject=$7 AND body=$8 AND state IN('approved','sent') AND (provider_message_id IS NULL OR provider_message_id=$4) RETURNING id`,[id,actor.organizationId,actor.userId,result.id,result.threadId??null,result.sentAt,saved.subject,saved.body]);
  if(updated.rows.length!==1)throw Error('Receipt materialization unavailable');return result;
 });}catch{return {status:'unknown'};}
}
