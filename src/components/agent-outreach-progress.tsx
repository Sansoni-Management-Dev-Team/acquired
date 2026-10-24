'use client';
import {useState} from 'react';
import {AgentDeliveryRecheck} from './agent-delivery-recheck';
import {AgentChannelProgress,type AgentChannelProgressRow} from './agent-channel-progress';
import {AgentConversationReviewControls} from './agent-conversation-review-controls';
import {AgentConversationHistory} from './agent-conversation-history';
import {AgentChatSurface,AgentChatActions,AgentChatDetails} from './agent-chat-ui';

export type AgentOutreachConversation={channels?:AgentChannelProgressRow[];lead_name?:string|null;company_name?:string|null;draft_pending?:boolean;last_message_direction?:'inbound'|'outbound'|null;next_wakeup_at?:string|null;id:string;contact_id?:string;revision:number;epoch:string|number;context_revision:string;driver_kind:string;phase:string;pause_reason?:string|null;history_complete?:boolean;history_coverage_fresh?:boolean;history_observed_at?:string|null;recipient_email:string;binding_digest?:string;engagement:string;pending_driver?:{kind:string}|null};
type Props={automaticMessages?:boolean;mandateId?:string;focusedConversationId?:string|null;conversationFocusRequest?:number;conversations:AgentOutreachConversation[];busy:boolean;running:boolean;onHandover:(conversation:AgentOutreachConversation,target?:'human'|'agent')=>Promise<void>|void;onHeldControl:(conversation:AgentOutreachConversation,action:'refresh_held_history'|'resume_held')=>Promise<void>|void;onCommand:(input:Record<string,unknown>)=>Promise<unknown>;canHandBack:(conversation:AgentOutreachConversation)=>boolean};
const button='min-h-11 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40';
type Stage='stopped'|'complete'|'handoff'|'transfer'|'held'|'paused'|'human'|'sequence'|'active'|'waiting'|'checking'|'draft'|'awaiting_reply';
const labels:Record<Stage,string>={stopped:'Stopped',complete:'Complete',handoff:'Human handoff',transfer:'Switching owner',held:'Needs review',paused:'Paused',human:'You’re handling this',sequence:'Campaign managed',active:'Active conversation',waiting:'Waiting',checking:'Checking conversation',draft:'Review draft',awaiting_reply:'Waiting for a reply'};
function stage(c:AgentOutreachConversation):Stage{
 if(c.engagement==='stopped')return 'stopped';
 if(c.phase==='complete')return 'complete';
 if(c.engagement==='handoff')return 'handoff';
 if(c.pending_driver)return 'transfer';
 if(c.phase==='held')return 'held';
 if(c.phase==='paused')return 'paused';
 if(c.driver_kind==='human')return 'human';
 if(c.driver_kind==='sequence')return 'sequence';
 if(c.pause_reason==='channel_history_pending')return 'checking';
 if(c.draft_pending)return 'draft';
 if(c.last_message_direction==='outbound')return 'awaiting_reply';
 return c.phase==='active'?'active':'waiting';
}
function Row({automaticMessages=false,mandateId,focusedConversationId,conversationFocusRequest,conversation:c,busy,running,onHandover,onHeldControl,onCommand,canHandBack}:Omit<Props,'conversations'>&{conversation:AgentOutreachConversation}){
 const focused=focusedConversationId===c.id,focusKey=JSON.stringify([focusedConversationId,conversationFocusRequest]);
 const [working,setWorking]=useState(false),[error,setError]=useState(''),[historyOpen,setHistoryOpen]=useState(focused),[seenFocus,setSeenFocus]=useState(focusKey);const disabled=busy||working;
 if(focusKey!==seenFocus){setSeenFocus(focusKey);if(focused)setHistoryOpen(true);}
 async function perform(action:()=>Promise<void>|void){if(disabled)return;setWorking(true);setError('');try{await action();}catch{setError('Could not confirm this action. Refresh the saved state before trying again.');}finally{setWorking(false);}}
 const stopped=c.engagement==='stopped'||c.phase==='complete',recoverable=c.driver_kind==='agent'&&c.phase==='held'&&['provider_no_submission_confirmed','provider_receipt_pending_history'].includes(c.pause_reason??'');
 const terminal=c.engagement==='stopped'||c.engagement==='handoff'||c.phase==='complete';
 const name=c.lead_name?.trim()||c.recipient_email,opened=historyOpen;
 return <li id={'agent-conversation-'+c.id} data-outreach-conversation className="scroll-mt-4 rounded-lg border border-[var(--border)]">
  <details open={opened||undefined} className="px-3 py-2" onToggle={event=>setHistoryOpen(event.currentTarget.open)}><summary aria-label={`${opened?'Hide':'View'} conversation with ${name}`} className="min-h-11 cursor-pointer py-2 text-sm"><span className="break-words font-medium">{name}</span>{c.company_name&&<span className="ml-2 text-xs text-[var(--muted)]">{c.company_name}</span>}<span className="ml-2 text-xs text-[var(--muted)]">{automaticMessages&&stage(c)==='draft'?'Preparing message':labels[stage(c)]}</span><span className="ml-3 inline-block text-xs underline underline-offset-4">{opened?'Hide conversation':'View conversation'}</span></summary>
   <div className="space-y-3 pb-2 text-xs">
    {c.lead_name?.trim()&&<p className="break-all text-[var(--muted)]">{c.recipient_email}</p>}
    {c.engagement==='stopped'&&<p>Outreach is stopped for this person. No resume action is available here.</p>}
    {c.engagement==='handoff'&&<p>Automation is paused for human follow-up. Review the handoff task in chat.</p>}
    {c.phase==='held'&&<p>{recoverable?'Sending is paused. Check the previous messages, then choose Resume agent when you’re ready. New drafts will need your approval.':c.pause_reason==='human_review_required'?'I couldn’t finish checking this conversation. Review the saved messages, check again, then decide whether to continue.':'I couldn’t confirm whether the last message was sent. Sending stays paused while this is checked.'}</p>}
    {c.pause_reason==='channel_history_pending'&&<p>Conversation checks haven’t finished. No new message will be sent until they’re complete. Choose Check again below to continue checking.</p>}
    {c.draft_pending&&<p>{automaticMessages?'I’m preparing the next message.':'A draft is ready for your review below.'}</p>}
    {c.next_wakeup_at&&<p>Next check: <time dateTime={c.next_wakeup_at}>{new Date(c.next_wakeup_at).toLocaleString()}</time></p>}
    {c.phase==='paused'&&c.engagement!=='handoff'&&<p>This conversation is paused. Resume it here when you’re ready.</p>}
    {opened&&mandateId&&<AgentConversationHistory mandateId={mandateId} conversationId={c.id} revision={c.context_revision} presentation="thread" participantName={name}/>}
    <AgentChatDetails summary="Conversation controls">
    <details><summary className="min-h-9 cursor-pointer py-2 text-[var(--muted)]">Channel details</summary><AgentChannelProgress channels={c.channels}/></details>
    <AgentChatActions>
     {c.pending_driver&&!stopped?<><p>I’m waiting for the previous sender to finish before switching who handles this conversation.</p><button type="button" className={button} disabled={disabled} onClick={()=>void perform(()=>onHandover(c))}>Finish switching</button></>:!terminal&&c.driver_kind==='agent'&&c.phase==='active'?<button type="button" className={button} disabled={disabled} onClick={()=>void perform(()=>onHandover(c,'human'))}>Take over</button>:!terminal&&recoverable?<><button type="button" className={button} disabled={disabled} onClick={()=>void perform(()=>onHeldControl(c,'refresh_held_history'))}>Check previous messages</button><button type="button" className={button} disabled={disabled||!running||!c.history_complete} onClick={()=>void perform(()=>onHeldControl(c,'resume_held'))}>Resume agent</button></>:c.driver_kind!=='agent'&&!stopped&&canHandBack(c)?<button type="button" className={button} disabled={disabled||!running} onClick={()=>void perform(()=>onHandover(c,'agent'))}>Move to agent</button>:null}
    </AgentChatActions>
    <AgentDeliveryRecheck conversation={c} disabled={disabled||!running} onCommand={onCommand}/>
    <AgentConversationReviewControls conversation={c} disabled={disabled||!running} onCommand={onCommand}/>
    {error&&<p role="alert">{error}</p>}
    </AgentChatDetails>
   </div>
  </details>
 </li>;
}
/** Saved execution projections only. Rendering this card never reconciles history or submits work. */
export function AgentOutreachProgress({conversations,...controls}:Props){
 const [page,setPage]=useState(0),[seenFocus,setSeenFocus]=useState('');
 const focusKey=JSON.stringify([controls.focusedConversationId,controls.conversationFocusRequest]);
 if(focusKey!==seenFocus){setSeenFocus(focusKey);const index=conversations.findIndex(person=>person.id===controls.focusedConversationId);if(index>=0)setPage(Math.floor(index/5));}
 if(!conversations.length)return null;
 const pageSize=5,last=Math.max(0,Math.ceil(conversations.length/pageSize)-1),current=Math.min(page,last),start=current*pageSize;
 const counts=new Map<Stage,number>();for(const conversation of conversations){const key=stage(conversation);counts.set(key,(counts.get(key)??0)+1);}
 return <AgentChatSurface label="Outreach progress" className="space-y-3">
  <div><h2 className="font-semibold">Outreach progress</h2><p className="mt-1 text-xs text-[var(--muted)]">{conversations.length} {conversations.length===1?'person':'people'} · {conversations.filter(person=>person.engagement==='engaged').length} replied</p><p className="sr-only">Message approval and delivery are separate.</p></div>
  <p role="status" className="text-xs text-[var(--muted)]">{[...counts].map(([key,count])=>key==='held'?`${count} need review`:key==='draft'?`${count} ${count===1?'draft':'drafts'} ready`:`${count} ${labels[key].toLowerCase()}`).join(' · ')}</p>
  <ul className="space-y-2">{conversations.slice(start,start+pageSize).map(conversation=><Row key={conversation.id} conversation={conversation} {...controls}/>)}</ul>
  {conversations.length>pageSize&&<div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-[var(--muted)]">Showing {start+1}–{Math.min(start+pageSize,conversations.length)} of {conversations.length}</p><div className="flex gap-2"><button type="button" className={button} aria-label="Previous outreach contacts" disabled={current===0} onClick={()=>setPage(current-1)}>Previous</button><button type="button" className={button} aria-label="Next outreach contacts" disabled={current===last} onClick={()=>setPage(current+1)}>Next</button></div></div>}
 </AgentChatSurface>;
}
