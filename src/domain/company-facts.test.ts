import { expect, it } from "vitest";
import { companyFactLinks, headcountModelFindings, observedCompanyFacts, parseHeadcount, validateCompanyFacts } from "./company-facts";
import { estimateEbitda } from "./estimated-ebitda";
import { validateFindings, type ResearchConfig, type SavedResearchFinding } from "./research";
const config: ResearchConfig = { purpose: "firmographics", companyName: "Example Instruments", companyDomain: "instruments.example.com", seeds: [], searchTerms: ["company size"], geography: "Australia", discover: false, approved: true, budget: { maxPages: 3, maxDomains: 3, maxModelCalls: 3, maxMinutes: 10 } };
const source = "https://au.linkedin.com/company/example-instruments";
const profile = "# Example Instruments\n299 followers\nWebsite\n[https://instruments.example.com](https://instruments.example.com)\nIndustry\nManufacturing\nCompany size\n11-50 employees\nHeadquarters\nMelbourne, VIC\nType\nPrivately Held\nFounded\n2011\n## Similar pages\nCompany size\n500 employees";
const saved = (text = profile): SavedResearchFinding[] => observedCompanyFacts(text, source, config).map((evidence, i) => ({ id: String(i), jobId: "job", targetId: "target", sourceUrl: source, observedAt: "2026-09-09T00:00:00Z", confidence: 0.5, evidence }));
it("reads labelled profile fields after matching the declared website, ignoring followers and other companies", () => {
  expect(observedCompanyFacts(profile, source, config).map(f => [f.kind, f.value])).toEqual([["headcount", "11-50 employees"], ["founded_year", "2011"], ["industry", "Manufacturing"], ["location", "Melbourne, VIC"]]);
  expect(observedCompanyFacts(profile.replaceAll("instruments.example.com", "different.example.com"), source, config)).toEqual([]);
  expect(observedCompanyFacts(profile, "https://directory.example.com/company/example", config)).toEqual([]);
});
it("requires both source semantics and a grounded AI headcount; revalidates callback data", () => {
  const accepted = headcountModelFindings({ value: "11-50", quote: "Company size 11-50 employees" }, profile, source, config);
  expect(accepted.some(f => f.kind === "headcount")).toBe(true);
  const wrong = headcountModelFindings({ value: "299", quote: "299 followers" }, profile, source, config);
  expect(wrong.some(f => f.kind === "headcount")).toBe(false);
  expect(headcountModelFindings({ value: null, quote: null }, profile, source, config).some(f => f.kind === "headcount")).toBe(false);
  expect(validateCompanyFacts(accepted.map(f => ({ ...f, value: "500 employees" })), profile, source, config)).toEqual([]);
});
it("does not derive founding years or headcounts from blog dates, case studies, or vague descriptions", () => {
  expect(observedCompanyFacts("We were founded in 2017. We have 50 employees.", "https://instruments.example.com/case-study/customer", config)).toEqual([]);
  expect(observedCompanyFacts("Family business. Our customer was founded in 1988. Published 2017.", "https://instruments.example.com/about", config)).toEqual([]);
  expect(observedCompanyFacts("We were founded in 2999.", "https://instruments.example.com/", config)).toEqual([]);
  expect(observedCompanyFacts("We employ over 50 employees.", "https://instruments.example.com/about", config)[0].value).toBe("over 50 employees");
});
it("preserves bounds and approximations and rejects malformed counts", () => {
  expect(parseHeadcount("over 50 employees")).toMatchObject({ min: 51, max: null });
  expect(parseHeadcount("under 10 staff")).toMatchObject({ min: null, max: 9 });
  expect(parseHeadcount("about 100 employees")).toMatchObject({ min: 100, max: 100, approximate: true });
  for (const value of ["50-11 employees", "Melbourne", "11 followers", "-2", "1000001", "2.5", "over 11-50"]) expect(parseHeadcount(value)).toBeNull();
});
it("uses matched ABS units and preserves an observed employee range", () => {
  const result = estimateEbitda(saved());
  expect(result).toMatchObject({ status: "estimated", currency: "AUD", low: Math.round(11 * 48730 * 1000 / 900.8), high: Math.round(50 * 48730 * 1000 / 900.8), benchmark: { period: "2024–25", cells: "B121, H121" } });
  expect(result.limitations.join(" ")).toContain("actual EBITDA may be negative");
});
it("abstains on missing, conflicting, unbounded counts and ambiguous industries", () => {
  expect(estimateEbitda([]).status).toBe("unavailable");
  expect(estimateEbitda(saved(profile.replace("11-50 employees", "50+ employees"))).status).toBe("unavailable");
  expect(estimateEbitda([...saved(), ...saved(profile.replace("11-50 employees", "51-200 employees"))]).reason).toContain("Conflicting");
  expect(estimateEbitda(saved(profile.replace("Manufacturing", "Wholesale"))).status).toBe("unavailable");
  expect(estimateEbitda(saved(profile.replace("Manufacturing", "Wholesale")), "other-goods-wholesale").status).toBe("estimated");
});
it("does not build an EBITDA scenario from a lone third-party headcount estimate", () => {
  const text = "# Example Instruments\nWebsite\n[www.instruments.example.com](//www.instruments.example.com)\n### Employees\n40";
  const facts = observedCompanyFacts(text, "https://www.datanyze.com/companies/example-instruments/123", config).map((evidence, i) => ({ id: String(i), jobId: "job", targetId: "target", sourceUrl: "https://www.datanyze.com/companies/example-instruments/123", observedAt: "2026-09-09T00:00:00Z", confidence: 0.3, evidence }));
  const result = estimateEbitda(facts, "manufacturing");
  expect(result.status).toBe("unavailable");
  expect(result.reason).toContain("third-party");
});
it("follows relevant own-company pages and public company profiles", () => {
  expect(companyFactLinks("[About](/about) [Team](https://au.linkedin.com/company/example-instruments) [News](/news) [Customer about](https://customer.example.com/about)", "https://instruments.example.com/", config, [])).toEqual(["https://instruments.example.com/about", source]);
});

it("prevents general business extraction from bypassing company-fact validation", () => {
  expect(validateFindings([{ kind: "headcount", name: "Headcount", value: "299", quote: "299 followers", website: "https://instruments.example.com/" }], "299 followers", "https://instruments.example.com/")).toEqual([]);
});

it("reads numeric directory fields only after matching the website and preserves unknown currency", () => {
  const text = "# Example Instruments\nWebsite\n[www.instruments.example.com ![](icon.svg)](//www.instruments.example.com)\n### ![](icon.svg) Revenue\n$190 K\n### ![](/) Employees\n2\n## Top Example Integrations\n### Employees\n900";
  const url = "https://www.datanyze.com/companies/example-instruments/123";
  const facts = observedCompanyFacts(text, url, config);
  expect(facts.map(f => [f.kind, f.value])).toEqual([["headcount", "2"], ["revenue", "$190 K"]]);
  expect(facts[1].factMetadata).toMatchObject({ basis: "third_party_estimate", currency: null, period: null, scope: "unspecified" });
  expect(validateCompanyFacts(facts, text, url, config)).toEqual(facts);
  expect(observedCompanyFacts(text.replaceAll("instruments.example.com", "other.example.com"), url, config)).toEqual([]);
  expect(observedCompanyFacts(text.replace("### ![](icon.svg) Revenue", "Product price"), url, config).some(f => f.kind === "revenue")).toBe(false);
});
it("keeps company group statements separate from numeric scope and captures published company inboxes", () => {
  const text = "Our trusted brands Alpha and Beta are now united under a new name: Example Group. Contact orders@instruments.example.com. We have 20 employees.";
  const facts = observedCompanyFacts(text, "https://instruments.example.com/", config);
  expect(facts.find(f => f.kind === "headcount")?.factMetadata?.scope).toBe("unspecified");
  expect(facts.find(f => f.kind === "company_relationship")?.factMetadata?.scope).toBe("group");
  expect(facts.find(f => f.kind === "company_contact")?.value).toBe("orders@instruments.example.com");
});
it("does not attach a group profile's headcount to a differently hosted trading brand", () => {
  expect(observedCompanyFacts(profile.replaceAll("instruments.example.com","group.example.com"), source, config)).toEqual([]);
});
it("does not mistake a customer's group or a product description for the target's group", () => {
  const text = "Our customer is part of the Example Group. Our sensors are part of the Precision Range.";
  expect(observedCompanyFacts(text, "https://instruments.example.com/", config).filter(f => f.kind === "company_relationship")).toEqual([]);
  expect(observedCompanyFacts("Example Instruments is a subsidiary of Example Holdings.", "https://instruments.example.com/", config).some(f => f.kind === "company_relationship")).toBe(true);
});
