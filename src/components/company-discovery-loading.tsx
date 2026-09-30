"use client";

import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { ResearchPanel, type ResearchPanelData } from "./research-panel";

// Only saved companies from this search unlock Targets; queued website leads
// and companies belonging to an earlier search do not count as a first batch.
export function firstBatchCompanyIds(data: ResearchPanelData, startedJobId?: string) {
  const root = startedJobId ? data.jobs.find(job => job.id === startedJobId) : data.jobs.find(job => !job.config.discoveryCandidate && !job.config.purpose);
  if (!root) return [];
  const runId = root.config.researchRunId || root.id;
  return [...new Set(data.jobs.filter(job => job.id === runId || job.config.researchRunId === runId || job.config.parentJobId === runId).flatMap(job => job.config.newBusinessIds || []))];
}

export function CompanyDiscoveryLoading({ mandateId, startedJobId }: { mandateId: string; startedJobId?: string }) {
  const router = useRouter();
  const checking = useRef(false);
  const navigated = useRef(false);
  const onResults = useCallback(async (data: ResearchPanelData) => {
    const ids = firstBatchCompanyIds(data, startedJobId);
    if (!ids.length || checking.current || navigated.current) return;
    checking.current = true;
    try {
      const response = await fetch(`/api/mandates/${mandateId}`, { cache: "no-store" });
      if (!response.ok) return;
      const workspace = await response.json() as { memberships: { target: { id: string } }[] };
      if (!workspace.memberships.some(member => ids.includes(member.target.id))) return;
      navigated.current = true;
      router.push(`/mandates/${mandateId}?tab=targets`);
      router.refresh();
    } catch { /* Retry on the next research update. */ }
    finally { checking.current = false; }
  }, [mandateId, startedJobId, router]);

  return <ResearchPanel mandateId={mandateId} showStartAction={false} onResultsChanged={onResults} />;
}
