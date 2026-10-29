import {z} from 'zod';
import {contactChannelReviewedNotice} from '@/domain/agent-chat-notice';
import {plainAgentStatusText} from './agent-chat-status-copy';
import {emptyAgentTargetNotice} from './agent-target-empty-notice';
import type {AgentNoticeKind,AgentLeadUpdate} from '@/domain/agent-chat-notice';
export type SavedAgentMessage={id:string;role:'user'|'assistant';content:string;noticeKind?:AgentNoticeKind;lead?:AgentLeadUpdate;failure?:{eventId:string;runId:string}};
const joinedLead=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(200),company:z.string().trim().min(1).max(300).optional()});
const replyPreview=z.object({text:z.string().min(1).max(500),channel:z.enum(['email','whatsapp','linkedin']),at:z.string().datetime({offset:true})});
const channelNoticeDetails=z.object({routeId:z.string().uuid(),conversationId:z.string().uuid(),bindingId:z.string().uuid(),channel:z.enum(['email','whatsapp','linkedin']),policyRevision:z.number().int().positive()});
function record(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
/** Project only saved display text and narrowly verified notice provenance.
 * Never expose request keys, recipients, bindings or arbitrary stored details. */
export function savedAgentMessages(records:readonly unknown[]):SavedAgentMessage[]{
 let previousEmptySignature:string|undefined;
 return records.flatMap(raw=>{
  const emptySelection=emptyAgentTargetNotice(raw),repeated=emptySelection&&emptySelection.signature===previousEmptySignature;
  previousEmptySignature=emptySelection?.signature;
  if(repeated)return [];
  const row=record(raw),content=record(row.content);
  if(typeof row.id!=='string'||row.role!=='user'&&row.role!=='assistant'||typeof content.text!=='string')return [];
  let noticeKind:SavedAgentMessage['noticeKind'];
  if(row.role==='assistant'&&content.text===contactChannelReviewedNotice){
   const details=channelNoticeDetails.safeParse(content.details);
   if(details.success&&row.request_key==='channel-route:'+details.data.routeId)noticeKind='contact_channel_reviewed';
  }
  const display=plainAgentStatusText(row)??content.text,details=record(content.details),key=typeof row.request_key==='string'?row.request_key:'';
  if(row.role==='assistant'&&z.string().uuid().safeParse(details.executionId).success&&key===`initial-welcome:v1:${details.executionId}`)noticeKind='welcome';
  let lead:AgentLeadUpdate|undefined;
  const person=joinedLead.safeParse({id:row.lead_conversation_id,name:row.lead_name,...(row.lead_company?{company:row.lead_company}:{})});
  if(row.role==='assistant'&&person.success&&display!==content.text&&/^(channel-incoming:|incoming-email:|draft-notice:|human-review:|event-review:|provider-outcome:|provider-history-resumed:|no-submission:|reminder-notice:|history-conflict:|route-history-conflict:|opt-out:|delivery-failure:)/.test(key)){
   const kind=key.startsWith('draft-notice:')?'draft':/^(channel-incoming:|incoming-email:)/.test(key)&&details.verifiedReply!==false?'reply':/^(human-review:|event-review:|no-submission:|history-conflict:|route-history-conflict:|delivery-failure:)/.test(key)||details.status==='unknown'?'attention':'status';
   const preview=replyPreview.safeParse(row.lead_reply);
   lead={...person.data,kind,...(kind==='reply'&&preview.success?{reply:preview.data}:{})};noticeKind='lead_update';
  }
  if(row.role==='assistant'&&/^target-(plan|result):[a-f\d-]{36}$/i.test(key)&&z.string().uuid().safeParse(details.operationId).success&&/^\d+ contacts allocated|^Review \d+ cached contacts/.test(content.text))noticeKind='routine_activity';
  if(row.role==='assistant'&&/^review:[a-f\d-]{36}:approved$/i.test(key)&&content.approvalSource==='automatic_demo'&&content.reviewBatchId===key.split(':')[1]&&content.text==='Automatically approved these demo items. I’ll check that everything is ready before continuing.')noticeKind='routine_activity';
  if(row.role==='user'&&/^review:[a-f\d-]{36}:(approved|rejected)$/i.test(key)&&content.reviewBatchId===key.split(':')[1]&&content.decision===key.split(':')[2]&&display!==content.text)noticeKind='review_decision';
  if(row.role==='assistant'&&(
   /^demo-contacts:[a-f0-9-]{36}$/i.test(key)&&key==='demo-contacts:'+details.requestKey&&z.string().uuid().safeParse(details.demoRunId).success&&Number.isInteger(details.count)&&content.text===`Prepared ${details.count} simulated contacts for this demo. The company and person research stays real. This preparation does not approve or send messages.`
   ||/^channel-policy:[1-9][0-9]*$/.test(key)&&details.policyRevision===Number(key.split(':')[1])&&display!==content.text
  ))noticeKind='routine_activity';
  if(row.role==='assistant'&&(
   /^runtime-registration:[a-f0-9-]{36}:[1-9][0-9]*$/i.test(key)&&z.string().uuid().safeParse(details.responsibilityId).success&&key===`runtime-registration:${details.responsibilityId}:${details.responsibilityRevision}`&&content.text==='This mandate is registered for background work. Budget limits do not approve messages; outreach still requires its current review and exact account.'
   ||/^command-notice:[a-f0-9-]{36}$/i.test(key)&&details.status==='ready'&&display!==content.text
   ||/^initial-cached-demo-ready:v2:[a-f0-9-]{36}$/i.test(key)&&details.source==='cached'&&Number.isInteger(details.companies)&&Number.isInteger(details.people)
  ))noticeKind='setup_activity';
  const failureIds=z.object({triggerEventId:z.string().uuid(),runId:z.string().uuid()}).safeParse(content);
  const failure=row.role==='assistant'&&failureIds.success&&new RegExp('^event-review:'+failureIds.data.triggerEventId+':[1-9][0-9]*$','i').test(key)?{eventId:failureIds.data.triggerEventId,runId:failureIds.data.runId}:undefined;
  const message:SavedAgentMessage={id:row.id,role:row.role as 'user'|'assistant',content:display,...(noticeKind?{noticeKind}:{}),...(lead?{lead}:{}),...(failure?{failure}:{})};
  return [message];
 });
}
