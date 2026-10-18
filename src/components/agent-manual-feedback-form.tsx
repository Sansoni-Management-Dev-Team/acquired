'use client';
import {useLayoutEffect,useRef,useState} from 'react';
import {manualFeedbackInputSchema,type AgentManualFeedbackInput} from '@/domain/agent-manual-feedback';
import {randomUuid} from '@/lib/random-uuid';
type Props={mandateId:string;source:AgentManualFeedbackInput['source'];busy:boolean;defaultCategory?:AgentManualFeedbackInput['category']};
export function AgentManualFeedbackForm({mandateId,source,busy,defaultCategory='tone'}:Props){
 const [reason,setReason]=useState(''),[preference,setPreference]=useState(''),[category,setCategory]=useState(defaultCategory),[saving,setSaving]=useState(false),[status,setStatus]=useState('');
 const identity=JSON.stringify([mandateId,source]),current=useRef<string|null>(identity);
 useLayoutEffect(()=>{current.current=identity;return()=>{current.current=null;};},[identity]);
 const [reviewed,setReviewed]=useState(identity),retry=useRef<{digest:string;key:string}|null>(null),locked=useRef(false);
 const stale=reviewed!==identity,disabled=busy||saving||stale;
 async function submit(event:React.FormEvent){
  event.preventDefault();if(disabled||locked.current)return;
  const parsed=manualFeedbackInputSchema.safeParse({source,reason,preference,category});if(!parsed.success){setStatus('Add a correction and the preference to propose.');return;}
  const digest=JSON.stringify([mandateId,parsed.data]);if(retry.current?.digest!==digest)retry.current={digest,key:randomUuid()};
  const submitted=identity;locked.current=true;setSaving(true);setStatus('');
  try{
   const response=await fetch(`/api/mandates/${mandateId}/agent/guidance`,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'manualFeedback',requestKey:retry.current.key,input:parsed.data})});
   const payload=await response.json().catch(()=>null);
   if(current.current!==submitted)return;
   if(!response.ok||typeof payload?.guidance?.id!=='string'||payload.guidance.name!=='guidance.memory'||!Number.isInteger(payload.guidance.revision)||!['proposed','approved','rejected'].includes(payload.guidance.state)){setStatus('Feedback could not be confirmed. Your correction is preserved.');return;}
   setStatus('Feedback saved as a suggestion. Confirm it in saved guidance before use.');setReason('');setPreference('');retry.current=null;
  }catch{if(current.current===submitted)setStatus('Feedback could not be confirmed. Your correction is preserved.');}
  finally{locked.current=false;if(current.current!==null)setSaving(false);}
 }
 const field='mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--input)] p-2 text-sm';
 return <details className="p-4 text-xs"><summary className="cursor-pointer underline underline-offset-4">Suggest a preference from this saved {source.kind==='sequence_draft'?'draft':'company review'}</summary><form onSubmit={submit} className="mt-3 space-y-3">
  <p>Saved version {source.revision}. This proposes guidance for separate confirmation. It does not change this item, start an agent, approve outreach or publish a sequence.</p>
  <label className="block">What should improve?<textarea className={field} required minLength={5} maxLength={2000} disabled={disabled} value={reason} onChange={event=>setReason(event.target.value)}/></label>
  <label className="block">Preference to propose<textarea className={field} required minLength={5} maxLength={2000} disabled={disabled} value={preference} onChange={event=>setPreference(event.target.value)}/></label>
  <label className="block">Use for<select className={field} disabled={disabled} value={category} onChange={event=>setCategory(event.target.value as AgentManualFeedbackInput['category'])}><option value="qualification">Company fit</option><option value="tone">Writing style</option><option value="buyer_context">Buyer context</option><option value="follow_up">Follow-ups</option></select></label>
  <button type="submit" disabled={disabled} className="min-h-11 rounded-lg border border-[var(--border)] px-3 py-2">Save feedback suggestion</button>
  {stale&&<><p role="status">This saved version changed. Your correction is preserved; review the current item before saving feedback.</p><button type="button" disabled={busy||saving} onClick={()=>{setReviewed(identity);setStatus('Review the current saved item and correction before saving.');}}>Use current version</button></>}{busy&&!saving&&<p>Save your current edits and review the saved version before giving feedback.</p>}{status&&<p role="status">{status}</p>}
  <a href={`/mandates/${mandateId}/agent`} className="inline-block underline">Review and confirm saved guidance</a>
 </form></details>;
}
