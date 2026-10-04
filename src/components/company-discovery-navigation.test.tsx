import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ResearchJob, ResearchPanelData } from "./research-panel";

const mocks = vi.hoisted(() => ({ push: vi.fn(), prefetch: vi.fn(), onResults: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, prefetch: mocks.prefetch }) }));
vi.mock("./research-panel", () => ({ ResearchPanel: ({ onResultsChanged }: { onResultsChanged: unknown }) => {
  mocks.onResults(onResultsChanged);
  return null;
} }));
import { CompanyDiscoveryLoading } from "./company-discovery-loading";

const root = { id: "new", status: "complete", config: { seeds: [] } } as unknown as ResearchJob;
const snapshot = (jobs: ResearchJob[] = [root]): ResearchPanelData => ({ enabled: true, active: false, jobs, findings: [] });
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); });
function observe() {
  renderToStaticMarkup(<CompanyDiscoveryLoading mandateId="mandate" startedJobId="new" />);
  return mocks.onResults.mock.calls[0][0] as (data: ResearchPanelData) => Promise<void>;
}

it("opens companies once when the search completes without new company IDs", async () => {
  const update = observe();
  await update(snapshot());
  await update(snapshot());
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/mandates/mandate?tab=targets");
  expect(fetch).not.toHaveBeenCalled();
});

it("waits for this run's company and people jobs to finish", async () => {
  const update = observe();
  const child = { ...root, id: "child", status: "reading", config: { ...root.config, researchRunId: "new", purpose: "firmographics" as const } };
  await update({ ...snapshot(), companyJobs: [child] });
  await update({ ...snapshot(), peopleJobs: [{ ...child, config: { ...child.config, purpose: "people" } }] });
  expect(mocks.push).not.toHaveBeenCalled();
  await update({ ...snapshot(), companyJobs: [{ ...child, status: "complete" }] });
  expect(mocks.push).toHaveBeenCalledOnce();
});

it("does not redirect for an older completed search or a stopped new search", async () => {
  const update = observe();
  await update(snapshot([{ ...root, id: "old" }]));
  for (const status of ["discovering", "failed", "partial", "cancelled"]) {
    await update(snapshot([{ ...root, status }]));
  }
  expect(mocks.push).not.toHaveBeenCalled();
});

it("keeps progress visible after companies are saved and opens results only on completion", async () => {
  const update = observe();
  await update(snapshot([{ ...root, status: "discovering", config: { ...root.config, newBusinessIds: ["company"] } }]));
  expect(mocks.push).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  await update(snapshot());
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/mandates/mandate?tab=targets");
});

it('opens results for a settled modern partial run, including when children precede the root', async () => {
  const modern = { ...root, status: 'partial', config: { ...root.config, pipelineDesign: 'hybrid-firmable-v1' as const, parallelResearchSettled: true } };
  const child = { ...root, id: 'child', config: { ...root.config, researchTask: 'company' as const, researchRunId: 'new' } };
  await observe()(snapshot([child, modern]));
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/mandates/mandate?tab=targets');
});
it('keeps modern progress visible while the overall run is still discovering', async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ rows: [{ id: 'company' }] }));
  const modern = { ...root, status: 'discovering', config: { ...root.config, pipelineDesign: 'hybrid-firmable-v1' as const } };
  const child = { ...root, id: 'child', config: { ...root.config, researchTask: 'company' as const, researchRunId: 'new', targetId: 'company' } };
  await observe()(snapshot([child, modern]));
  expect(mocks.push).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
