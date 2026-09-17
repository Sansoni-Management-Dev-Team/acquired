import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActiveResearchJob, type ResearchJob } from "./research-panel";

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
