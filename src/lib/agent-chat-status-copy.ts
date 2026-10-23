import {contactChannelReviewedNotice} from '@/domain/agent-chat-notice';
import {emptyAgentTargetNotice} from './agent-target-empty-notice';
const uuidPattern='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const uuid=new RegExp('^'+uuidPattern+'$','i');
const outcomeKey=new RegExp('^provider-outcome:('+uuidPattern+'):([1-9][0-9]*)$','i');
const resumedKey=new RegExp('^provider-history-resumed:('+uuidPattern+'):([1-9][0-9]*)$','i');
const draftKey=new RegExp('^draft-notice:'+uuidPattern+'$','i');
const notSubmittedKey=new RegExp('^no-submission:('+uuidPattern+')$','i');
const reminderKey=new RegExp('^reminder-notice:'+uuidPattern+'$','i');
const invitationKey=new RegExp('^invitation-outcome:('+uuidPattern+')$','i');
const reviewKey=new RegExp('^review:('+uuidPattern+'):(approved|rejected)$','i');
const eventReviewKey=new RegExp('^event-review:('+uuidPattern+'):([1-9][0-9]*)$','i');
const channels=['email','whatsapp','linkedin']as const;
type Channel=(typeof channels)[number];
function record(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function validUuid(value:unknown):value is string{return typeof value==='string'&&uuid.test(value);}
function leadName(value:unknown){if(typeof value!=='string')return undefined;const name=value.trim().replace(/\s+/g,' ');return name.length>0&&name.length<=200&&!/[\u0000-\u001f\u007f]/u.test(name)?name:undefined;}
function subject(channel:Channel){return channel==='email'?'email':channel==='whatsapp'?'WhatsApp message':'LinkedIn message';}
function submitted(channel:Channel,name?:string){return `Your ${subject(channel)}${name?' to '+name:''} is on its way. I’ll watch for their reply.`;}
function uncertain(channel:Channel,name?:string){return `I couldn’t confirm whether your ${subject(channel)}${name?' to '+name:''} was sent. I’ve paused sending while this is checked.`;}
function draft(channel:Channel,name?:string){return `Your ${channel==='email'?'email':channel==='whatsapp'?'WhatsApp':'LinkedIn'} draft${name?' for '+name:''} is ready to review. It hasn’t been sent.`;}
const conversationLabel=(name?:string)=>name?'the conversation with '+name:'this conversation';
const commandNotices:[string,string,(name?:string)=>string][]=[
 ['human-review','I need your help before continuing this conversation. Automation is held; no message was sent.',name=>`I need your help with ${name?name+'’s conversation':'this conversation'}. Sending is paused; no message was sent.`],
 ['stop','This conversation is stopped. No further automated follow-up will be sent.',name=>`Outreach ${name?'to '+name:'for this conversation'} is stopped. I won’t send more follow-ups.`],
 ['review-history','You requested fresh history from every recorded account. Automation remains held for your separate reassessment decision; old drafts and sending permissions were invalidated.',name=>`I’m refreshing ${conversationLabel(name)}. Sending stays paused until you review it; old approvals no longer apply.`],
 ['review-reassess','You reviewed the current complete history and requested a fresh assessment. Any new message requires new approval; no previous send or approval was retried.',name=>`I’ll review ${conversationLabel(name)} again. Any new message will need your approval.`],
 ['held-history','A fresh recorded-account history check was requested. Automation remains held.',name=>`I’m checking the latest ${name?'conversation with '+name:'conversation'}. Sending is still paused.`],
 ['held-resumed','You resumed this reconciled conversation with fresh verified history. Previous approvals and delegated permissions remain revoked; any new draft needs fresh authority.',name=>`You resumed ${conversationLabel(name)}. New messages still need fresh approval.`],
 ['ownership-begin','Conversation handover is pending. New automated sends are fenced while the previous driver and any uncertain sends are reconciled.',name=>`I’m transferring ${conversationLabel(name)}. Sending is paused while the change is checked.`],
 ['ownership-commit','You now own this conversation. Automated prospect messages are paused.',name=>`You’re now handling ${conversationLabel(name)}. Automatic messages are paused.`],
 ['ownership-commit','Conversation ownership changed after reconciliation. Existing sequence versions and retired callbacks remain fenced.',name=>`The owner of ${conversationLabel(name)} has changed. Existing campaign controls still apply.`],
 ['sequence-adopt','The original sequence account and published version are recorded. Its runtime still owns the conversation until an explicit reconciled handover.',name=>`${name?name+'’s conversation':'This conversation'} is still managed by its original campaign. Finish the handover before the agent takes over.`],
 ['sequence-channels-adopt','You reviewed all original sequence accounts and contact identities. The sequence still owns this person until it is stopped, its in-flight outcomes are reconciled, and you explicitly complete the handover. No agent message is approved.',name=>`${name?name+'’s conversation':'This conversation'} is still managed by its original campaign. Finish the handover before the agent takes over.`],
 ['handoff-notice','This lead is ready to discuss a call. Please review the conversation and send the booking link. Automated follow-ups are paused.',name=>`${name??'This person'} is ready to discuss a call. Review the conversation and send the booking link. I’ve paused follow-ups.`],
 ['local-delivery','The approved email was delivered to the local test sink. No provider email was sent.',name=>`The test email${name?' to '+name:''} was saved in the local test inbox. No real email was sent.`],
];
const commandKey=new RegExp('^([a-z-]+):'+uuidPattern+'$','i');
const channelIncomingKey=/^channel-incoming:[a-f0-9]{64}$/i;
const incomingEmailKey=new RegExp('^incoming-email:[a-f0-9]{64}:('+uuidPattern+')$','i');
const conversationRevisionKey=new RegExp('^(opt-out|history-conflict):('+uuidPattern+'):([1-9][0-9]*)$','i');
const routeConflictKey=new RegExp('^route-history-conflict:('+uuidPattern+'):([1-9][0-9]*)$','i');
const deliveryFailureKey=new RegExp('^delivery-failure:('+uuidPattern+')$','i');
const deliveryFailureText='The email provider reported a delivery failure. Outreach to this address is stopped. Review the recipient and original account; no follow-up or replacement send was created.';
/** Display copy only. Match saved system provenance exactly; arbitrary user/model
 * prose and original receipts remain unchanged. lead_name is an owned server join,
 * never a guess from draft text, an address, or provider payload details. */
export function plainAgentStatusText(raw:unknown):string|undefined{
 const emptySelection=emptyAgentTargetNotice(raw);if(emptySelection)return emptySelection.text;
 const row=record(raw),content=record(row.content),text=content.text;if(typeof text!=='string')return undefined;
 const review=typeof row.request_key==='string'?reviewKey.exec(row.request_key):null;
 if(row.role==='user'&&review&&content.reviewBatchId===review[1]&&content.decision===review[2]){
  if(review[2]==='approved'&&text==='You approved the displayed proposals. Execution will recheck current permissions and conversation state.')return 'You approved these items. I’ll check that everything is ready before continuing.';
  if(review[2]==='rejected'&&text==='You rejected the displayed proposals.')return 'You declined these items.';
 }
 if(row.role!=='assistant'||typeof row.request_key!=='string')return text;
 const key=row.request_key,details=record(content.details),name=leadName(row.lead_name),outcome=outcomeKey.exec(key);
 const eventReview=eventReviewKey.exec(key);
 if(eventReview&&Number.isSafeInteger(Number(eventReview[2]))&&content.triggerEventId===eventReview[1]&&validUuid(content.runId)&&name){
  if(text==='A draft requires its exact recorded channel route')return `I couldn’t match the draft to ${name}’s saved contact details. I’ve paused this conversation for a check.`;
  if(text==='Conversation history could not be verified after three attempts. Human review is required before outreach continues.')return `I couldn’t finish checking ${name}’s conversation. Sending is paused. Review this conversation before continuing.`;
  return text.startsWith(name+': ')?text:name+': '+text;
 }
 const command=commandKey.exec(key);
 if(command&&validUuid(details.conversationId))for(const [prefix,original,display]of commandNotices)if(command[1]===prefix&&(prefix!=='sequence-channels-adopt'||key==='sequence-channels-adopt:'+details.conversationId)&&text===original)return display(name);
 if(key==='channel-route:'+details.routeId&&validUuid(details.routeId)&&validUuid(details.conversationId)&&validUuid(details.bindingId)&&channels.includes(details.channel as Channel)&&Number.isInteger(details.policyRevision)&&Number(details.policyRevision)>0&&text===contactChannelReviewedNotice&&name)return `Contact channel selected for ${name}. I’ll check their identity and conversation before sending.`;
 if(channelIncomingKey.test(key)&&validUuid(details.conversationId)&&validUuid(details.routeId)&&validUuid(details.bindingId)&&channels.includes(details.channel as Channel)&&typeof details.serviceEventId==='string'&&details.serviceEventId.length>0){
  if(details.reviewRequired===true&&details.verifiedReply===false&&text==='An incoming channel event needs identity review. No verified reply or cold cancellation was inferred. Automation remains paused.')return `A message associated with ${name??'this person'} needs an identity check. I haven’t confirmed it as their reply. Sending remains paused.`;
  if(details.reviewRequired===false&&details.verifiedReply===true){
   if(text==='A verified reply arrived. Cold outreach across all channels is cancelled while I check the full conversation.')return `${name??'This person'} replied. I’ve stopped follow-ups across all channels while I review the conversation.`;
   if(text==='A verified reply arrived on a stopped conversation. Cold outreach across all channels is cancelled; automation remains stopped.')return `${name??'This person'} replied to a stopped conversation. Follow-ups remain cancelled across all channels, and automation is still stopped.`;
   if(text==='A verified reply arrived for this person. Cold outreach across all channels is cancelled; your existing control remains in place.')return `${name??'This person'} replied. Follow-ups are cancelled across all channels. You remain in control of this conversation.`;
  }
 }
 const incomingEmail=incomingEmailKey.exec(key);
 if(incomingEmail&&details.conversationId===incomingEmail[1]&&typeof details.reviewRequired==='boolean'){
  if(details.reviewRequired&&text==='A new email needs human review. Automation remains paused.')return `A new email in ${name?name+'’s conversation':'this conversation'} needs your review. Sending remains paused.`;
  if(!details.reviewRequired&&text==='A new email arrived on a stopped conversation. Automation remains stopped.')return `A new email arrived in ${name?name+'’s stopped conversation':'a stopped conversation'}. Automation remains stopped.`;
  if(!details.reviewRequired&&text==='A new email arrived for a conversation you are handling. Automation remains paused.')return `A new email arrived in ${name?name+'’s conversation':'the conversation you’re handling'}. You remain in control; automation stays paused.`;
  if(!details.reviewRequired&&text==='A new email arrived. I am checking the full conversation before deciding what to do next.')return `A new email arrived in ${name?name+'’s conversation':'this conversation'}. I’m reviewing it before deciding what to do next.`;
 }
 const revision=conversationRevisionKey.exec(key),routeConflict=routeConflictKey.exec(key),failure=deliveryFailureKey.exec(key);
 if(revision&&details.conversationId===revision[2]&&Number.isSafeInteger(Number(revision[3]))){
  if(revision[1]==='opt-out'&&text==='The lead asked not to be contacted. This conversation is stopped and no reply was drafted.')return `${name??'This person'} asked not to be contacted. Outreach is stopped, and I haven’t drafted a reply.`;
  if(revision[1]==='history-conflict'&&text==='Conversation history could not be verified. Automation is held for human review.')return `I couldn’t verify ${conversationLabel(name)}. Sending is paused for your review.`;
 }
 if(routeConflict&&details.routeId===routeConflict[1]&&validUuid(details.conversationId)&&Number.isSafeInteger(Number(routeConflict[2]))&&text==='A recorded channel history could not be verified. Automation is held for human review.')return `I couldn’t verify ${conversationLabel(name)}. Sending is paused for your review.`;
 if((failure&&details.conversationId===failure[1]||/^email-bounce:[a-f0-9]{64}$/i.test(key)&&validUuid(details.conversationId)&&details.deliveryFailure===true)&&text===deliveryFailureText)return `The email${name?' to '+name:''} couldn’t be delivered. I’ve stopped outreach to this address. Review it before contacting them again.`;
 if(/^channel-policy:[1-9][0-9]*$/.test(key)&&Number(key.split(':')[1])===details.policyRevision){
  if(details.acceleratedSimulation===true&&text==='You reviewed an accelerated local simulation channel policy. No provider message is approved by this setting.')return 'Fast demo timing is on. New messages will still appear here for approval.';
  if(details.acceleratedSimulation===false&&text==='You reviewed the channel order, exact accounts and delay between unanswered outreach. Any reply cancels pending cold outreach on every channel. Messages still require approval.')return 'Your sending accounts and timing are saved. I’ll stop follow-ups if a reply arrives. You’ll review messages before they’re sent.';
 }
 if(new RegExp('^command-notice:'+uuidPattern+'$','i').test(key)&&validUuid(details.id)){
  if(details.status==='ready'&&text==='Agent supervision is ready. Outbound work still requires its current approval, ownership and budget checks.')return 'I’m ready to continue. You’ll review messages before they’re sent.';
  if(details.status==='paused'&&text==='Agent supervision is paused. Structured sequences keep their own controls.')return 'The agent is paused. Any separate campaigns keep their own settings.';
 }
 const notSubmitted=notSubmittedKey.exec(key);
 if(notSubmitted&&content.operationId===notSubmitted[1]&&[
  'The original channel message was confirmed not submitted. Its sending reservations were released. Automation remains held; review and explicitly resume before proposing fresh outreach.',
  'The original email was confirmed not submitted. Its sending reservations were released. Automation remains held; review and explicitly resume before proposing fresh outreach.',
  'The original LinkedIn invitation was confirmed not submitted. Its sending reservations were released. Automation remains held; review and explicitly resume before proposing fresh outreach.',
 ].includes(text))return `Your ${text.startsWith('The original LinkedIn invitation')?'LinkedIn invitation':text.startsWith('The original email')?'email':'message'}${name?' to '+name:''} wasn’t sent. Sending is paused. Review this conversation before resuming.`;
 if(reminderKey.test(key)&&validUuid(details.conversationId)&&typeof details.wakeAt==='string'&&Number.isFinite(Date.parse(details.wakeAt))&&text==='I will reassess this conversation at the saved time. This reminder does not approve an email.')return `I’ll review ${name?'the conversation with '+name:'this conversation'} at the scheduled time. Any new message still needs your approval.`;
 const invitation=invitationKey.exec(key);
 if(invitation&&details.operationId===invitation[1]&&validUuid(details.conversationId)&&validUuid(details.routeId)&&details.status==='submitted'&&details.effect==='invitation'&&text==='The reviewed LinkedIn invitation was submitted. Acceptance is not confirmed; I will check the recorded relationship later.')return `Your LinkedIn invitation${name?' to '+name:''} is on its way. I’m waiting for confirmation that it’s been accepted.`;
 if(invitation&&details.operationId===invitation[1]&&validUuid(details.conversationId)&&validUuid(details.routeId)&&details.status==='unknown'&&text==='The original invitation outcome is unknown. Automation is held without resending.')return `I couldn’t confirm whether your LinkedIn invitation${name?' to '+name:''} was sent. Sending is paused; I won’t send it again automatically.`;
 if(command?.[1]==='handoff-notice'&&validUuid(details.id)&&Number.isInteger(details.revision)&&Number(details.revision)>0){
  const followUp=name?name+'’s booking follow-up':'this booking follow-up';
  if(details.status==='acknowledged'&&text==='The human handoff was acknowledged.')return `You acknowledged ${followUp}. Automatic messages remain paused.`;
  if(['pending','acknowledged','link_sent'].includes(String(details.status))&&text==='The human handoff was reassigned.')return `You reassigned ${followUp}. Automatic messages remain paused.`;
  if(['pending','acknowledged','link_sent'].includes(String(details.status))&&text==='An internal human-task reminder was saved. Automation remains paused.')return `A reminder is saved for ${followUp}. Automatic messages remain paused.`;
  if(details.status==='dismissed'&&text==='The human handoff was dismissed. Automation remains paused.')return `You closed ${followUp}. Automatic messages remain paused.`;
  if(details.status==='link_sent'&&text==='A human recorded sending the booking link externally. This does not confirm a meeting. Automation remains paused.')return `You recorded sending ${name?name+' a booking link':'a booking link'}. A meeting isn’t confirmed yet. Automatic messages remain paused.`;
  if(details.status==='meeting_confirmed'&&text==='A human recorded a confirmed meeting with external evidence. Automation remains paused.')return `You recorded a confirmed meeting${name?' with '+name:''}. Automatic follow-ups remain paused.`;
 }
 if(command?.[1]==='task-reminder'&&validUuid(details.taskId)&&Number.isInteger(details.taskRevision)&&Number(details.taskRevision)>0&&text.startsWith('Human handoff reminder: ')&&text.endsWith(' Automation remains paused. No message was sent to the lead.')){
  const reminder=text.slice('Human handoff reminder: '.length,-' Automation remains paused. No message was sent to the lead.'.length);
  if(reminder.trim()&&reminder.length<=2000)return `Reminder${name?' for '+name:''}: ${reminder} Automatic messages remain paused; no message was sent.`;
 }
 if(outcome&&Number.isSafeInteger(Number(outcome[2]))&&details.operationId===outcome[1]&&validUuid(details.conversationId)){
  for(const channel of channels){
   if(details.channel!==channel)continue;
   if(details.status==='submitted'&&text===`The original ${channel} message submission was confirmed. All recorded channel histories must be checked before another action.`)return submitted(channel,name);
   if(details.status==='unknown'&&text===`The original ${channel} outcome is uncertain. Automation remains held and its budget reserved; no new send was attempted.`)return uncertain(channel,name);
  }
  if(details.channel===undefined||details.channel==='email'){
   if(details.status==='submitted'&&text==='The communications service confirmed the original email submission. I will verify the updated conversation history before further work.')return submitted('email',name);
   if(details.status==='unknown'&&text==='The original provider outcome is uncertain. Automation is held and its send budget remains reserved; no new send was attempted.')return uncertain('email',name);
  }
 }
 const resumed=resumedKey.exec(key);
 if(resumed&&Number.isSafeInteger(Number(resumed[2]))&&details.conversationId===resumed[1]&&details.reason==='provider_receipt_pending_history'&&text==='The original submission is reconciled and its complete history is verified. The transport-only hold is cleared; future messages still require their own approval.')return `The message${name?' to '+name:''} has been checked. This sending issue is resolved. The next message still needs your approval.`;
 if(draftKey.test(key)&&validUuid(details.operationId)&&validUuid(details.reviewBatchId)&&validUuid(details.conversationId)){
  for(const channel of channels)if(details.channel===channel&&text===`I prepared a ${channel} message for your review. It has not been sent.`)return draft(channel,name);
  if((details.channel===undefined||details.channel==='email')&&text==='I prepared an email for your review. It has not been sent.')return draft('email',name);
 }
 return text;
}
