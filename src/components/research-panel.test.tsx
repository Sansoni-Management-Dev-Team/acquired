import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActiveResearchJob, candidatesArrivedForRun, DiscoveryCandidateList, type ResearchJob } from "./research-panel";

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
    expect(html).toContain("Found → Queued");
    expect(html).toContain("Found → Reading website");
    expect(html).toContain("3 found · 1 queued · 1 reading · 0 extracting · 1 saved");
    expect(html).not.toContain("saved.example");
  });

  it("explains the empty state while discovery searches continue", () => {
    expect(renderToStaticMarkup(<DiscoveryCandidateList searching jobs={[]} />)).toContain("Finding websites…");
  });

  it("keeps finished websites out of the activity list", () => {
    const saved = job({ id: "saved", status: "complete", config: { ...job().config, companyDomain: "saved.example", newBusinessIds: ["target-1"] }, seeds: ["https://saved.example/"] });
    const later = Array.from({ length: 5 }, (_, index) => job({ id: `later-${index}`, status: "partial", config: { ...job().config, companyDomain: `later-${index}.example` }, seeds: [`https://later-${index}.example/`] }));
    const html = renderToStaticMarkup(<DiscoveryCandidateList searching={false} jobs={[saved, ...later]} />);

    expect(html).toContain("See Companies for the businesses and candidate websites found");
    expect(html).not.toContain("saved.example");
    expect(html).not.toContain("later-0.example");
  });
});
