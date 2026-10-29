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

  function root(overrides: Partial<ResearchJob> = {}): ResearchJob {
    return job({ id: "root", config: { ...job().config, discoveryCandidate: false, discover: true, mode: "automatic", findPeople: true }, ...overrides });
  }
  function child(overrides: Partial<ResearchJob> = {}): ResearchJob {
    return job({ config: { ...job().config, researchRunId: "root" }, ...overrides });
  }

  it.each(["queued", "discovering", "crawling", "reading", "extracting"])("keeps web research on the new layout during %s", status => {
    const current = root({ status });
    const html = renderToStaticMarkup(<ResearchProgress job={current} jobs={[current, child()]} count={0} identified={0} active enriching={0} />);
    for (const label of ["Searching for businesses", "Finding headcounts", "Finding revenue bands", "Finding ABNs", "Finding people and emails", "Saving company results"]) expect(html).toContain(label);
    expect(html).toContain("In progress");
    expect(html).not.toContain("aria-valuenow");
    expect(html).not.toContain("Stage 1 of 4");
    expect(html).not.toContain("Find candidates");
  });

  it("uses saved web results and evidence coverage for its counters", () => {
    const current = root();
    const saved = child({ status: "complete", config: { ...child().config, newBusinessIds: ["saved-1", "saved-2"] } });
    const old = child({ id: "old", config: { ...child().config, researchRunId: "old-run", newBusinessIds: ["older"] } });
    const html = renderToStaticMarkup(<ResearchProgress job={current} jobs={[current, saved, saved, old]} count={2} identified={3} active enriching={0} coverage={{ size: 2, revenue: 1, abn: 1 }} peopleSaved={3} />);
    expect(html).toContain("1 company researched");
    expect(html).toContain("2 companies saved");
    expect(html).toMatch(/Finding headcounts[\s\S]*?2 found/);
    expect(html).toMatch(/Finding revenue bands[\s\S]*?1 found/);
    expect(html).toMatch(/Finding ABNs[\s\S]*?1 found/);
    expect(html).toMatch(/Finding people and emails[\s\S]*?3 saved/);
    expect(html).not.toContain("100%");
  });

  it("waits for candidate research after discovery finishes", () => {
    const current = root({ status: "complete" });
    const html = renderToStaticMarkup(<ResearchProgress job={current} jobs={[current, child()]} count={0} identified={0} active enriching={0} />);
    expect(html).toContain("In progress");
    expect(html).not.toContain('aria-valuenow="100"');
  });

  it("keeps the overall indicator running while linked people research continues", () => {
    const current = root({ status: "complete" });
    const people = child({ config: { ...child().config, discoveryCandidate: false, purpose: "people" } });
    const html = renderToStaticMarkup(<ResearchProgress job={current} jobs={[current, people]} count={0} identified={0} active enriching={1} />);
    expect(html).toContain("Finding people and emails");
    expect(html).toContain("running");
    expect(html).not.toContain('aria-valuenow="100"');
  });

  it.each([0, 7, 20, 25])("completes with %s saved businesses", count => {
    const completed = root({ status: "complete", config: { ...root().config, newBusinessIds: Array.from({ length: count }, (_, index) => `saved-${index}`) } });
    const html = renderToStaticMarkup(<ResearchProgress job={completed} count={count} identified={31} active={false} enriching={0} />);
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain(`${count} ${count === 1 ? "company" : "companies"} saved`);
  });

  it.each(["failed", "partial", "cancelled"])("does not mark a %s job complete", status => {
    const html = renderToStaticMarkup(<ResearchProgress job={root({ status })} count={0} identified={0} active={false} enriching={0} />);
    expect(html).not.toContain('aria-valuenow="100"');
    expect(html).toContain(status === "partial" ? "Finished with issues" : `Research ${status}`);
  });

  it("preserves the dedicated progress display for targeted people research", () => {
    const people = job({ config: { ...job().config, purpose: "people" } });
    const html = renderToStaticMarkup(<ResearchProgress job={people} count={0} identified={0} active enriching={1} />);
    expect(html).toContain("Finding decision-makers");
    expect(html).toContain("Find decision-makers");
    expect(html).toContain('aria-valuenow="80"');
  });
});
