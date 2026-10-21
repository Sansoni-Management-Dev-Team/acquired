'use client';
import{useRef,useState}from'react';
type Conversation={id:string;revision:number;epoch:string|number;context_revision:string;driver_kind:string;phase:string;pause_reason?:string|null;engagement:string;pending_driver?:unknown;history_complete?:boolean;history_coverage_fresh?:boolean};
export function AgentConversationReviewControls({conversation:c,disabled,onCommand}:{conversation:Conversation;disabled:boolean;onCommand:(input:Record<string,unknown>)=>Promise<unknown>}){
 const[reason,setReason]=useState(''),[confirmedSnapshot,setConfirmedSnapshot]=useState<string|null>(null),[working,setWorking]=useState(false),[error,setError]=useState('');const lock=useRef(false);
 const allowed=c.driver_kind==='agent'&&!c.pending_driver&&!['stopped','handoff'].includes(c.engagement)&&(c.phase==='active'||c.phase==='held'&&c.pause_reason==='human_review_required');
 if(!allowed)return null;const snapshot=JSON.stringify([c.id,c.revision,c.epoch,c.context_revision]),confirmed=confirmedSnapshot===snapshot;const expected={conversationId:c.id,revision:c.revision,epoch:Number(c.epoch),contextRevision:c.context_revision},fresh=c.history_complete===true&&c.history_coverage_fresh===true;
 async function submit(action:'refresh_review_history'|'reassess_conversation'){if(disabled||working||lock.current||action==='reassess_conversation'&&(!fresh||!confirmed||reason.trim().length<5))return;lock.current=true;setWorking(true);setError('');try{await onCommand({action,...expected,...(action==='reassess_conversation'?{reason:reason.trim()}:{})});setConfirmedSnapshot(null);}catch{setError('Could not confirm this review request. Inspect current saved state before trying again.');}finally{lock.current=false;setWorking(false);}}
 return <section aria-label="Conversation review" className="mt-3 space-y-3">
  <p>Check the latest messages before continuing. Checking again pauses sending and won’t resend a message.</p>
  <button type="button" className="min-h-11 rounded-lg border border-[var(--border)] px-3" disabled={disabled||working} onClick={()=>void submit('refresh_review_history')}>Check again</button>
  <details className="rounded-lg border border-[var(--border)] p-3"><summary className="min-h-9 cursor-pointer py-1">Continue after review</summary>
   <p className="mt-2 text-[var(--muted)]">Review the conversation before asking the agent to continue. Previous drafts and permissions won’t be reused.</p>
   <form className="mt-3 space-y-2" onSubmit={event=>{event.preventDefault();void submit('reassess_conversation');}}>
    <label className="block">What should the agent do next?<textarea maxLength={2000} value={reason} disabled={disabled||working} onChange={event=>{setReason(event.target.value);setConfirmedSnapshot(null);}} className="mt-1 block w-full rounded-lg border border-[var(--border)] p-2"/></label>
    <label className="flex min-h-11 items-center gap-2"><input name="reviewConfirmed" type="checkbox" checked={confirmed} disabled={disabled||working||!fresh} onChange={event=>setConfirmedSnapshot(event.target.checked?snapshot:null)}/>I’ve reviewed these messages and want the agent to continue.</label>
    {!fresh&&<p role="status">Check the latest messages on all channels first.</p>}
    <button type="submit" disabled={disabled||working||!fresh||!confirmed||reason.trim().length<5} className="min-h-11 rounded-lg border border-[var(--border)] px-3">Continue with agent</button>
   </form>
  </details>{error&&<p role="alert">{error}</p>}
 </section>;
}
