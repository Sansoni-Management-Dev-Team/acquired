import { expect, test } from "vitest";
import { normalizeCompany, profileSchema } from "./web-enrichment.mjs";
import { readFile } from "node:fs/promises";
import { normalizePilot } from "./web-enrichment.mjs";
const company = { id: "delta", name: "Delta Laboratories", domain: "deltalabs.com.au", website: "https://deltalabs.com.au", category: "cosmetics", state: "NSW" };
const run = (text, url = company.website) => normalizeCompany(company, [{ id: "doc", text, url }]);
test("preserves ranges, exclusive bounds and unknown scope", () => {
  const p = run("We have 11–50 employees. Another unit has <25 employees. We employ over 70 people.");
  expect(p.observations.filter((o) => o.field === "headcount").map((o) => o.value)).toMatchObject([
    { kind: "range", min: 11, max: 50, scope: "unknown" },
    { kind: "upper_bound", min: null, max: 25, maxInclusive: false },
    { kind: "lower_bound", min: 70, max: null, minInclusive: false },
  ]);
});
test("rejects salary samples, profile counts and ambiguous since dates", () => {
  expect(run("Salary estimated from 58 employees, users, and advertisements.").resolvedProfile.headcount).toBeNull();
  expect(run("View all 13 employees").resolvedProfile.headcount).toBeNull();
  expect(run("Owners have operated since 1986.").resolvedProfile.foundedYear).toBeNull();
  expect(run("Established in 1995").resolvedProfile.foundedYear.value.min).toBe(1995);
});
test("rejects same-name foreign companies and domain lookalikes", () => {
  expect(run("Delta Laboratories is in Venezuela with 11-50 employees.", "https://zoominfo.com/pic/delta-laboratories/123").resolvedProfile.headcount).toBeNull();
  expect(run("fakedeltalabs.com.au 20 employees", "https://unrelated.example").resolvedProfile.headcount).toBeNull();
});
test("does not guess currency, financial estimates or verification", () => {
  const p = run("We have $13.7 million in revenue and 90 employees.");
  expect(p.resolvedProfile.revenue.value).toMatchObject({ min: 13700000, currency: null });
  expect(p.estimates.ebitda).toBeNull();
  expect(p.resolvedProfile.headcount.verification).toBe("unverified");
  expect(profileSchema.safeParse(p).success).toBe(true);
});
test("deduplicates repeated claims and links every retrieval", () => {
  const p = normalizeCompany(company, ["a", "b"].map((id) => ({ id, url: company.website, text: "90 employees" })));
  expect(p.observations).toHaveLength(1);
  expect(p.observations[0].source.retrievalIds).toEqual(["a", "b"]);
});
test("keeps Australian employee claims separate from unspecified scope", () => {
  const p = run("We employ 20 people in Australia. We have 90 employees.");
  expect(p.resolvedProfile.headcountAU.value.min).toBe(20);
  expect(p.resolvedProfile.headcount.value.min).toBe(90);
});
test("repairs the saved pilot without accepting the audited false positives", async () => {
  let raw;
  try { raw = JSON.parse(await readFile(".local-data/manufacturer-web-enrichment-pilot.v1.json", "utf8")); }
  catch (e) { if (e.code === "ENOENT") return; throw e; }
  const p = normalizePilot(raw);
  const byDomain = Object.fromEntries(p.results.map((r) => [r.identity.domain, r]));
  expect(byDomain["rootech.com.au"].resolvedProfile.headcount).toBeNull();
  for (const domain of ["mansfields.com.au", "novaplas.com.au", "rootech.com.au"]) expect(byDomain[domain].resolvedProfile.foundedYear).toBeNull();
  const delta = byDomain["deltalabs.com.au"];
  expect(delta.resolvedProfile.revenue.value.currency).toBeNull();
  expect(delta.observations.find((o) => o.source.url.includes("indeed.com") && o.field === "headcount").status).toBe("rejected");
  const retrievalIds = new Set(p.retrievals.map((r) => r.id));
  expect(p.results.flatMap((r) => r.observations).every((o) => o.source.retrievalIds.every((key) => retrievalIds.has(key)))).toBe(true);
});
