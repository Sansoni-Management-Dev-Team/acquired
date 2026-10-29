"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { mandateCompaniesHref } from "@/domain/mandate-navigation";
import { ResearchPanel, type ResearchPanelData } from "./research-panel";
import { researchRoot, isCompanyPipeline, companyPipelineState, companyResearchProgressState } from "./company-pipeline-state";

export function companyDiscoveryComplete(data: ResearchPanelData, startedJobId?: string) {
  const root = researchRoot(data.jobs, startedJobId);
  if (!root) return false;
  const state=companyResearchProgressState(root,[...data.jobs,...(data.companyJobs||[]),...(data.peopleJobs||[])]);
  return root.status==='complete'&&state.settled&&!state.hasIssues;
}

// Saved records scoped to this run, excluding queued leads and earlier searches.
export function firstBatchCompanyIds(data: ResearchPanelData, startedJobId?: string) {
  const root = researchRoot(data.jobs, startedJobId);
  if (!root) return [];
  const jobs = [...data.jobs, ...(data.companyJobs || [])];
  if (isCompanyPipeline(root)) return companyPipelineState(root, jobs).savedIds;
  const runId = root.config.researchRunId || root.id;
  return [...new Set(jobs.filter(job => job.id === runId || job.config.researchRunId === runId || job.config.parentJobId === runId).flatMap(job => job.config.newBusinessIds || []))];
}

/** A stopped root may have persisted useful companies in parallel children.
 * Opening those records is not a completion or qualification claim; outstanding
 * enrichment and the saved failure remain visible in the normal workspace. */
export function companyDiscoveryHasRetainedResults(data: ResearchPanelData, startedJobId?: string) {
  const root = researchRoot(data.jobs, startedJobId);
  return Boolean(root && ['failed', 'partial'].includes(root.status) && firstBatchCompanyIds(data, startedJobId).length);
}

export function CompanyDiscoveryLoading({ mandateId, startedJobId }: { mandateId: string; startedJobId?: string }) {
  const [hasSavedCompanies, setHasSavedCompanies] = useState(false);
  const onResults = useCallback((data: ResearchPanelData) => {
    setHasSavedCompanies(firstBatchCompanyIds(data, startedJobId).length > 0);
  }, [startedJobId]);

  return <>
    <ResearchPanel mandateId={mandateId} startedRunId={startedJobId} showStartAction={false} showCompaniesLink={false} onResultsChanged={onResults} />
    {hasSavedCompanies && <div className="mb-8 text-center"><Link prefetch={false} href={mandateCompaniesHref(mandateId)} className="inline-flex min-h-11 items-center rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-[var(--on-accent)]">View companies</Link></div>}
  </>;
}
