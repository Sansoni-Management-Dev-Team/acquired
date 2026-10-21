import {contactChannelReviewedNotice} from '@/domain/agent-chat-notice';
export {contactChannelReviewedNotice} from '@/domain/agent-chat-notice';
type NoticeMessage={id:string;role:string;content?:unknown;noticeKind?:unknown;lead?:unknown};
export type AgentChatNoticeGroup<T extends NoticeMessage>={kind:'message';message:T}|{kind:'channel_notices'|'lead_updates'|'routine_activity';messages:T[]};
/** Presentation grouping only: preserve every record and never combine timeline
 * slices across an inline action. The marker must come from a saved system notice,
 * not a model or user message that happens to repeat its text. */
export function groupAgentChatNotices<T extends NoticeMessage>(messages:readonly T[]):AgentChatNoticeGroup<T>[]{
 const groups:AgentChatNoticeGroup<T>[]=[],pending:T[]=[];let kind:'channel_notices'|'lead_updates'|'routine_activity'='channel_notices';
 function flush(){if(pending.length&&(kind!=='channel_notices'||pending.length>1))groups.push({kind,messages:[...pending]});else if(pending.length)groups.push({kind:'message',message:pending[0]});pending.length=0;}
 for(const message of messages){
  const next=message.role==='assistant'&&message.noticeKind==='lead_update'&&message.lead?'lead_updates':message.role==='user'&&message.noticeKind==='review_decision'||message.role==='assistant'&&message.noticeKind==='routine_activity'?'routine_activity':message.role==='assistant'&&message.noticeKind==='contact_channel_reviewed'&&(message.content===contactChannelReviewedNotice||typeof message.content==='string'&&/^Contact channel selected for [^\r\n]{1,200}\. I’ll check their identity and conversation before sending\.$/u.test(message.content))?'channel_notices':null;
  if(next){if(next==='lead_updates')kind=next;else if(kind!=='lead_updates'&&next!==kind){flush();kind=next;}pending.push(message);}
  else {flush();groups.push({kind:'message',message});}
 }
 flush();return groups;
}
