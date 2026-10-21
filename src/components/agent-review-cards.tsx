'use client';
import {isAgentMessageReviewOperation as isAgentMessageReview} from '@/domain/agent-operation-classifications';
import{AgentConversationHistory}from'./agent-conversation-history';
import {AgentChatSurface,AgentChatDetails,AgentChatIdentity,AgentChatActions,type AgentChatPersonView} from './agent-chat-ui';
import type{ResearchPhaseFunding}from'@/lib/agent-research-budget';
import{AgentResearchFunding}from'./agent-research-funding';
import {useEffect,useRef,useState} from 'react';
import {AgentNativeProposalDetails,AgentProposalGuidance,nativeProposalReviewable} from './agent-native-proposal-details';
import {AgentFeedbackForm} from './agent-feedback-form';
import {agentFeedbackOperationNames} from '@/domain/agent-feedback';
import type {AgentReviewItem} from '@/domain/agent-authority';
import {formattedAgentAccountLabel} from '@/domain/agent-account-label';
export type AgentReviewBatchView={id:string;revision:number;state:'pending'|'approved'|'rejected'|'invalidated';stale:boolean;manifest:AgentReviewItem[];operations:{id:string;conversationId?:string;leadName?:string;leadCompany?:string;leadRole?:string;people?:AgentChatPersonView[];name:string;revision:number;state:string;funding?:(ResearchPhaseFunding&{funded?:boolean});input:{body?:unknown;subject?:unknown;recipientKey?:unknown;[key:string]:unknown}}[]};
export {isAgentMessageReviewOperation as isAgentMessageReview} from '@/domain/agent-operation-classifications';
/** Presentation eligibility only; the original review endpoint still validates every exact manifest. */
export function eligibleAgentMessageReviewBatches(batches:AgentReviewBatchView[],editedBatchId?:string|null){
 return batches.filter(batch=>batch.state==='pending'&&!batch.stale&&batch.id!==editedBatchId&&batch.operations.length>0&&batch.operations.length===batch.manifest.length&&new Set(batch.operations.map(op=>op.id)).size===batch.operations.length&&new Set(batch.manifest.map(item=>item.operationId)).size===batch.manifest.length&&batch.operations.every(op=>isAgentMessageReview(op.name)&&op.state==='proposed'&&typeof op.input.body==='string'&&Boolean(op.input.body.trim())&&nativeProposalReviewable(op.name,op.input)&&batch.manifest.some(item=>item.operationId===op.id&&item.revision===op.revision&&/^[a-f0-9]{64}$/.test(item.digest)&&Boolean(item.contextRevision))));
}
type Props={onEditingChange?:(batchId:string|null)=>void;onApproveAll?:(batches:AgentReviewBatchView[])=>Promise<void|boolean>;mandateId?:string;batches:AgentReviewBatchView[];busy:boolean;onFeedback?:(input:unknown)=>Promise<boolean>;onDecision:(batch:AgentReviewBatchView,decision:'approved'|'rejected')=>void;onEdit:(batch:AgentReviewBatchView,operationId:string,revision:number,body:string)=>Promise<boolean>};
export function AgentReviewCards({batches,busy:externalBusy,onDecision,onEdit,onFeedback,mandateId,onApproveAll,onEditingChange}:Props){
 const [edit,setEdit]=useState<{batchId:string;operationId:string;revision:number;body:string;snapshot:AgentReviewBatchView}|null>(null);
 useEffect(()=>{onEditingChange?.(edit?.batchId??null);return()=>onEditingChange?.(null);},[edit?.batchId,onEditingChange]);
 const [approvingAll,setApprovingAll]=useState(false),[bulkError,setBulkError]=useState(''),approvalInFlight=useRef(false);
 const busy=externalBusy||approvingAll,isMessage=isAgentMessageReview;
 const eligible=eligibleAgentMessageReviewBatches(batches,edit?.batchId);
 async function approveAll(){if(busy||approvalInFlight.current||!onApproveAll||!eligible.length)return;approvalInFlight.current=true;setApprovingAll(true);setBulkError('');try{const result=await onApproveAll(eligible);if(result===false)setBulkError('Approval stopped. Review the refreshed proposals before continuing.');}catch{setBulkError('Approval stopped. Review the refreshed proposals before continuing.');}finally{approvalInFlight.current=false;setApprovingAll(false);}}
 const channelLabel=(name:string)=>name.startsWith('whatsapp.')?'WhatsApp':name.startsWith('linkedin.')?'LinkedIn':'Email';
 const title=(name:string)=>name==='linkedin.invitation'?'Suggested LinkedIn invitation':name.startsWith('whatsapp.')||name.startsWith('linkedin.')?`Suggested ${channelLabel(name)} ${name.endsWith('.reply')?'reply':name.endsWith('.follow_up')?'follow-up':'message'}`:undefined;
 const pending=batches.filter(batch=>batch.state==='pending'||batch.id===edit?.batchId);
 if(edit&&!pending.some(batch=>batch.id===edit.batchId))pending.push({...edit.snapshot,state:'invalidated',stale:true});
 if(!pending.length)return null;
 return <AgentChatSurface label="Proposals awaiting your review" className="space-y-4 border-t border-[var(--border)]">
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">Needs your review</h2>{onApproveAll&&eligible.length>0&&<div className="flex flex-wrap items-center gap-3"><p className="text-xs text-[var(--muted)]">{eligible.reduce((count,batch)=>count+batch.operations.length,0)} message proposals</p><button type="button" disabled={busy} onClick={()=>void approveAll()} className="min-h-11 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-40">Approve all messages</button></div>}</div>
  {bulkError&&<p role="alert" className="text-sm text-[var(--muted)]">{bulkError}</p>}
  {pending.map(batch=><article key={batch.id} className="space-y-4 border-b border-[var(--border)] py-4 last:border-b-0">
   {(batch.stale||batch.state!=='pending')&&<p role="status" className="text-sm text-[var(--muted)]">This proposal changed. Refresh and review the current version.</p>}
   {batch.operations.map(op=><div key={op.id} id={op.conversationId?'agent-draft-'+op.conversationId:undefined} className="scroll-mt-4 space-y-2 text-sm">
    {op.leadName&&<AgentChatIdentity name={op.leadName} company={op.leadCompany} role={op.leadRole}/>}
    <p className="font-semibold">{title(op.name)??(op.name==='email.reply'?'Suggested reply':op.name==='email.initial'?'Suggested email':op.name==='email.follow_up'?'Suggested follow-up':op.name==='email.manual_link'?'Your booking link':op.name==='research.start'?'Research proposal':op.name==='research.fields'?'Public company field research':op.name==='research.people'?'Contact enrichment proposal':op.name==='target.select'?'Contact selection':op.name==='sequence.publish'?'Publish reviewed sequence':op.name==='sequence.enrol'?'Review sequence enrolment':'Sequence proposal')}</p>
    <AgentNativeProposalDetails name={op.name} input={op.input} mandateId={mandateId} people={op.people}/>
    <AgentResearchFunding funding={op.funding}/>
    {isMessage(op.name)&&<AgentChatDetails summary="Delivery details"><p>{channelLabel(op.name)} · {formattedAgentAccountLabel(op.input.accountLabel,op.name.split('.')[0])}</p>{typeof op.input.recipientKey==='string'&&<p className="break-words">To: {op.input.recipientKey.replace(/^(email|whatsapp|linkedin):/,'')}</p>}{op.name==='linkedin.invitation'&&<p>A connection request doesn’t confirm acceptance.</p>}<p className="mt-2 text-xs text-[var(--muted)]">I’ll check the latest conversation before sending.</p></AgentChatDetails>}
    <AgentProposalGuidance input={op.input}/>
    {mandateId&&isMessage(op.name)&&(op.name.endsWith('.reply')?<AgentConversationHistory mandateId={mandateId} operationId={op.id} revision={op.revision} showIncoming/>:<AgentChatDetails summary="Conversation"><AgentConversationHistory mandateId={mandateId} operationId={op.id} revision={op.revision}/></AgentChatDetails>)}
    {isMessage(op.name)&&<p className="pt-2 text-xs font-semibold text-[var(--muted)]">{op.name.endsWith('.reply')?'Draft reply':'Proposed message'}</p>}
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
   <AgentChatActions><button type="button" disabled={busy||(batch.stale||batch.state!=='pending')||edit?.batchId===batch.id||batch.operations.some(op=>!nativeProposalReviewable(op.name,op.input))} onClick={()=>onDecision(batch,'approved')} className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-40">{batch.operations.length===1?'Approve proposal':`Approve all ${batch.operations.length} proposals`}</button>
    <button type="button" disabled={busy||(batch.stale||batch.state!=='pending')||edit?.batchId===batch.id} onClick={()=>onDecision(batch,'rejected')} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40">Reject</button></AgentChatActions>
   <p className="text-xs text-[var(--muted)]">Approve this version to continue. I’ll check for new replies before sending.</p>
  </article>)}
 </AgentChatSurface>;
}
