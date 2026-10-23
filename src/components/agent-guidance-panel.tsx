'use client';
import {useState} from 'react';
import {randomUuid} from '@/lib/random-uuid';
import type {AgentGuidanceView} from '@/domain/agent-guidance';
type Input=AgentGuidanceView['input'];
type Props={guidance:AgentGuidanceView[];busy:boolean;draft?:{sourceMessageId:string;text:string};onCloseDraft:()=>void;onAction:(input:unknown)=>Promise<boolean>};
function GuidanceDraft({input,busy,onCancel,onSave}:{input:Input;busy:boolean;onCancel:()=>void;onSave:(input:Input,requestKey:string)=>Promise<boolean>}){
 const [text,setText]=useState(input.text),[category,setCategory]=useState(input.category);
 const [requestKey]=useState(()=>randomUuid());
 const [avoid,setAvoid]=useState(input.qualificationPolicy?.avoidTerms.join('\n')??''),[prefer,setPrefer]=useState(input.qualificationPolicy?.preferTerms.join('\n')??'');
 const phrases=(value:string)=>[...new Set(value.split(/\n/).map(term=>term.trim()).filter(Boolean))];
 return <form className="space-y-3 rounded-lg border border-[var(--border)] p-4 text-sm" onSubmit={event=>{event.preventDefault();const {qualificationPolicy:_previous,...source}=input;void _previous;const avoidTerms=phrases(avoid),preferTerms=phrases(prefer);void onSave({...source,text,category,...(category==='qualification'&&(avoidTerms.length||preferTerms.length)?{qualificationPolicy:{avoidTerms,preferTerms}}:{})},requestKey).then(saved=>{if(saved)onCancel();});}}>
  <p className="font-semibold">Guidance for this mandate</p><p className="text-xs text-[var(--muted)]">Save a suggestion, then confirm it before the assistant uses it.</p>
  <label className="block">Preference<textarea disabled={busy} value={text} maxLength={2000} required onChange={event=>setText(event.target.value)} className="mt-2 min-h-28 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] p-3"/></label>
  <label className="block">Use for<select disabled={busy} value={category} onChange={event=>setCategory(event.target.value as Input['category'])} className="ml-3 min-h-11 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3"><option value="qualification">Company fit</option><option value="tone">Writing style</option><option value="buyer_context">Buyer context</option><option value="follow_up">Follow-ups</option></select></label>
  {category==='qualification'&&<fieldset className="space-y-2"><legend className="font-medium">Optional company evidence phrases</legend><p className="text-xs text-[var(--muted)]">One exact phrase per line, up to 8 each. After you confirm, matching company evidence can exclude a target from native allocation or raise its priority. This does not edit your mandate or approve outreach.</p><label className="block">Avoid when evidenced<textarea aria-label="Avoid when evidenced" disabled={busy} value={avoid} maxLength={640} onChange={event=>setAvoid(event.target.value)} className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--input)] p-2"/></label><label className="block">Prefer when evidenced<textarea aria-label="Prefer when evidenced" disabled={busy} value={prefer} maxLength={640} onChange={event=>setPrefer(event.target.value)} className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--input)] p-2"/></label></fieldset>}
  {input.sourceEntity&&<p className="text-xs text-[var(--muted)]">Source: {input.sourceEntity.kind} {input.sourceEntity.id} · version {input.sourceEntity.revision}</p>}
  <div className="flex gap-2"><button type="submit" disabled={busy||!text.trim()} className="min-h-11 rounded-lg bg-[var(--accent)] px-4 font-semibold text-[var(--on-accent)] disabled:opacity-40">Save suggestion</button><button type="button" disabled={busy} onClick={onCancel} className="min-h-11 px-4">Cancel</button></div>
 </form>;
}
export function AgentGuidancePanel({guidance,busy,draft,onCloseDraft,onAction}:Props){
 const [editing,setEditing]=useState<AgentGuidanceView|null>(null);
 const current=guidance.filter(item=>item.state!=='rejected');
 return <section aria-label="Mandate guidance" className="space-y-3">
  {draft&&<GuidanceDraft key={draft.sourceMessageId} input={{text:draft.text.slice(0,2000),sourceMessageId:draft.sourceMessageId,category:'qualification',triggerTerms:[]}} busy={busy} onCancel={onCloseDraft} onSave={(input,requestKey)=>onAction({action:'propose',requestKey,input})}/>}
  <details className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"><summary className="min-h-7 cursor-pointer text-sm font-semibold">Saved guidance ({current.length})</summary>
   <p className="mt-3 text-xs text-[var(--muted)]">For this mandate only. Guidance cannot change sending permissions or budgets.</p>
   {!current.length&&<p className="mt-3 text-xs text-[var(--muted)]">Use a message as guidance when you want the assistant to remember a preference.</p>}
   {current.map(item=><article key={item.id} className="mt-4 space-y-2 border-t border-[var(--border)] pt-4 text-sm">
    {editing?.id===item.id?<GuidanceDraft input={editing.input} busy={busy} onCancel={()=>setEditing(null)} onSave={input=>onAction({action:'edit',id:item.id,revision:item.revision,input})}/>:<><p className="whitespace-pre-wrap break-words">{item.input.text}</p><p className="text-xs text-[var(--muted)]">{item.state==='proposed'?'Not used until you confirm':'Confirmed'} · Version {item.revision}</p>
     {item.input.qualificationPolicy&&<p className="text-xs text-[var(--muted)]">Avoid evidence: {item.input.qualificationPolicy.avoidTerms.join(' · ')||'None'} · Prefer evidence: {item.input.qualificationPolicy.preferTerms.join(' · ')||'None'}</p>}{item.input.sourceEntity&&<p className="text-xs text-[var(--muted)]">Source: {item.input.sourceEntity.kind} {item.input.sourceEntity.id} · version {item.input.sourceEntity.revision}</p>}
     <div className="flex flex-wrap gap-2">{item.state==='proposed'&&<button type="button" disabled={busy} onClick={()=>void onAction({action:'decide',id:item.id,revision:item.revision,decision:'approved',confirmed:true})} className="min-h-11 rounded-lg border border-[var(--border)] px-3 text-xs disabled:opacity-40">Confirm guidance</button>}
      <button type="button" disabled={busy} onClick={()=>setEditing(item)} className="min-h-11 px-3 text-xs underline underline-offset-4 disabled:opacity-40">Edit guidance</button>
      <button type="button" disabled={busy} onClick={()=>void onAction({action:'decide',id:item.id,revision:item.revision,decision:'rejected',confirmed:true})} className="min-h-11 px-3 text-xs underline underline-offset-4 disabled:opacity-40">{item.state==='approved'?'Revoke':'Dismiss'}</button></div>
    </>}
   </article>)}
  </details>
 </section>;
}
