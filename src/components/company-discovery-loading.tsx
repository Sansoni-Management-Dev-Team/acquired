"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ResearchPanel, type ResearchPanelData } from "./research-panel";
import { researchRoot, isCompanyPipeline, companyPipelineState } from "./company-pipeline-state";
import { terminalResearchStates } from "@/domain/research";

export function companyDiscoveryComplete(data: ResearchPanelData, startedJobId?: string) {
  const root = researchRoot(data.jobs, startedJobId);
  if (!root) return false;
  if (isCompanyPipeline(root) && root.config.parallelResearchSettled) return companyPipelineState(root, [...data.jobs, ...(data.companyJobs || []), ...(data.peopleJobs || [])]).settled;
  if (root.status !== "complete") return false;
  const runId = root.config.researchRunId || root.id;
  return [...data.jobs, ...(data.companyJobs || []), ...(data.peopleJobs || [])]
    .filter(job => job.id === root.id || job.id === runId || job.config.researchRunId === runId || job.config.parentJobId === runId)
    .every(job => terminalResearchStates.includes(job.status));
}

// Saved records scoped to this run, excluding queued leads and earlier searches.
export function firstBatchCompanyIds(data: ResearchPanelData, startedJobId?: string) {
  const root = researchRoot(data.jobs, startedJobId);
  if (!root) return [];
  if (isCompanyPipeline(root)) return companyPipelineState(root, [...data.jobs, ...(data.companyJobs || [])]).savedIds;
  const runId = root.config.researchRunId || root.id;
  return [...new Set(data.jobs.filter(job => job.id === runId || job.config.researchRunId === runId || job.config.parentJobId === runId).flatMap(job => job.config.newBusinessIds || []))];
}

export function CompanyDiscoveryLoading({ mandateId, startedJobId }: { mandateId: string; startedJobId?: string }) {
  const router = useRouter();
  const navigated = useRef(false);
  const targetsHref = `/mandates/${mandateId}?tab=targets`;
  useEffect(() => {
    router.prefetch(targetsHref);
  }, [router, targetsHref]);
  const onResults = useCallback(async (data: ResearchPanelData) => {
    if (navigated.current) return;
    // Completion must leave the loading screen even when no new companies were
    // saved. The companies page loads its own results and empty state.
    if (companyDiscoveryComplete(data, startedJobId)) {
      navigated.current = true;
      router.push(targetsHref);
      return;
    }
  }, [startedJobId, router, targetsHref]);

  return <ResearchPanel mandateId={mandateId} startedRunId={startedJobId} showStartAction={false} onResultsChanged={onResults} />;
}
