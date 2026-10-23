"use client";
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { ResearchJob } from './research-panel';
import { companyResearchProgressState, isCompanyPipeline, type CompanyResearchCoverage } from './company-pipeline-state';

export function CompanyPipelineProgress({ job, jobs = [], mandateId, detail: startupDetail, coverage, peopleSaved }: { job?: ResearchJob; jobs?: ResearchJob[]; mandateId?: string; detail?: string; coverage?: CompanyResearchCoverage; peopleSaved?: number }) {
  const state = job ? companyResearchProgressState(job, jobs, { coverage, peopleSaved }) : {
    settled: false, discovered: 0, processed: 0, active: 0, headcounts: 0, revenueBands: 0,
    abns: 0, peopleSaved: 0, peopleActive: 0, peopleQueued: 0, backgroundActive: 0, backgroundQueued: 0, savedIds: [],
  };
  // A failed/cancelled root stops foreground discovery even when a child has
  // not recorded its final outcome. Keep those child facts visible below.
  const stopped = job?.status === 'failed' || job?.status === 'cancelled';
  const running = !stopped && !state.settled;
  const [startedAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const end = !running && job ? new Date(job.updatedAt || job.createdAt).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - (job ? new Date(job.createdAt).getTime() : startedAt)) / 1000));
  const complete = state.settled && job?.status === 'complete';
  const researching = state.processed > 0 || state.active > 0;
  const continuation = Boolean(job?.config.companyContinuation);
  const discoveredLabel = `${state.discovered} ${state.discovered === 1 ? 'business' : 'businesses'} ${continuation ? 'selected' : 'found'}`;
  const includePeople = !job || (isCompanyPipeline(job) ? job.config.includeCompanyPeople : job.config.findPeople !== false);
  const title = running ? 'Finding businesses' : complete ? 'Research complete' : job?.status === 'partial' ? 'Finished with issues' : `Research ${job?.status}`;
  const detail = startupDetail || (running ? job?.message?.startsWith('Waiting for Firmable') ? job.message : researching ? 'Finding headcounts, revenue bands, ABNs, people and email addresses for the businesses we discover.' : 'Searching for businesses that match your acquisition brief.' : complete ? 'Company research finished. Your results are ready to review.' : job?.message || 'Research has stopped. Review the available results and any missing information.');
  const stages = [
    { label: continuation ? 'Saved businesses selected' : 'Searching for businesses', count: state.discovered, active: running },
    { label: 'Finding headcounts', count: state.headcounts, active: running && researching },
    { label: 'Finding revenue bands', count: state.revenueBands, active: running && researching },
    { label: 'Verifying ABNs', count: state.abns, active: running && researching },
    ...(includePeople && running ? [{ label: 'Finding people and emails', count: state.peopleSaved, active: running && (state.peopleActive + state.peopleQueued > 0) }] : []),
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
    <div className="mt-[9px] flex flex-wrap justify-between gap-3 text-[10px] text-[#637592]"><span role="status" aria-live="polite">{complete ? '100% · ' : running ? 'In progress · ' : ''}{discoveredLabel}</span><span>{state.processed} {state.processed === 1 ? 'company' : 'companies'} researched</span></div>
    <ol className="mx-auto mt-[23px] grid max-w-[350px] gap-[10px] text-left">
      {stages.map(({ label, count, active }, index) => <li key={label} className={`flex items-center gap-[9px] text-[11px] ${complete ? 'text-[#2c7958]' : active ? 'font-bold text-[#4541cf]' : 'text-[#8593aa]'}`}>
        <span aria-hidden="true" className={`flex size-[19px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${complete ? 'bg-[#e5f4eb]' : active ? 'bg-[#e6e5ff]' : 'bg-[#eceff5]'}`}>{complete ? <Check size={12} /> : index + 1}</span>
        <span>{label}</span>{count !== undefined && <span className="ml-auto text-[#637592]">{count} {label === 'Saving company results' ? 'saved' : label === 'Saved businesses selected' ? 'selected' : 'found'}</span>}
      </li>)}
    </ol>
    {stopped && state.active > 0 && <p className="mt-5 text-[11px] text-[#637592]">{state.active} company {state.active === 1 ? 'request is' : 'requests are'} still recorded as in progress.</p>}
    {state.settled && state.peopleActive + state.peopleQueued > 0 && <p className="mt-5 text-[11px] text-[#637592]">Finding people and emails: continuing in the background.</p>}
    {state.settled && state.backgroundActive + state.backgroundQueued > 0 && <p className="mt-3 text-[11px] text-[#637592]">Company details continue updating in the background.</p>}
    <p className="mt-6 text-[11px] text-[#637592]">{state.savedIds.length} {state.savedIds.length === 1 ? 'company' : 'companies'} saved · {Math.floor(seconds / 60)}m {seconds % 60}s{running ? ' so far' : ' elapsed'}</p>
    {!running && mandateId && state.savedIds.length > 0 && <a href={`/mandates/${mandateId}?tab=targets`} className="mt-5 inline-block rounded-md bg-[#3732a0] px-4 py-3 text-sm font-semibold text-white">View companies</a>}
  </section>;
}
