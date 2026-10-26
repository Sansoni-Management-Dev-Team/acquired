'use client';

import Link from 'next/link';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {briefSchema} from '@/domain/acquisition';
import type {AgentSnapshot} from '@/domain/agent-mode';
import {mandateCompaniesHref} from '@/domain/mandate-navigation';
import {AgentWorkspace} from './agent-workspace';
import {continueMandateSearch,readMandateSearch,type MandateSearchLaunch} from '@/lib/mandate-search-launch';

function draftDescription(draft:MandateSearchLaunch){
 if(draft.description)return draft.description;
 try{const parsed=briefSchema.safeParse(JSON.parse(draft.requestBody??'').brief);if(parsed.success)return parsed.data.naturalLanguage;}catch{}
 return '';
}

function pendingSnapshot(mandateId:string,draft:MandateSearchLaunch):AgentSnapshot{
 let name='New acquisition mandate';
 try{const brief=briefSchema.safeParse(JSON.parse(draft.requestBody??'').brief);if(brief.success)name=brief.data.name;}catch{}
 return {
  mandate:{id:mandateId,name,description:draftDescription(draft)},scope:'research-only',
  initialResearch:{requestId:mandateId,status:'awaiting_start',source:'live'},
  research:{total:0,queued:0,active:0,complete:0,needsReview:0,cancelled:0},jobs:[],
  links:{brief:'/',companies:mandateCompaniesHref(mandateId)},
 };
}

/** A browser-only pending intent may precede the mandate row. It reveals no
 * saved data and starts no work until the owner explicitly clicks Start. */
export function AgentMandatePreparation({mandateId,ownerScope}:{mandateId:string;ownerScope:string}){
 const router=useRouter(),lock=useRef(false);
 const [draft,setDraft]=useState<MandateSearchLaunch>(),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const initial=useMemo(()=>draft?pendingSnapshot(mandateId,draft):undefined,[mandateId,draft]);
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
 return <AgentWorkspace initial={initial!} preparation={{onStart:()=>void start(),busy,error,researchOnly:draft.preset==='live-research-test'}} />;
}
