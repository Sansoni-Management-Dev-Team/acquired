"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ResearchPanel, type ResearchPanelData } from "./research-panel";
import type { CompanyList } from "@/domain/company-list";
import { preloadDiscoveredCompanies } from "./company-discovery-handoff";

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
  const targetsHref = `/mandates/${mandateId}?tab=targets`;
  useEffect(() => {
    router.prefetch(targetsHref);
  }, [router, targetsHref]);
  const onResults = useCallback(async (data: ResearchPanelData) => {
    const ids = firstBatchCompanyIds(data, startedJobId);
    if (!ids.length || checking.current || navigated.current) return;
    checking.current = true;
    try {
      const response = await fetch(`/api/mandates/${mandateId}/companies`, { cache: "no-store" });
      if (!response.ok) return;
      const companies = await response.json() as CompanyList;
      if (!companies.rows.some(company => ids.includes(company.id))) {
        // A repeat search's first company may rank outside the first page.
        const workspaceResponse = await fetch(`/api/mandates/${mandateId}`, { cache: "no-store" });
        if (!workspaceResponse.ok) return;
        const workspace = await workspaceResponse.json() as { memberships: { target: { id: string } }[] };
        if (!workspace.memberships.some(member => ids.includes(member.target.id))) return;
      }
      preloadDiscoveredCompanies(companies);
      navigated.current = true;
      router.push(targetsHref);
    } catch { /* Retry on the next research update. */ }
    finally { checking.current = false; }
  }, [mandateId, startedJobId, router, targetsHref]);

  return <ResearchPanel mandateId={mandateId} showStartAction={false} onResultsChanged={onResults} />;
}
