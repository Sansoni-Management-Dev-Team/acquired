'use client';
import {useEffect,useRef,useState} from 'react';
import {z} from 'zod';
import {briefSchema,criterionDefinitions,searchReadiness,type AcquisitionBrief} from '@/domain/acquisition';
import {randomUuid} from '@/lib/random-uuid';
const revision=z.string().regex(/^\d{1,30}$/);
const savedSchema=z.object({brief:briefSchema,revision});
const executionSchema=z.object({enabled:z.boolean(),mandateRevision:revision.optional(),state:z.object({mandateRevision:revision,responsibility:z.object({revision:z.number().int().positive(),state:z.string(),mandate_revision:revision.optional()}).nullable()}).nullable()});
type Control={action:'start'|'resume';requestKey:string;expectedRevision:number;mandateRevision:string};
type Attempt={saved?:z.infer<typeof savedSchema>;control?:Control;requestKey:string;blocked?:boolean;completed?:boolean};
type Props={mandateId:string;busy?:boolean;onReviewed?:()=>void|Promise<void>;forceOpen?:boolean};
const button='min-h-11 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40';
export function AgentBriefReview({mandateId,busy=false,onReviewed,forceOpen=false}:Props){
 const [saved,setSaved]=useState<z.infer<typeof savedSchema>>(),[draft,setDraft]=useState<AcquisitionBrief>(),[execution,setExecution]=useState<z.infer<typeof executionSchema>>(),[error,setError]=useState(''),[working,setWorking]=useState(false),[done,setDone]=useState(false),[loadedFor,setLoadedFor]=useState(''),[attemptView,setAttemptView]=useState<{saved:boolean;control:boolean;blocked:boolean}|null>(null);
 const attempt=useRef<Attempt|null>(null),lock=useRef(false),generation=useRef(0);
 async function read(path:string){const response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('The saved brief and agent status could not be loaded.');return response.json();}
 async function load(token:number){try{const[b,e]=await Promise.all([read(`/api/mandates/${mandateId}?briefOnly=true`),read(`/api/mandates/${mandateId}/agent/execution`)]),current=savedSchema.parse(b.mandate),status=executionSchema.parse(e);if(generation.current!==token)return;setSaved(current);setDraft(current.brief);setExecution(status);setError('');setDone(false);setLoadedFor(mandateId);attempt.current=null;setAttemptView(null);}catch{if(generation.current===token)setError('Could not load the saved brief. Check the connection, then reload it.');}}
 useEffect(()=>{const token=++generation.current;void load(token);return()=>{generation.current++;};},[mandateId]); // eslint-disable-line react-hooks/exhaustive-deps
 // Opening the existing card changes presentation only. A completed review
 // may explicitly reopen against a fresh snapshot; an in-flight/unknown control
 // retains its exact original request and is never replaced by this toggle.
 useEffect(()=>{if(forceOpen&&done&&!lock.current)void load(++generation.current);},[forceOpen]); // eslint-disable-line react-hooks/exhaustive-deps
 async function submit(){
  if(loadedFor!==mandateId||lock.current||busy||!saved||!draft||!execution?.enabled||searchReadiness(draft).length||attempt.current?.blocked)return;
  const token=generation.current;lock.current=true;setWorking(true);setError('');
  const current:Attempt={...(attempt.current??{requestKey:randomUuid()})};
  try{
   if(!current.saved){
    const updated=briefSchema.parse(draft);let response:Response;
    try{response=await fetch(`/api/mandates/${mandateId}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'brief',brief:updated,expectedRevision:saved.revision}),signal:AbortSignal.timeout(30000)});}catch{current.blocked=true;throw Error('The brief save could not be confirmed. Reload the saved brief before continuing.');}
    if(!response.ok){current.blocked=true;throw Error(response.status===409?'The saved brief changed. Reload and review it before continuing.':'The brief could not be saved. Reload it before continuing.');}
    try{current.saved=savedSchema.parse(await response.json());if(JSON.stringify(current.saved.brief)!==JSON.stringify(updated))throw Error();}catch{current.saved=undefined;current.blocked=true;throw Error('The saved brief receipt could not be verified. Reload before continuing.');}
   }
   if(!current.control){
    const state=executionSchema.parse(await read(`/api/mandates/${mandateId}/agent/execution`));
    if(!state.enabled)throw Error('The reviewed brief is saved. Agent supervision is currently unavailable.');
    if((state.state?.mandateRevision??state.mandateRevision)!==current.saved.revision){current.blocked=true;throw Error('The brief changed after saving. Reload and review the current version before continuing.');}
    current.control={action:state.state?.responsibility?'resume':'start',requestKey:current.requestKey,expectedRevision:state.state?.responsibility?.revision??0,mandateRevision:current.saved.revision};
   }
   let response:Response;
   try{response=await fetch(`/api/mandates/${mandateId}/agent/execution`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(current.control),signal:AbortSignal.timeout(15000)});}catch{throw Error('The supervision request could not be confirmed. Retry this same request to reconcile it.');}
   if(!response.ok){if(response.status===409){current.blocked=true;throw Error('Supervision changed. Reload and review the current state before continuing.');}throw Error('The supervision request could not be confirmed. Retry this same request to reconcile it.');}
   // HTTP success is the control receipt; refreshing the presentation is not
   // another permission and must never turn a saved control into a retry.
   current.completed=true;
   if(generation.current===token){setDone(true);setSaved(current.saved);setDraft(current.saved.brief);try{await onReviewed?.();}catch{/* The saved control remains successful. Parent polling can refresh. */}}
  }catch(cause){if(generation.current===token)setError(cause instanceof Error?cause.message:'The supervision request could not be confirmed. Retry the original request.');}
  finally{lock.current=false;if(generation.current===token){attempt.current={...current};setAttemptView({saved:Boolean(current.saved),control:Boolean(current.control),blocked:Boolean(current.blocked)});setWorking(false);}}
 }
 const responsibility=execution?.state?.responsibility;
 const starting=!responsibility||!['ready','waiting','paused'].includes(responsibility.state);
 const needsReview=Boolean(saved&&(searchReadiness(saved.brief).length||starting||responsibility.mandate_revision&&responsibility.mandate_revision!==saved.revision));
 const owned=loadedFor===mandateId;
 if(owned&&execution?.enabled===false)return null;
 if(owned&&(done||saved&&!needsReview&&!forceOpen&&!attemptView&&!error))return null;
 const frozen=busy||working||Boolean(attemptView?.saved)||Boolean(attemptView?.blocked),ready=Boolean(draft&&!searchReadiness(draft).length);
 function change(key:string,value:Partial<AcquisitionBrief['criteria'][number]>){setDraft(current=>current?{...current,criteria:current.criteria.map(c=>c.key===key?{...c,...value}:c)}:current);}
 function criterionInput(c:AcquisitionBrief['criteria'][number]){const label=criterionDefinitions.find(([key])=>key===c.key)?.[1]??c.key;return <fieldset key={c.key} className="space-y-2 border-t border-[var(--border)] pt-3"><legend className="font-medium">{label}</legend>{c.state!=='unrestricted'?<textarea aria-label={`${label} value`} disabled={frozen} value={c.state==='unknown'?'':c.value} maxLength={1500} rows={c.key==='subsectors'?2:1} onChange={e=>change(c.key,{value:e.target.value,state:e.target.value.trim()?'specified':'unknown',confirmed:false})} className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] p-2"/>:<p>No restriction</p>}<label className="flex items-center gap-2"><input type="checkbox" aria-label={`${label} reviewed`} checked={c.confirmed} disabled={frozen||c.state==='unknown'||c.state==='specified'&&!c.value.trim()} onChange={e=>{if(c.state!=='unknown'&&(c.state==='unrestricted'||c.value.trim()))change(c.key,{confirmed:e.target.checked});}}/>I reviewed this preference</label></fieldset>;}
 return <section id="agent-brief-review" aria-label="Review saved brief" className="space-y-3 rounded-xl border border-[var(--border)] p-4 text-sm">
  <h2 className="font-semibold">Review your saved research brief</h2>
  {!owned||!saved||!draft?<p>Loading the saved brief…</p>:<><p className="line-clamp-2 text-[var(--muted)]">{saved.brief.naturalLanguage}</p><details><summary className="cursor-pointer text-xs text-[var(--muted)]">Original brief</summary><p className="mt-2 whitespace-pre-wrap">{saved.brief.naturalLanguage}</p></details><p>Review your search preferences. Unknown answers stay unknown. This does not verify company facts or approve research, contacts or messages.</p>
   <div className="grid gap-3 sm:grid-cols-2">{draft.criteria.filter(c=>['subsectors','geography'].includes(c.key)||['revenue','headcount'].includes(c.key)&&c.state!=='unknown').map(criterionInput)}</div>
   {draft.criteria.some(c=>!['subsectors','geography','revenue','headcount'].includes(c.key)&&c.state!=='unknown')&&<details><summary className="cursor-pointer text-sm">Other saved preferences</summary><div className="mt-3 space-y-3">{draft.criteria.filter(c=>!['subsectors','geography','revenue','headcount'].includes(c.key)&&c.state!=='unknown').map(criterionInput)}</div></details>}
   {!ready&&<p className="text-xs text-[var(--muted)]">Enter and review subsectors and geography before continuing.</p>}
   <button type="button" disabled={busy||working||!ready||!execution?.enabled||Boolean(attemptView?.blocked)} onClick={()=>void submit()} className={`${button} ${starting?'bg-[var(--accent)] text-[var(--on-accent)]':''}`}>{working?'Saving reviewed brief…':attemptView?.control?'Retry supervision request':attemptView?.saved?'Continue supervision':starting?'Start agent':'Save reviewed brief and continue'}</button>
  </>}
  {error&&<p role="alert">{error}</p>}
  {error&&(!attemptView?.control||attemptView.blocked)&&<button type="button" className={button} disabled={busy||working} onClick={()=>void load(++generation.current)}>Reload saved brief</button>}
 </section>;
}
