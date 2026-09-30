import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CompanySearchProgress } from "./company-search-progress";
import { ActiveResearchJob, candidatesArrivedForRun, DiscoveryCandidateList, ResearchProgress, type ResearchJob } from "./research-panel";

function job(overrides: Partial<ResearchJob> = {}): ResearchJob {
  return {
    id: "candidate-1",
    status: "crawling",
    pages: 0,
    modelCalls: 0,
    message: "Waiting for browser slot",
    createdAt: new Date(0).toISOString(),
    config: {
      discoveryCandidate: true,
      companyDomain: "example.com",
      seeds: ["https://example.com/about"],
      searchTerms: ["industrial supplier"],
      geography: "Australia",
      discover: false,
      approved: true,
      budget: { maxPages: 2, maxDomains: 1, maxMinutes: 15, maxModelCalls: 2 },
    },
    seeds: ["https://example.com/about"],
    ...overrides,
  };
}

describe("active research job", () => {
  it("shows a discovered candidate URL before the business has been identified", () => {
    const html = renderToStaticMarkup(<ActiveResearchJob job={job()} busy={false} onCancel={vi.fn()} onRetry={vi.fn()} />);

    expect(html).toContain('href="https://example.com/about"');
    expect(html).toContain("https://example.com/about");
    expect(html).toContain("Researching candidate website");
    expect(html).not.toContain("Research · Company research");
  });

  it("falls back to the known company domain when a job has no seed URL", () => {
    const html = renderToStaticMarkup(<ActiveResearchJob job={job({ seeds: [] })} busy={false} onCancel={vi.fn()} onRetry={vi.fn()} />);

    expect(html).toContain('href="https://example.com/"');
  });
});

describe("discovery candidate list", () => {
  it("opens Targets only when a candidate belongs to the research run just started", () => {
    const root = job({ id: "new-run", config: { ...job().config, discoveryCandidate: false, researchRunId: "new-run" } });
    const older = job({ id: "old-candidate", config: { ...job().config, researchRunId: "old-run" } });
    const incoming = job({ id: "new-candidate", config: { ...job().config, researchRunId: "new-run", parentJobId: "new-run" } });
    expect(candidatesArrivedForRun([root, older], "new-run")).toBe(false);
    expect(candidatesArrivedForRun([root, older, incoming], "new-run")).toBe(true);
  });

  it("shows compact stages for the websites currently being checked", () => {
    const html = renderToStaticMarkup(<DiscoveryCandidateList searching jobs={[
      job({ id: "queued", status: "queued", config: { ...job().config, companyDomain: "queued.example" }, seeds: ["https://queued.example/"] }),
      job({ id: "reading", status: "reading", config: { ...job().config, companyDomain: "reading.example" }, seeds: ["https://reading.example/"] }),
      job({ id: "saved", status: "complete", config: { ...job().config, companyDomain: "saved.example", newBusinessIds: ["target-1"] }, seeds: ["https://saved.example/"] }),
    ]} />);

    expect(html).toContain("queued.example");
    expect(html).toContain("Queued");
    expect(html).toContain("Reading website");
    expect(html).toContain("1 queued · 1 reading");
    expect(html).not.toContain("saved.example");
    expect(html).not.toContain("0 extracting");
  });

  it("explains the empty state while discovery searches continue", () => {
    expect(renderToStaticMarkup(<DiscoveryCandidateList searching jobs={[]} />)).toContain("Finding websites…");
  });

  it("keeps finished websites out of the activity list", () => {
    const saved = job({ id: "saved", status: "complete", config: { ...job().config, companyDomain: "saved.example", newBusinessIds: ["target-1"] }, seeds: ["https://saved.example/"] });
    const later = Array.from({ length: 5 }, (_, index) => job({ id: `later-${index}`, status: "partial", config: { ...job().config, companyDomain: `later-${index}.example` }, seeds: [`https://later-${index}.example/`] }));
    const html = renderToStaticMarkup(<DiscoveryCandidateList searching={false} jobs={[saved, ...later]} />);

    expect(html).toContain("Results in Companies");
    expect(html).toContain("<details");
    expect(html).not.toContain("0 queued");
    expect(html).not.toContain("saved.example");
    expect(html).not.toContain("later-0.example");
  });
});

describe("research job progress", () => {
  it("shows the initial search card before a research job exists", () => {
    const html = renderToStaticMarkup(<CompanySearchProgress />);
    expect(html).toContain("Finding businesses");
    expect(html).toContain('aria-valuenow="20"');
    expect(html).toMatch(/aria-current="step"[^<]*>[\s\S]*?Find candidates/);
    expect(html).not.toContain("Completed:");
  });

  it("keeps discovery active while candidate research overlaps", () => {
    const root = job({ status: "discovering", config: { ...job().config, discoveryCandidate: false } });
    const html = renderToStaticMarkup(<ResearchProgress job={root} jobs={[root, job({ status: "extracting" })]} count={0} identified={0} active enriching={0} />);
    expect(html).toContain('aria-valuenow="20"');
    expect(html).toContain("Stage 1 of 4");
  });
  it("fills the bar for a finished run below its goal without the removed counters", () => {
    const completed = job({ status: "complete", config: { ...job().config, discoveryCandidate: false, targetBusinesses: 20 } });
    const html = renderToStaticMarkup(<ResearchProgress job={completed} count={7} identified={31} active={false} enriching={0} />);

    expect(html).not.toContain("new businesses saved");
    expect(html).toContain("100%");
    expect(html).not.toContain("businesses identified");
    expect(html).not.toContain("No research is running");
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('width:100%');
  });

  it.each([
    ["queued", "Find candidates", 20],
    ["discovering", "Find candidates", 20],
    ["crawling", "Validate company identity", 40],
    ["reading", "Validate company identity", 40],
    ["extracting", "Remove duplicates and non-companies", 60],
  ])("shows the %s stage independently of the saved count", (status, label, percentage) => {
    const current = job({ status, config: { ...job().config, discoveryCandidate: false, targetBusinesses: 20 } });
    const html = renderToStaticMarkup(<ResearchProgress job={current} count={20} identified={31} active enriching={0} />);

    expect(html).toContain(label);
    expect(html).toContain(`aria-valuenow="${percentage}"`);
    expect(html).toContain("Stage");
    expect(html).not.toContain("100%");
  });

  it("waits for candidate research after discovery finishes", () => {
    const root = job({ status: "complete", config: { ...job().config, discoveryCandidate: false, targetBusinesses: 20 } });
    const html = renderToStaticMarkup(<ResearchProgress job={root} jobs={[root, job()]} count={7} identified={31} active enriching={0} />);

    expect(html).toContain("Validate company identity");
    expect(html).toContain('aria-valuenow="40"');
  });

  it("keeps enrichment in progress after the discovery job completes", () => {
    const completed = job({ status: "complete" });
    const html = renderToStaticMarkup(<ResearchProgress job={completed} count={7} identified={31} active enriching={1} />);

    expect(html).toContain("Rank for fit");
    expect(html).toContain("Stage 4 of 4");
    expect(html).toContain('aria-valuenow="80"');
  });

  it.each([0, 7, 20, 25])("completes with %s saved businesses", count => {
    const completed = job({ status: "complete", config: { ...job().config, discoveryCandidate: false, targetBusinesses: 20 } });
    expect(renderToStaticMarkup(<ResearchProgress job={completed} count={count} identified={31} active={false} enriching={0} />)).toContain('aria-valuenow="100"');
  });

  it("completes research without a business target", () => {
    expect(renderToStaticMarkup(<ResearchProgress job={job({ status: "complete" })} count={0} identified={0} active={false} enriching={0} />)).toContain('aria-valuenow="100"');
  });

  it.each(["failed", "partial", "cancelled"])("does not mark a %s job complete", status => {
    const html = renderToStaticMarkup(<ResearchProgress job={job({ status, pages: 2, modelCalls: 1 })} count={20} identified={31} active={false} enriching={0} />);
    expect(html).not.toContain('aria-valuenow="100"');
    expect(html).toContain(status === "partial" ? "Research paused" : `Research ${status}`);
  });
});
