"use client";
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { ResearchJob } from './research-panel';
import { companyPipelineState } from './company-pipeline-state';

export function CompanyPipelineProgress({ job, jobs, mandateId }: { job: ResearchJob; jobs: ResearchJob[]; mandateId?: string }) {
  const state = companyPipelineState(job, jobs);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (state.settled) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.settled]);
  const end = state.settled ? new Date(job.updatedAt || job.createdAt).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - new Date(job.createdAt).getTime()) / 1000));
  const complete = state.settled && job.status === 'complete';
  const running = !state.settled;
  const researching = state.processed > 0 || state.active > 0;
  const title = running ? 'Finding businesses' : complete ? 'Research complete' : job.status === 'partial' ? 'Finished with issues' : `Research ${job.status}`;
  const detail = running ? researching ? 'Finding headcounts, revenue bands, ABNs, people and email addresses for the businesses we discover.' : 'Searching for businesses that match your acquisition brief.' : complete ? 'Company research finished. Your results are ready to review.' : 'Research has stopped. Review the available results and any missing information.';
  const stages = [
    { label: 'Searching for businesses', count: undefined, active: running },
    { label: 'Finding headcounts', count: state.headcounts, active: running && researching },
    { label: 'Finding revenue bands', count: state.revenueBands, active: running && researching },
    { label: 'Verifying ABNs', count: state.abns, active: running && researching },
    ...(job.config.includeCompanyPeople ? [{ label: 'Finding people and emails', count: state.peopleSaved, active: running && (state.peopleActive + state.peopleQueued > 0) }] : []),
    { label: 'Saving company results', count: state.savedIds.length, active: running && researching },
  ];
  return <section className="mx-auto my-8 max-w-3xl rounded-[10px] border border-[#d8deeb] bg-white px-5 py-10 text-center text-[#20252f] sm:px-9">
    {running ? <div aria-hidden="true" className="mx-auto mb-[18px] size-[31px] animate-spin rounded-full border-[3px] border-[#e2e3fb] border-t-[#3732a0] motion-reduce:animate-none" /> : <div aria-hidden="true" className="mx-auto mb-[18px] flex size-[31px] items-center justify-center rounded-full bg-[#e5f4eb] text-[#2c7958]">{complete ? <Check size={18} /> : <span>!</span>}</div>}
    <p className="text-[10px] font-extrabold tracking-[.1em] text-[#7d8aa0]">{running ? 'SEARCHING' : complete ? 'RESEARCH COMPLETE' : 'RESEARCH STOPPED'}</p>
    <h2 className="mt-2 text-[22px] font-bold leading-tight tracking-[-.04em]">{title}</h2>
    <p role="status" aria-live="polite" className="mt-[7px] text-[11px] text-[#637592]">{detail}</p>
    {/* Discovery keeps adding companies, so an active run has no fixed denominator. */}
    <div role="progressbar" aria-label="Company research progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={complete ? 100 : undefined} aria-valuetext={complete ? 'Research complete' : running ? 'Company research in progress' : title} className="mt-[22px] h-2 overflow-hidden rounded-full bg-[#e9ebf4]">
      <div className={`h-full bg-[#3732a0] ${running ? 'animate-pulse motion-reduce:animate-none' : ''}`} style={{ width: complete ? '100%' : researching ? '70%' : '30%' }} />
    </div>
    <div className="mt-[9px] flex justify-between gap-3 text-[10px] text-[#637592]"><span>{complete ? '100%' : running ? 'In progress' : title}</span><span>{state.processed} companies researched</span></div>
    <ol className="mx-auto mt-[23px] grid max-w-[350px] gap-[10px] text-left">
      {stages.map(({ label, count, active }, index) => <li key={label} className={`flex items-center gap-[9px] text-[11px] ${complete ? 'text-[#2c7958]' : active ? 'font-bold text-[#4541cf]' : 'text-[#8593aa]'}`}>
        <span aria-hidden="true" className={`flex size-[19px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${complete ? 'bg-[#e5f4eb]' : active ? 'bg-[#e6e5ff]' : 'bg-[#eceff5]'}`}>{complete ? <Check size={12} /> : index + 1}</span>
        <span>{label}</span>{count !== undefined && <span className="ml-auto text-[#637592]">{count} {label === 'Saving company results' ? 'saved' : 'found'}</span>}
      </li>)}
    </ol>
    <p className="mt-6 text-[11px] text-[#637592]">{state.savedIds.length} {state.savedIds.length === 1 ? 'company' : 'companies'} saved · {Math.floor(seconds / 60)}m {seconds % 60}s{state.settled ? ' elapsed' : ' so far'}</p>
    {state.settled && mandateId && state.savedIds.length > 0 && <a href={`/mandates/${mandateId}?tab=targets`} className="mt-5 inline-block rounded-md bg-[#3732a0] px-4 py-3 text-sm font-semibold text-white">View companies</a>}
  </section>;
}
