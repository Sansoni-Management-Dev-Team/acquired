import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { EbitdaEstimatePanel } from "./ebitda-estimate-panel";
import type { SavedResearchFinding } from "@/domain/research";
const findings: SavedResearchFinding[] = [
  { id: "count", jobId: "job", targetId: "target", sourceUrl: "https://example.com", observedAt: "2026-09-15T00:00:00Z", confidence: 0.5, evidence: { kind: "headcount", name: "Headcount", value: "30 employees", quote: "We employ 30 employees.", website: "https://example.com" } },
  { id: "industry", jobId: "job", targetId: "target", sourceUrl: "https://example.com", observedAt: "2026-09-15T00:00:00Z", confidence: 0.5, evidence: { kind: "industry", name: "Industry", value: "Manufacturing", quote: "We work in manufacturing.", website: "https://example.com" } },
];
it("shows the financial range, comparison cohort, source and assumptions", () => {
  const html = renderToStaticMarkup(<EbitdaEstimatePanel findings={findings} />);
  expect(html).toContain("Estimated annual EBITDA range");
  expect(html).toContain("$1,600,478 – $1,665,842 AUD / year");
  expect(html).toContain("Manufacturing — 20–199 employees");
  expect(html).toContain("not reported earnings or a confidence interval");
  expect(html).toContain("81550DO001_202425.xlsx");
});
it("makes a broad fallback explicit and never fabricates missing headcount", () => {
  const fallback = renderToStaticMarkup(<EbitdaEstimatePanel findings={findings.slice(0, 1)} />);
  expect(fallback).toContain("Industry match unconfirmed");
  const empty = renderToStaticMarkup(<EbitdaEstimatePanel findings={[]} />);
  expect(empty).toContain("No sourced headcount available");
  expect(empty).not.toContain("AUD / year");
});

it("labels EBITDA generated from estimated headcount next to the result", () => {
  const estimated = findings.map(f => f.evidence.kind === "headcount" ? { ...f, evidence: { ...f.evidence, factMetadata: { basis: "search_snippet" as const, sourceKind: "third_party_directory" as const, identityNote: null, scope: "unspecified" as const, period: null, currency: null } } } : f);
  const html = renderToStaticMarkup(<EbitdaEstimatePanel findings={estimated} />);
  expect(html).toContain("Based on estimated headcount");
  expect(html).toContain("$1,600,478 – $1,665,842 AUD / year");
});
