'use client';

import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {briefSchema} from '@/domain/acquisition';
import {continueMandateSearch,readMandateSearch,type MandateSearchLaunch} from '@/lib/mandate-search-launch';

function draftDescription(draft:MandateSearchLaunch){
 if(draft.description)return draft.description;
 try{const parsed=briefSchema.safeParse(JSON.parse(draft.requestBody??'').brief);if(parsed.success)return parsed.data.naturalLanguage;}catch{}
 return '';
}

/** A browser-only pending intent may precede the mandate row. It reveals no
 * saved data and starts no work until the owner explicitly clicks Start. */
export function AgentMandatePreparation({mandateId,ownerScope}:{mandateId:string;ownerScope:string}){
 const router=useRouter(),lock=useRef(false);
 const [draft,setDraft]=useState<MandateSearchLaunch>(),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let mounted=true;
  // Session storage is an external recovery source; inspect it after hydration.
  queueMicrotask(()=>{
   if(!mounted)return;
   const pending=readMandateSearch(mandateId);
   setDraft(pending?.presentation==='agent'&&pending.ownerScope===ownerScope?pending:undefined);
   setLoaded(true);
  });
  return()=>{mounted=false;};
 },[mandateId,ownerScope]);
 async function start(){
  if(!draft||draft.requestId!==mandateId||draft.ownerScope!==ownerScope||lock.current)return;
  lock.current=true;setBusy(true);setError('');
  let saved=false;
  try{
   const result=await continueMandateSearch(mandateId,undefined,undefined,{presentation:'agent',ownerScope});
   if(!result)throw Error('This agent request is unavailable. Return to your brief.');
   saved=true;
   router.refresh();
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not confirm this agent request. Retry the same request.');}
  finally{if(!saved){lock.current=false;setBusy(false);}}
 }
 if(!loaded)return <p role="status" className="p-5 text-sm text-[var(--muted)]">Opening your agent workspace…</p>;
 if(!draft||draft.requestId!==mandateId||draft.ownerScope!==ownerScope)return <section className="mx-auto max-w-3xl space-y-4 p-5 sm:p-8"><h1 className="text-2xl font-semibold">Agent workspace unavailable</h1><p className="text-sm text-[var(--muted)]">No pending agent request is available for this workspace. Return to your brief or open a saved mandate.</p><Link href="/" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Back to brief</Link></section>;
 return <section aria-labelledby="agent-preparation-title" className="mx-auto max-w-3xl space-y-6 p-5 sm:p-8">
  <div><p className="text-xs font-semibold uppercase tracking-widest text-[var(--muted)]">Agent mode</p><h1 id="agent-preparation-title" className="mt-3 text-3xl font-semibold">Your agent workspace</h1><p className="mt-3 text-sm text-[var(--muted)]">Review your brief, then start the agent process to prepare your mandate and research companies and people.</p></div>
  <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 sm:p-7"><h2 className="text-lg font-semibold">Your brief</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{draftDescription(draft)}</p></div>
  {draft.preset==='live-research-test'&&<p className="text-sm text-[var(--muted)]">Live research only. Outreach stays disabled.</p>}
  {error&&<p role="alert" className="text-sm text-[var(--status-red)]">{error}</p>}
  <div className="flex flex-wrap gap-4"><button type="button" disabled={busy} onClick={()=>void start()} className="inline-flex min-h-12 items-center rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-50">{busy?'Starting agent process…':error?'Retry agent process':'Start agent process'}</button><Link href="/" className="inline-flex min-h-12 items-center text-sm underline underline-offset-4">Back to brief</Link></div>
 </section>;
}
