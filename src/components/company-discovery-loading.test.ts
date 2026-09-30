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
