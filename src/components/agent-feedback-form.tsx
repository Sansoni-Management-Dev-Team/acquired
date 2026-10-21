'use client';
import {useRef,useState} from 'react';
import type {AgentFeedbackInput} from '@/domain/agent-feedback';
import {agentFeedbackSchema} from '@/domain/agent-feedback';
import {randomUuid} from '@/lib/random-uuid';
type Props={source:AgentFeedbackInput['source'];busy:boolean;onSave:(input:unknown)=>Promise<boolean>};
export function AgentFeedbackForm({source,busy,onSave}:Props){
 const [reason,setReason]=useState(''),[preference,setPreference]=useState(''),[category,setCategory]=useState<AgentFeedbackInput['category']>('qualification'),[saving,setSaving]=useState(false),[status,setStatus]=useState('');
 const retry=useRef<{digest:string;key:string}|null>(null),locked=useRef(false);
 const [version,setVersion]=useState(()=>JSON.stringify(source));
 const stale=version!==JSON.stringify(source),disabled=busy||saving||stale;
 async function submit(event:React.FormEvent){
  event.preventDefault();if(disabled||locked.current)return;
  const parsed=agentFeedbackSchema.safeParse({source,reason,preference,category});if(!parsed.success){setStatus('Add a correction and the preference to propose.');return;}
  const identity=JSON.stringify(parsed.data);if(retry.current?.digest!==identity)retry.current={digest:identity,key:randomUuid()};
  locked.current=true;setSaving(true);setStatus('');
  try{if(await onSave({action:'feedback',requestKey:retry.current.key,input:parsed.data})){setStatus('Feedback saved as a suggestion. Confirm it in saved guidance before use.');setReason('');setPreference('');retry.current=null;}else setStatus('Feedback could not be confirmed. Your correction is preserved.');}
  catch{setStatus('Feedback could not be confirmed. Your correction is preserved.');}
  finally{locked.current=false;setSaving(false);}
 }
 const field='mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--input)] p-2 text-sm';
 return <details className="mt-3 text-xs"><summary className="cursor-pointer underline underline-offset-4">Give feedback</summary><form onSubmit={submit} className="mt-3 space-y-3">
  <p>About this {source.kind==='handoff'?'handoff':'proposal'} · version {source.revision}. Feedback does not approve or send anything.</p>
  <label className="block">What should improve?<textarea className={field} required minLength={5} maxLength={2000} disabled={disabled} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  <label className="block">Preference to propose<textarea className={field} required minLength={5} maxLength={2000} disabled={disabled} value={preference} onChange={e=>setPreference(e.target.value)}/></label>
  <label className="block">Use for<select className={field} disabled={disabled} value={category} onChange={e=>setCategory(e.target.value as AgentFeedbackInput['category'])}><option value="qualification">Company fit</option><option value="tone">Writing style</option><option value="buyer_context">Buyer context</option><option value="follow_up">Follow-ups</option></select></label>
  <button type="submit" disabled={disabled} className="min-h-11 rounded-lg border border-[var(--border)] px-3 py-2">Save feedback suggestion</button>
  {stale&&<><p role="status">This item changed. Review its current version before giving feedback. Your correction is preserved.</p><button type="button" disabled={busy||saving} onClick={()=>{setVersion(JSON.stringify(source));setStatus('Review the current item and correction before saving.');}}>Use current version</button></>}{status&&<p role="status">{status}</p>}
 </form></details>;
}
