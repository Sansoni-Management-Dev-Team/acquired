import { expect, it } from "vitest";
import { firstBatchCompanyIds } from "./company-discovery-loading";
import type { ResearchJob, ResearchPanelData } from "./research-panel";

it("waits for saved companies from the new run rather than queued leads or previous results", () => {
  const root = { id: "new", config: { seeds: [] } } as unknown as ResearchJob;
  const candidate = { id: "candidate", status: "reading", config: { researchRunId: "new", discoveryCandidate: true, seeds: [] } } as unknown as ResearchJob;
  const older = { id: "older", config: { seeds: [], newBusinessIds: ["old-company"] } } as unknown as ResearchJob;
  const data = { jobs: [root, candidate, older], findings: [], enabled: true } as ResearchPanelData;
  expect(firstBatchCompanyIds(data, "new")).toEqual([]);
  expect(firstBatchCompanyIds({ ...data, jobs: [root, { ...candidate, config: { ...candidate.config, newBusinessIds: ["first-company"] } }, older] }, "new")).toEqual(["first-company"]);
});

it('does not mark a run complete when settled company details finished with issues',async()=>{
 const {companyDiscoveryComplete}=await import('./company-discovery-loading');
 const root={id:'root',status:'complete',createdAt:'2026-10-27',config:{pipelineDesign:'hybrid-firmable-v1',parallelResearchSettled:true}}as unknown as ResearchJob;
 const child={...root,id:'background',status:'partial',config:{parentJobId:'root',purpose:'firmographics',companyBackgroundResearch:{version:1}}}as unknown as ResearchJob;
 expect(companyDiscoveryComplete({jobs:[root],companyJobs:[child]}as ResearchPanelData)).toBe(false);
});
