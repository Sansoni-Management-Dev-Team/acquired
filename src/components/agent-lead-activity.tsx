'use client';
import {useState} from 'react';
import type {SavedAgentMessage} from '@/lib/agent-saved-messages';
import {AgentConversationHistory} from './agent-conversation-history';
import {AgentChatMessage,AgentChatIdentity,AgentChatDetails,AgentChatActions} from './agent-chat-ui';

function FailureDetails({message}:{message:SavedAgentMessage}){return message.failure?<AgentChatDetails summary="Failure details"><p>Delivery outcome has not been confirmed by this notice. Review the saved conversation and operations before retrying.</p><dl className="mt-2 break-all text-xs"><dt>Event reference</dt><dd>{message.failure.eventId}</dd><dt>Run reference</dt><dd>{message.failure.runId}</dd></dl></AgentChatDetails>:null;}

type Props={mandateId:string;messages:SavedAgentMessage[];onReview:(conversationId:string)=>void;onReviewDraft?:(conversationId:string)=>void;automaticMessages?:boolean;pendingDrafts?:ReadonlySet<string>};
/** One milestone per person; original records remain available in saved order. */
export function AgentLeadActivity({mandateId,messages,onReview,onReviewDraft,automaticMessages=false,pendingDrafts}:Props){
 const [opened,setOpened]=useState<string|null>(null);
 const people=new Map<string,SavedAgentMessage[]>();
 for(const message of messages)if(message.lead){const prior=people.get(message.lead.id)??[];people.delete(message.lead.id);people.set(message.lead.id,[...prior,message]);}
 const routine=messages.filter(message=>!message.lead);
 const entries=[...people],earlier=entries.slice(0,-5),recent=entries.slice(-5);
 const renderUpdate=([id,activity]:[string,SavedAgentMessage[]])=>{
  const latest=activity.at(-1)!,lead=latest.lead!,reply=[...activity].reverse().find(message=>message.lead?.reply)?.lead?.reply;
  const draftPending=pendingDrafts===undefined||pendingDrafts.has(id);
  let content=latest.content;
  if(automaticMessages&&lead.kind==='draft')for(const channel of ['email','WhatsApp','LinkedIn'])if(content===`Your ${channel} draft for ${lead.name} is ready to review. It hasn’t been sent.`)content=`I’ve prepared ${channel==='email'?'an email':'a '+channel} draft for ${lead.name}.`;
  const next=lead.kind==='attention'?'Review this conversation to continue.':lead.kind==='draft'?(draftPending?(automaticMessages?'Automatic approval is on for demo messages.':'Review the draft below.'):'View the conversation for the latest update.'):lead.kind==='reply'?'I’m reviewing their reply before the next step.':null;
  return <AgentChatMessage key={id} aria-label={`Update for ${lead.name}`}>
   <AgentChatIdentity name={lead.name} company={lead.company}/>
   <p className="mt-1 leading-relaxed">{content}</p>
   <FailureDetails message={latest}/>
   {reply&&opened!==id&&<blockquote className="mt-3 rounded-lg bg-[var(--panel-raised)] p-3"><p className="mb-1 text-xs text-[var(--muted)]">{reply.channel==='whatsapp'?'WhatsApp':reply.channel==='linkedin'?'LinkedIn':'Email'} reply</p><p className="whitespace-pre-wrap break-words leading-relaxed">{reply.text}</p></blockquote>}
   {next&&<p className="mt-2 text-xs text-[var(--muted)]">{next}</p>}
   <AgentChatActions><button type="button" className="min-h-11 text-xs underline underline-offset-4" aria-expanded={opened===id} onClick={()=>setOpened(opened===id?null:id)}>View conversation</button>{lead.kind==='attention'&&<button type="button" className="min-h-11 text-xs font-medium underline underline-offset-4" onClick={()=>onReview(id)}>Review conversation</button>}{lead.kind==='draft'&&draftPending&&onReviewDraft&&<button type="button" className="min-h-11 text-xs font-medium underline underline-offset-4" onClick={()=>onReviewDraft(id)}>{automaticMessages?'View draft':'Review draft'}</button>}</AgentChatActions>
   {opened===id&&<AgentConversationHistory mandateId={mandateId} conversationId={id} revision={latest.id} presentation="thread" participantName={lead.name}/>}
   {activity.length>1&&<AgentChatDetails summary={<>Activity ({activity.length})</>}><ol className="space-y-2 border-l border-[var(--border)] pl-3">{activity.map(message=><li key={message.id}>{message.content}<FailureDetails message={message}/></li>)}</ol></AgentChatDetails>}
  </AgentChatMessage>;
 };
 return <div aria-label="Lead updates" className="space-y-4">{earlier.length>0&&<AgentChatDetails summary={<>Earlier updates ({earlier.length} people)</>}><div className="mt-3 space-y-4">{earlier.map(renderUpdate)}</div></AgentChatDetails>}{recent.map(renderUpdate)}{routine.length>0&&<AgentChatDetails summary={<>Setup and approvals ({routine.length})</>}><ol className="space-y-2 border-l border-[var(--border)] pl-3">{routine.map(message=><li key={message.id}>{message.content}<FailureDetails message={message}/></li>)}</ol></AgentChatDetails>}</div>;
}
