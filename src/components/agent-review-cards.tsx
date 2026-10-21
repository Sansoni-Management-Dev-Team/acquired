'use client';
import {isAgentMessageReviewOperation as isMessage} from '@/domain/agent-operation-classifications';
import {useState} from 'react';
import {AgentNativeProposalDetails,AgentProposalGuidance,nativeProposalReviewable} from './agent-native-proposal-details';
import {AgentFeedbackForm} from './agent-feedback-form';
import {agentFeedbackOperationNames} from '@/domain/agent-feedback';
import type {AgentReviewItem} from '@/domain/agent-authority';
export type AgentReviewBatchView={id:string;revision:number;state:'pending'|'approved'|'rejected'|'invalidated';stale:boolean;manifest:AgentReviewItem[];operations:{id:string;name:string;revision:number;state:string;input:{body?:unknown;subject?:unknown;recipientKey?:unknown;[key:string]:unknown}}[]};
type Props={mandateId?:string;batches:AgentReviewBatchView[];busy:boolean;onFeedback?:(input:unknown)=>Promise<boolean>;onDecision:(batch:AgentReviewBatchView,decision:'approved'|'rejected')=>void;onEdit:(batch:AgentReviewBatchView,operationId:string,revision:number,body:string)=>Promise<boolean>};
export function AgentReviewCards({batches,busy,onDecision,onEdit,onFeedback,mandateId}:Props){
 const [edit,setEdit]=useState<{batchId:string;operationId:string;revision:number;body:string;snapshot:AgentReviewBatchView}|null>(null);
 const channelLabel=(name:string)=>name.startsWith('whatsapp.')?'WhatsApp':name.startsWith('linkedin.')?'LinkedIn':'Email';
 const title=(name:string)=>name==='linkedin.invitation'?'Suggested LinkedIn invitation':name.startsWith('whatsapp.')||name.startsWith('linkedin.')?`Suggested ${channelLabel(name)} ${name.endsWith('.reply')?'reply':name.endsWith('.follow_up')?'follow-up':'message'}`:undefined;
 const pending=batches.filter(batch=>batch.state==='pending'||batch.id===edit?.batchId);
 if(edit&&!pending.some(batch=>batch.id===edit.batchId))pending.push({...edit.snapshot,state:'invalidated',stale:true});
 if(!pending.length)return null;
 return <section aria-label="Proposals awaiting your review" className="space-y-4 border-t border-[var(--border)] p-5">
  <h2 className="text-sm font-semibold">Your review</h2>
  {pending.map(batch=><article key={batch.id} className="space-y-4 rounded-xl border border-[var(--border)] p-4">
   {(batch.stale||batch.state!=='pending')&&<p role="status" className="text-sm text-[var(--muted)]">This proposal changed. Refresh and review the current version.</p>}
   {batch.operations.map(op=><div key={op.id} className="space-y-2 text-sm">
    <p className="font-semibold">{title(op.name)??(op.name==='email.reply'?'Suggested reply':op.name==='email.initial'?'Suggested email':op.name==='email.follow_up'?'Suggested follow-up':op.name==='email.manual_link'?'Your booking link':op.name==='research.start'?'Research proposal':op.name==='research.people'?'Contact enrichment proposal':op.name==='target.select'?'Contact selection':op.name==='sequence.publish'?'Publish reviewed sequence':op.name==='sequence.enrol'?'Review sequence enrolment':'Sequence proposal')}</p>
    {isMessage(op.name)&&<p className="text-xs text-[var(--muted)]">{channelLabel(op.name)} · {typeof op.input.accountLabel==='string'?op.input.accountLabel:'Recorded account'} · Human approval required</p>}
    {op.name==='linkedin.invitation'&&<p className="text-xs text-[var(--muted)]">Separate human approval is required. Acceptance is not confirmed by sending an invitation or receiving a chat reply.</p>}
    <AgentNativeProposalDetails name={op.name} input={op.input} mandateId={mandateId}/>
    <AgentProposalGuidance input={op.input}/>
    {typeof op.input.recipientKey==='string'&&<p className="break-words text-xs text-[var(--muted)]">To: {op.input.recipientKey}</p>}
    {typeof op.input.subject==='string'&&Boolean(op.input.subject.trim())&&<p>{op.input.subject}</p>}
    {edit?.batchId===batch.id&&edit.operationId===op.id?<form className="space-y-2" onSubmit={event=>{event.preventDefault();if(busy||batch.stale||batch.state!=='pending')return;void onEdit(batch,op.id,edit.revision,edit.body).then(saved=>{if(saved)setEdit(null);});}}>
     <label htmlFor={'edit-'+op.id} className="sr-only">Edit proposed message</label>
     <textarea disabled={busy} id={'edit-'+op.id} value={edit.body} maxLength={op.name==='linkedin.invitation'?300:6000} onChange={event=>setEdit({...edit,body:event.target.value})} className="min-h-32 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] p-3"/>
     <button type="submit" disabled={busy||!edit.body.trim()||(batch.stale||batch.state!=='pending')} className="rounded-lg border border-[var(--border)] px-3 py-2 disabled:opacity-40">Save edit for review</button>
     <button type="button" disabled={busy} onClick={()=>setEdit(null)} className="ml-2 px-3 py-2">Cancel edit</button>
    </form>:<>
     {typeof op.input.body==='string'&&<p className="whitespace-pre-wrap break-words leading-relaxed">{op.input.body}</p>}
     {isMessage(op.name)&&typeof op.input.body==='string'&&<button type="button" disabled={busy||(batch.stale||batch.state!=='pending')} onClick={()=>setEdit({batchId:batch.id,operationId:op.id,revision:op.revision,body:op.input.body as string,snapshot:batch})} className="text-xs underline underline-offset-4 disabled:opacity-40">Edit reply</button>}
    </>}
    {onFeedback&&agentFeedbackOperationNames.some(name=>name===op.name)&&<AgentFeedbackForm source={{kind:'operation',id:op.id,revision:op.revision}} busy={busy||batch.stale||batch.state!=='pending'} onSave={onFeedback}/>}
   </div>)}
   <div className="flex flex-wrap gap-2"><button type="button" disabled={busy||(batch.stale||batch.state!=='pending')||edit?.batchId===batch.id||batch.operations.some(op=>!nativeProposalReviewable(op.name,op.input))} onClick={()=>onDecision(batch,'approved')} className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-40">{batch.operations.length===1?'Approve proposal':`Approve all ${batch.operations.length} proposals`}</button>
    <button type="button" disabled={busy||(batch.stale||batch.state!=='pending')||edit?.batchId===batch.id} onClick={()=>onDecision(batch,'rejected')} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40">Reject</button></div>
   <p className="text-xs text-[var(--muted)]">Approval applies to these exact versions only. Message delivery still requires current authority, ownership, history and budget checks.</p>
  </article>)}
 </section>;
}
