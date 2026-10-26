'use client';

import Link from 'next/link';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {continueMandateSearch} from '@/lib/mandate-search-launch';
import {CompanyPipelineProgress} from './company-pipeline-progress';
import {CompanyDiscoveryLoading} from './company-discovery-loading';

/** This route exists before the row does. Only the explicitly staged browser
 * draft may launch work; ordinary links inspect their owned saved progress. */
export function MandateSearchRun({mandateId}:{mandateId:string}){
 const router=useRouter();const [ready,setReady]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let mounted=true;
  void continueMandateSearch(mandateId).then(saved=>{
   if(!mounted)return;
   if(saved?.presentation==='agent'){router.replace(`/mandates/${saved.mandateId}/agent`);return;}
   setReady(true);
  }).catch(cause=>{if(mounted)setError(cause instanceof Error?cause.message:'Could not confirm this search. Retry the same saved request.');});
  return()=>{mounted=false;};
 },[mandateId,router,attempt]);
 if(ready)return <CompanyDiscoveryLoading mandateId={mandateId} startedJobId={mandateId} />;
 return <div className="p-5 sm:p-8"><CompanyPipelineProgress detail={error?'Preparation needs attention. Your search identity is preserved.':'Preparing your mandate and starting research…'} />{error&&<div className="mx-auto max-w-[620px] space-y-3"><p role="alert" className="text-sm text-[var(--muted)]">{error}</p><div className="flex flex-wrap gap-3"><button type="button" className="min-h-11 rounded-lg border border-[var(--border)] px-4 text-sm" onClick={()=>{setError('');setAttempt(value=>value+1);}}>Retry preparation</button><Link href="/" className="inline-flex min-h-11 items-center px-2 text-sm underline underline-offset-4">Back to brief</Link></div></div>}</div>;
}
