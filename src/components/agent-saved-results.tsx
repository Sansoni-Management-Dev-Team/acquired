'use client';

import {useEffect,useState} from 'react';
import type {CompanyList} from '@/domain/company-list';
import type {StudioData} from './campaign-studio';
import {CompaniesWorkspace} from './companies-workspace';
import actionStyles from './agent-chat-actions.module.css';

type SavedPeople=Pick<StudioData,'contacts'>;
export function AgentSavedResults({mandateId,view,onClose,learningEnabled=false}:{mandateId:string;view:'companies'|'people';onClose:()=>void;learningEnabled?:boolean}){
 const [companies,setCompanies]=useState<CompanyList>(),[people,setPeople]=useState<SavedPeople>();
 const [error,setError]=useState(false),[attempt,setAttempt]=useState(0),[search,setSearch]=useState(''),[page,setPage]=useState(1);
 useEffect(()=>{
  const abort=new AbortController();
  void(async()=>{try{
   const response=await fetch(`/api/mandates/${mandateId}/${view==='companies'?'companies':'campaigns'}`,{cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000)])});
   if(!response.ok)throw new Error('Saved results unavailable');
   const data=await response.json();if(abort.signal.aborted)return;
   if(view==='companies')setCompanies(data as CompanyList);else setPeople(data as SavedPeople);
  }catch{if(!abort.signal.aborted)setError(true);}})();
  return()=>abort.abort();
 },[mandateId,view,attempt]);
 const contacts=people?.contacts.filter(person=>!person.fictionalised&&`${person.name} ${person.company} ${person.role??''} ${person.email??''}`.toLowerCase().includes(search.toLowerCase()));
 const pages=Math.max(1,Math.ceil((contacts?.length??0)/10)),currentPage=Math.min(page,pages);
 return <section aria-label={view==='companies'?'Companies in chat':'People in chat'} className="min-w-0 rounded-xl border border-[var(--border)] p-4">
  <header className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{view==='companies'?'Companies':'People'}{companies?` · ${companies.total}`:people?` · ${people.contacts.filter(person=>!person.fictionalised).length}`:''}</h2><button type="button" onClick={onClose} className={`${actionStyles.action} inline-flex min-h-11 items-center underline underline-offset-4`}>Close {view}</button></header>
  {error?<div role="status"><p className="text-sm text-[var(--muted)]">Couldn’t load saved {view}.</p><button type="button" className={`${actionStyles.action} min-h-11 underline underline-offset-4`} onClick={()=>{setError(false);setAttempt(value=>value+1);}}>Try again</button></div>:!companies&&!people?<p role="status" className="text-sm text-[var(--muted)]">Loading saved {view}…</p>:null}
  {companies&&<CompaniesWorkspace mandates={[]} initial={companies} embedded learningEnabled={learningEnabled}/>}
  {people&&<div className="space-y-3"><label className="block text-sm">Search people<input type="search" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} className="mt-2 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3" placeholder="Name, company or role"/></label>
   <ul className="divide-y divide-[var(--border)]">{contacts!.slice((currentPage-1)*10,currentPage*10).map(person=><li key={person.id} className="py-3"><div className="flex flex-wrap items-baseline justify-between gap-1"><p className="text-sm font-medium">{person.name.trim()||'Unnamed person'}</p>{person.doNotContact&&<span className="text-xs text-[var(--muted)]">Do not contact</span>}</div><p className="mt-1 text-xs text-[var(--muted)]">{[person.role,person.company].filter(Boolean).join(' · ')}</p><details className="mt-1 text-xs"><summary className="min-h-9 w-fit cursor-pointer py-2">Saved contact details</summary><dl className="space-y-2 pb-2">{[['Email',person.email],['Phone',person.phone],['LinkedIn',person.linkedinUrl]].filter(([,value])=>value).map(([label,value])=><div key={label}><dt className="text-[var(--muted)]">{label}</dt><dd className="break-words">{value}</dd></div>)}{!person.email&&!person.phone&&!person.linkedinUrl&&<p>No contact details saved.</p>}</dl></details></li>)}</ul>
   {pages>1&&<nav aria-label="People pages" className="flex items-center justify-between gap-3"><button type="button" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)} className={`${actionStyles.action} min-h-11 underline underline-offset-4 disabled:opacity-40`}>Previous</button><span className="text-xs text-[var(--muted)]">Page {currentPage} of {pages} · {contacts!.length} people</span><button type="button" disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)} className={`${actionStyles.action} min-h-11 underline underline-offset-4 disabled:opacity-40`}>Next</button></nav>}
   {!contacts!.length&&<p className="text-sm text-[var(--muted)]">{people.contacts.some(person=>!person.fictionalised)?'No people match your search.':'No people saved yet.'}</p>}
  </div>}
 </section>;
}
