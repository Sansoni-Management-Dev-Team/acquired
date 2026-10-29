'use client';
import{useCallback,useEffect,useRef,useState}from'react';
import { providerNeutralText } from "@/domain/provider-display";
import{randomUuid}from'@/lib/random-uuid';
import{startAgentActivityPolling}from'@/lib/agent-activity-poller';
import{canAdoptCompanyIdentityReview,companyIdentityReviewSchema,companyIdentityDecisionReceiptSchema,type CompanyIdentityReview}from'@/domain/company-identity-review';

type Decision={requestKey:string;reviewId:string;expectedRevision:number;previewDigest:string;decision:'adopt'|'skip';selectedTargetId?:string};
type Props={mandateId:string;busy?:boolean;variant?:'companies'|'agent';onResolved?:()=>void;initialReviews?:CompanyIdentityReview[]};
const button='min-h-11 rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40';
function safeLink(raw:string|undefined){try{const u=new URL(raw??'');return['http:','https:'].includes(u.protocol)?u.href:undefined;}catch{return undefined;}}
/** Both workspaces use the same read/decision endpoint. This component never
 * approves research, moves contacts or selects an outbound account. */
export function CompanyIdentityReviews({mandateId,busy=false,variant='companies',onResolved,initialReviews}:Props){
 const[reviews,setReviews]=useState(initialReviews??[]),[opened,setOpened]=useState(false),[reviewId,setReviewId]=useState<string|null>(null),[working,setWorking]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[attempt,setAttempt]=useState<Decision|null>(null),[choiceGeneration,setChoiceGeneration]=useState(0),[duplicateError,setDuplicateError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true),locked=useRef(false),outerBusy=useRef(busy),version=useRef(0),readSequence=useRef(0),duplicateScope=useRef<string|null>(null),resolved=useRef(onResolved);
 useEffect(()=>{outerBusy.current=busy;},[busy]);
 useEffect(()=>{resolved.current=onResolved;},[onResolved]);
 const endpoint=`/api/mandates/${mandateId}/company-identities`;
 const load=useCallback(async(signal?:AbortSignal)=>{const response=await fetch(endpoint,{cache:'no-store',credentials:'same-origin',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});if(!response.ok)throw Error('Identity reviews unavailable');const value=await response.json();if(!Array.isArray(value.reviews)||value.reviews.length>100)throw Error('Invalid identity reviews');return(value.reviews as unknown[]).map(review=>companyIdentityReviewSchema.parse(review));},[endpoint]);
 const apply=useCallback((next:CompanyIdentityReview[])=>{setReviews(next);setError('');},[]);
 const refresh=useCallback(async()=>{const seq=++readSequence.current;try{const next=await load();if(alive.current&&seq===readSequence.current)apply(next);return next;}catch{if(alive.current&&seq===readSequence.current)setError('Company identity reviews could not be refreshed. Check again before choosing.');return null;}},[load,apply]);
 const reconcile=useCallback(async()=>{
  if(locked.current||outerBusy.current||attempt)return;
  locked.current=true;duplicateScope.current=mandateId;const seq=++version.current;readSequence.current++;setWorking(true);setDuplicateError('');
  try{
   const response=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reconcile_duplicates'}),signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('Unconfirmed duplicate consolidation');
   const value=await response.json();if(!Number.isSafeInteger(value.resolved)||value.resolved<0||value.resolved>50)throw Error('Confirmed consolidation count required');
   if(!alive.current||seq!==version.current)return;
   await refresh();
   if(alive.current&&seq===version.current&&value.resolved>0){try{resolved.current?.();}catch{/* The saved consolidation remains authoritative if a view callback fails. */}}
  }catch{if(alive.current&&seq===version.current)setDuplicateError('Could not confirm automatic duplicate consolidation.');}
  finally{locked.current=false;if(alive.current)setWorking(false);}
 },[attempt,endpoint,mandateId,refresh]);
 useEffect(()=>{alive.current=true;const sequence=readSequence,generation=version;return()=>{alive.current=false;sequence.current++;generation.current++;};},[mandateId]);
 useEffect(()=>startAgentActivityPolling({intervalMs:30000,isBusy:()=>locked.current||outerBusy.current,isVisible:()=>typeof document==='undefined'||document.visibilityState!=='hidden',version:()=>version.current,load,apply,onFailure:()=>setError('Company identity reviews could not be refreshed. Check again before choosing.')}),[load,apply]); // One bounded subscription per workspace, independent of table filters.
 useEffect(()=>{if(duplicateScope.current!==mandateId&&!busy&&!working&&!attempt)void reconcile();},[mandateId,busy,working,attempt,reconcile]);
 useEffect(()=>{if(opened&&dialog.current&&!dialog.current.open)dialog.current.showModal();},[opened]);
 async function open(){if(locked.current)return;setOpened(true);setNotice('');const next=await refresh();if(next?.length)setReviewId(next.some(r=>r.reviewId===reviewId)?reviewId:next[0].reviewId);}
 async function submit(command:Decision){
  if(locked.current||busy)return;locked.current=true;version.current++;readSequence.current++;setWorking(true);setError('');setAttempt(command);
  try{const response=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(10000)});
   if(response.status===409){if(alive.current){setAttempt(null);setChoiceGeneration(value=>value+1);}await refresh();if(alive.current)setError('The identity evidence changed. Review the current choices again.');return;}
   if(!response.ok)throw Error('Unconfirmed identity decision');const value=await response.json(),receipt=companyIdentityDecisionReceiptSchema.parse(value.decision);
   if(receipt?.reviewId!==command.reviewId||receipt.status!==(command.decision==='adopt'?'adopted':'skipped')||(command.decision==='adopt'&&(receipt.status!=='adopted'||receipt.targetId!==command.selectedTargetId)))throw Error('Original decision receipt required');
   if(alive.current){setAttempt(null);setReviews(old=>old.filter(r=>r.reviewId!==command.reviewId));setReviewId(null);setNotice(command.decision==='adopt'?'Company choice recorded. Existing records and outreach permissions stay separate.':'Research result skipped. Existing company records were kept.');}
   try{onResolved?.();}catch{/* The confirmed receipt remains authoritative if a view callback fails. */}await refresh();
  }catch{if(alive.current)setError('Could not confirm this decision. Retry the same decision to check its saved receipt.');}
  finally{locked.current=false;if(alive.current)setWorking(false);}
 }
 const current=reviews.find(r=>r.reviewId===reviewId)??reviews[0];
 if(!reviews.length&&!opened&&!error&&!notice&&!duplicateError)return null;
 return <section aria-label="Company identity reviews" className={variant==='agent'?'shrink-0 border-b border-[var(--border)] px-5 py-2':'rounded-lg border border-[var(--border)] px-4 py-3'}>
  <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><p>{reviews.length?`${reviews.length} company ${reviews.length===1?'identity needs':'identities need'} review.`:notice||'Company identity review needs attention.'}</p><button type="button" className={button} disabled={busy||working} onClick={()=>void open()}>Review company identities</button></div>
  {!opened&&error&&<p role="status" className="mt-1 text-xs">{providerNeutralText(error)}</p>}
  {!opened&&duplicateError&&<div className="mt-1 flex flex-wrap items-center gap-2 text-xs"><p role="status">{duplicateError}</p><button type="button" className="min-h-11 underline disabled:opacity-40" disabled={busy||working||Boolean(attempt)} onClick={()=>void reconcile()}>Retry duplicate check</button></div>}
  {opened&&<dialog ref={dialog} aria-labelledby="company-identity-review-title" onCancel={event=>{event.preventDefault();if(!working)setOpened(false);}} className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-2xl overflow-y-auto border-l border-[var(--border)] bg-[var(--panel)] p-0 text-[var(--foreground)] backdrop:bg-black/40">
   <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--panel)] p-5"><h2 id="company-identity-review-title" className="text-xl font-semibold">Review company identity</h2><button type="button" className={button} disabled={working} onClick={()=>setOpened(false)}>Close identity review</button></header>
   <div className="space-y-4 p-5">
    {duplicateError&&<div className="space-y-1 text-sm"><p role="alert">{duplicateError}</p><button type="button" className={button} disabled={busy||working||Boolean(attempt)} onClick={()=>void reconcile()}>Retry duplicate check</button></div>}
    {error&&<p role="alert" className="text-sm">{providerNeutralText(error)}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
    {attempt?<div className="space-y-3 rounded-lg border border-[var(--border)] p-4"><p className="text-sm">The original {attempt.decision==='adopt'?'company choice':'skip decision'} is awaiting confirmation. No new choice will be submitted.</p><button type="button" className={button} disabled={busy||working} onClick={()=>void submit(attempt)}>Retry same decision</button></div>:current?<>
     {reviews.length>1&&<label className="block text-sm">Research result<select className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--panel)] p-2" value={current.reviewId} disabled={working} onChange={e=>{setReviewId(e.target.value);setError('');setNotice('');}}>{reviews.map(r=><option key={r.reviewId} value={r.reviewId}>{r.source.companyName}</option>)}</select></label>}
     <CompanyIdentityChoice key={JSON.stringify([choiceGeneration,current])} review={current} busy={busy||working} onSubmit={value=>void submit({...value,requestKey:randomUuid()})}/>
    </>:!notice&&<p className="text-sm">No current company identity reviews.</p>}
    <button type="button" className="min-h-11 text-sm underline disabled:opacity-40" disabled={working} onClick={()=>void refresh()}>Refresh identity evidence</button>
   </div>
  </dialog>}
 </section>;
}
export function CompanyIdentityChoice({review,busy,onSubmit}:{review:CompanyIdentityReview;busy:boolean;onSubmit:(value:Omit<Decision,'requestKey'>)=>void}){
 const[choice,setChoice]=useState(''),[confirmed,setConfirmed]=useState(false);const allowed=canAdoptCompanyIdentityReview(review.reason),url=safeLink(review.source.sourceUrl);
 const base={reviewId:review.reviewId,expectedRevision:review.revision,previewDigest:review.previewDigest};
 return <div className="space-y-4">
  <div><h3 className="break-words text-lg font-semibold">{review.source.companyName}</h3><dl className="mt-2 space-y-1 text-sm"><div><dt className="inline text-[var(--muted)]">Research domain: </dt><dd className="inline break-all">{review.source.domain||'Unknown'}</dd></div>{review.source.firmableId&&<div><dt className="inline text-[var(--muted)]">Company data ID: </dt><dd className="inline">{review.source.firmableId}</dd></div>}{review.source.abn&&<div><dt className="inline text-[var(--muted)]">ABN: </dt><dd className="inline">{review.source.abn}</dd></div>}<div><dt className="inline text-[var(--muted)]">Observed: </dt><dd className="inline"><time dateTime={review.source.observedAt}>{review.source.observedAt}</time></dd></div></dl>{url&&<a className="mt-2 inline-block min-h-11 text-sm underline" href={url} target="_blank" rel="noreferrer">View identity source</a>}</div>
  <p className="text-sm">{allowed?'Several saved records have consistent source identities. Choose the existing company for this research result.':review.reason==='source_changed'?'The research source changed. A company cannot be adopted from this preview; skip it or review fresh evidence.':'The identifiers conflict. A company cannot be adopted from this preview; skip it or review the source evidence.'}</p>
  <fieldset className="space-y-3" disabled={busy||!allowed}><legend className="mb-2 text-sm font-medium">Existing company records · choose one</legend>{review.candidates.map(c=><label key={c.targetId} className="flex items-start gap-3 rounded-lg border border-[var(--border)] p-3 text-sm"><input type="radio" name={'company-identity-'+review.reviewId} value={c.targetId} checked={choice===c.targetId} onChange={()=>{setChoice(c.targetId);setConfirmed(false);}} className="mt-1"/><span className="min-w-0"><strong className="block break-words">{c.companyName}</strong><span className="block break-all">{c.domain||'Domain unknown'}{c.firmableId?` · ${c.firmableId}`:''}{c.abn?` · ABN ${c.abn}`:''}</span><span className="mt-1 block">{c.savedPeopleCount} saved {c.savedPeopleCount===1?'person':'people'} · eligibility not confirmed</span><span className="block">Used in {c.mandateCount} {c.mandateCount===1?'mandate':'mandates'}{c.workflowSummary?` · ${c.workflowSummary}`:''}</span><span className="mt-1 block break-all text-xs text-[var(--muted)]">Company record: {c.targetId}</span></span></label>)}{!review.candidates.length&&<p className="text-sm">No existing record is available to choose.</p>}</fieldset>
  <p className="text-xs text-[var(--muted)]">This decision links a research result. It does not merge company records, move people or history, confirm acquisition fit, or approve research or outreach.</p>
  <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)} className="mt-1"/>I reviewed the source and existing records for this decision.</label>
  <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy||!allowed||!choice||!confirmed} onClick={()=>onSubmit({...base,decision:'adopt',selectedTargetId:choice})}>Use selected company</button><button type="button" className={button} disabled={busy||!confirmed} onClick={()=>onSubmit({...base,decision:'skip'})}>Skip research result</button></div>
  <details className="text-xs"><summary className="min-h-11 cursor-pointer py-3">Research reference</summary><p className="break-all">Observation {review.source.observationId}<br/>Job {review.source.jobId}<br/>Mandate {review.source.mandateId}<br/>Review revision {review.revision}</p></details>
 </div>;
}
