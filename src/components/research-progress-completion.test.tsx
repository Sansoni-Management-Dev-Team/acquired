import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { ResearchJob } from "./research-panel";
import { companyPipelineState } from "./company-pipeline-state";
import { CompanyPipelineProgress } from "./company-pipeline-progress";
const root = {
  id: "run",
  status: "complete",
  createdAt: "2026-10-27T00:00:00Z",
  updatedAt: "2026-10-27T00:07:00Z",
  config: { pipelineDesign: "hybrid-firmable-v1", includeCompanyPeople: true },
} as ResearchJob;
const company = {
  ...root,
  id: "profile",
  config: {
    ...root.config,
    researchRunId: "run",
    researchTask: "company",
    targetId: "saved",
    firmableProfile: { abn: "68006904052" },
    abnLookup: { status: "provider_reported" },
  },
} as unknown as ResearchJob;
const render = (job: ResearchJob, jobs: ResearchJob[]) =>
  renderToStaticMarkup(
    <CompanyPipelineProgress job={job} jobs={jobs} mandateId="mandate" />,
  );
it("keeps overall progress open while company details are queued and shows the actual queue", () => {
  const queued = {
    ...root,
    id: "details",
    status: "queued",
    config: {
      parentJobId: "run",
      purpose: "firmographics",
      companyBackgroundResearch: { version: 1, fields: ["team_members"] },
    },
  } as unknown as ResearchJob;
  expect(companyPipelineState(root, [root, company, queued]).settled).toBe(
    false,
  );
  const html = render(root, [root, company, queued]);
  expect(html).not.toContain("RESEARCH COMPLETE");
  expect(html).not.toContain('aria-valuenow="100"');
  expect(html).toContain("Company details");
  expect(html).toContain("1 queued");
  expect(html).toContain("View companies");
});
it("shows retained contacts and unattempted companies after the admission deadline instead of success", () => {
  const job = {
    ...root,
    config: {
      ...root.config,
      companyPeopleProgress: {
        total: 4,
        active: 0,
        queued: 0,
        complete: 1,
        failed: 0,
        cancelled: 3,
        found: 30,
        saved: 3,
        profilesFailed: 0,
        admissionIncomplete: 3,
        settled: true,
      },
    },
  } as ResearchJob;
  const html = render(job, [job, company]);
  expect(html).not.toContain("RESEARCH COMPLETE");
  expect(html).toContain("Finished with issues");
  expect(html).toContain("3 saved");
  expect(html).toContain("3 not started");
});
it("counts provider ABNs once per saved company and gives them precedence over fallback checks", () => {
  const registry = {
    ...company,
    id: "registry",
    config: {
      ...company.config,
      firmableProfile: null,
      abnLookup: { status: "matched", abn: "56663118241" },
    },
  } as ResearchJob;
  const state = companyPipelineState(root, [root, company, company, registry]);
  expect(state.abns).toBe(1);
  const html = render(root, [root, company, registry]);
  expect(html).toContain("Finding ABNs");
  expect(html).toContain("1 found");
  expect(html).not.toContain("Verifying ABNs");
});
it("does not turn settled partial company details into overall success", () => {
  const partial = {
    ...root,
    id: "details",
    status: "partial",
    config: {
      parentJobId: "run",
      purpose: "firmographics",
      companyBackgroundResearch: { version: 1, fields: ["team_members"] },
    },
  } as unknown as ResearchJob;
  const html = render(root, [root, company, partial]);
  expect(html).toContain("Finished with issues");
  expect(html).not.toContain("RESEARCH COMPLETE");
  expect(html).toContain("1 incomplete");
});
it("shows an expired queue as incomplete rather than an endless loading state", () => {
  const expired = {
    ...root,
    config: { ...root.config, automaticDeadline: Date.now() - 1000 },
  };
  const queued = {
    ...company,
    id: "pending-profile",
    status: "queued",
    config: { ...company.config, targetId: "pending" },
  } as ResearchJob;
  const html = render(expired, [expired, company, queued]);
  expect(html).toContain("Time limit reached");
  expect(html).not.toContain("RESEARCH COMPLETE");
  expect(html).not.toContain("animate-spin");
});
it("only claims complete when company, people and detail work all finish successfully", () => {
  const job = {
    ...root,
    config: {
      ...root.config,
      companyPeopleProgress: {
        total: 1,
        active: 0,
        queued: 0,
        complete: 1,
        failed: 0,
        cancelled: 0,
        found: 3,
        saved: 3,
        profilesFailed: 0,
        settled: true,
      },
    },
  } as ResearchJob;
  const html = render(job, [job, company]);
  expect(html).toContain("RESEARCH COMPLETE");
  expect(html).toContain('aria-valuenow="100"');
  expect(html).toContain("Finding people and emails");
});
it('keeps provider branding out of ABN counts and waiting messages',()=>{
 const waiting={...root,status:'extracting',message:'Waiting for Firmable rate limit to clear.'}as ResearchJob;
 const html=render(waiting,[waiting,company]);expect(html).not.toMatch(/firmable/i);expect(html).toContain('from company data');expect(html).toContain('Waiting for Company data rate limit to clear.');
});
