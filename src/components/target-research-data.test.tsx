import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TargetResearchData, TargetEbitdaData, groupTargetObservations } from "./target-research-data";
import type { SavedResearchFinding } from "@/domain/research";
const finding = (kind: "headcount" | "revenue" | "person", value: string): SavedResearchFinding => ({ id: value, jobId: "job", targetId: "target", sourceUrl: "https://example.com/team", observedAt: "2026-09-15T00:00:00Z", confidence: 0.2, evidence: { kind, name: kind === "person" ? "Alex Example" : kind, value, quote: "Company source statement", website: "https://example.com", factMetadata: { basis: "search_snippet", sourceKind: "third_party_directory", currency: null, scope: "unspecified", period: null, identityNote: null } } });
it("shows a saved headcount range even when provider fields are unknown", () => {
 const html = renderToStaticMarkup(<TargetResearchData kind="headcount" findings={[finding("headcount", "11–50 employees")]} fallback="Unknown" />);
 expect(html).toContain("11–50 employees"); expect(html).toContain("Search estimate — unverified"); expect(html).toContain('href="https://example.com/team"');
});
it("exposes conflicting counts while labelling the averaged EBITDA estimate", () => {
 const findings = [finding("headcount", "10"), finding("headcount", "30")];
 expect(renderToStaticMarkup(<TargetResearchData kind="headcount" findings={findings} fallback="Unknown" />)).toContain("Sources disagree");
 expect(renderToStaticMarkup(<TargetEbitdaData findings={findings} />)).toContain("Averaged headcount");
});
it("shows EBITDA separately without inventing revenue or currency", () => {
 const findings = [finding("headcount", "12")];
 expect(renderToStaticMarkup(<TargetEbitdaData findings={findings} />)).toContain("Estimated annual EBITDA");
 expect(renderToStaticMarkup(<TargetResearchData kind="revenue" findings={findings} fallback="Unknown" />)).toContain("Unknown");
 const html = renderToStaticMarkup(<TargetResearchData kind="revenue" findings={[finding("revenue", "$2.6 M")]} fallback="Unknown" />);
 expect(html).toContain("$2.6 M"); expect(html).toContain("Currency unknown"); expect(html).not.toContain("AUD");
});
it("displays researched people without requiring a CRM contact", () => {
 const html = renderToStaticMarkup(<TargetResearchData kind="person" findings={[finding("person", "General Manager")]} fallback="Unknown" />);
 expect(html).toContain("Alex Example — General Manager");
});

it("collapses repeated people across sources without losing roles or links", () => {
 const a = finding("person", "Director");
 const b = { ...a, id: "second", sourceUrl: "https://other.example.com/profile" };
 const manager = { ...a, id: "role", evidence: { ...a.evidence, value: "General Manager" } };
 const input = [a, a, b, manager];
 expect(groupTargetObservations(input, "person")).toHaveLength(1);
 expect(groupTargetObservations(input, "person")[0]).toHaveLength(3);
 const html = renderToStaticMarkup(<TargetResearchData kind="person" findings={input} fallback="Unknown" />);
 expect(html).toContain("1 person"); expect(html).toContain("General Manager");
 expect(html).toContain("https://other.example.com/profile");
 expect(html).not.toContain("<details open");
 expect(html.split("<details>")[0]).not.toContain("Published statement");
});
it("limits the collapsed preview for a company with many people", () => {
 const input = Array.from({ length: 30 }, (_, i) => ({ ...finding("person", "Director"), id: String(i), evidence: { ...finding("person", "Director").evidence, name: `Person ${i}` } }));
 const html = renderToStaticMarkup(<TargetResearchData kind="person" findings={input} fallback="Unknown" />);
 const preview = html.split("<details>")[0];
 expect(preview).toContain("30"); expect(preview).toContain("+28 more"); expect(preview).not.toContain("Person 2");
});
