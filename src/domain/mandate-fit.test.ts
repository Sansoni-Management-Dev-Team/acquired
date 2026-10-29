import {mapFirmableProfile} from '@/adapters/firmable-company-mapper';
import { describe, expect, it } from "vitest";
import { criterion, emptyBrief, initialAssessment, briefToMandate } from "./acquisition";
import { reviewMandateFit } from "./mandate-fit";
import type { SavedResearchFinding } from "./research";
import { seedTargets } from "@/test/fixtures/scoring-targets";

const target = { ...seedTargets[0], state: "Unknown", sector: { ...seedTargets[0].sector, value: null }, headcount: { ...seedTargets[0].headcount, value: null }, revenue: { ...seedTargets[0].revenue, value: null }, ebitda: { ...seedTargets[0].ebitda, value: null } };
function brief() {
  const b = emptyBrief();
  Object.assign(criterion(b, "headcount"), { value: "20–60", state: "specified", confirmed: true, importance: "requirement" });
  Object.assign(criterion(b, "revenue"), { value: "$1m–$5m", state: "specified", confirmed: true });
  return b;
}
function finding(kind: "headcount" | "revenue" | "location" | "product" | "person" | "capability", value: string, currency: string | null = null): SavedResearchFinding {
  return { id: value, targetId: target.id, jobId: "job", observedAt: "2026-09-30T00:00:00Z", confidence: 90, sourceUrl: "https://example.com/profile", evidence: { kind, name: kind, value, quote: "Published company profile", website: "https://example.com", factMetadata: { sourceKind: "company_website", basis: "reported", scope: "unspecified", currency, identityNote: null, period: null } } };
}
describe("mandate fit review matrix", () => {
  it("scores assessed criteria and reports missing evidence as coverage", () => {
    const fit = reviewMandateFit(brief(), target, initialAssessment, [finding("headcount", "40 employees")]);
    expect(fit.score).toBe(100); expect(fit.completeness).toBe(67);
    expect(fit.reason).toContain("Missing evidence: Revenue range");
  });
  it("scores a full match at 100 and an evidenced mismatch at zero", () => {
    expect(reviewMandateFit(brief(), target, initialAssessment, [finding("headcount", "40 employees"), finding("revenue", "$3m", "AUD")]).score).toBe(100);
    const failed = reviewMandateFit(brief(), target, initialAssessment, [finding("headcount", "100 employees"), finding("revenue", "$8m", "AUD")]);
    expect(failed.score).toBe(0); expect(failed.completeness).toBe(100); expect(failed.reason).toContain("Outside mandate");
  });
  it("does not compare foreign or unknown currencies to AUD", () => {
    for (const currency of [null, "USD"]) expect(reviewMandateFit(brief(), target, initialAssessment, [finding("revenue", "$3m", currency)]).rows[1].status).toBe("unknown");
  });
  it("gives partial credit for conflicting sources without averaging them away", () => {
    const fit = reviewMandateFit(brief(), target, initialAssessment, [finding("headcount", "40 employees"), finding("headcount", "100 employees")]);
    expect(fit.score).toBe(50); expect(fit.rows.find(row => row.key === "headcount")!.reason).toContain("sources disagree");
  });
  it("keeps open bounds partial unless the whole interval satisfies the mandate", () => {
    expect(reviewMandateFit(brief(), target, initialAssessment, [finding("headcount", "40+ employees")]).rows.find(row => row.key === "headcount")!.status).toBe("potential");
    expect(reviewMandateFit(brief(), target, initialAssessment, [finding("headcount", "100+ employees")]).rows.find(row => row.key === "headcount")!.status).toBe("fails");
  });
  it("honours saved reviews without discarding other scraped criteria", () => {
    const fit = reviewMandateFit(brief(), target, { ...initialAssessment, evidence: [{ criterionKey: "headcount", assessment: "fails", kind: "document-verified", value: "100 employees", source: "Reviewed accounts", sourceUrl: "https://example.com/accounts", capturedAt: "2026-09-30T00:00:00Z", confidence: 100, nextStep: "" }] }, [finding("headcount", "40 employees"), finding("revenue", "$3m", "AUD")]);
    expect(fit.score).toBe(33); expect(fit.rows.find(row => row.key === "headcount")!.sources).toEqual(["https://example.com/accounts"]);
  });
  it("excludes unrestricted criteria but scores unconfirmed assumptions", () => {
    const b = brief(); criterion(b, "headcount").state = "unrestricted"; criterion(b, "revenue").confirmed = false; criterion(b, "revenue").origin = "assumed";
    const fit = reviewMandateFit(b, target, initialAssessment, [finding("revenue", "$3m", "AUD")]);
    expect(fit.score).toBe(100); expect(fit.rows.map(row => row.key)).toEqual(["revenue"]); expect(fit.provisional).toBe(true);
  });
  it("distinguishes state and city mandates", () => {
    const b = emptyBrief(); Object.assign(criterion(b, "geography"), { value: "Victoria", state: "specified", confirmed: true });
    expect(reviewMandateFit(b, { ...target, state: "VIC" }, initialAssessment).score).toBe(100);
    criterion(b, "geography").value = "Melbourne";
    expect(reviewMandateFit(b, { ...target, state: "VIC" }, initialAssessment).score).toBe(50);
    expect(reviewMandateFit(b, { ...target, state: "NSW" }, initialAssessment).score).toBe(0);
  });
  it("caps estimated matches at half credit", () => {
    const f = finding("headcount", "40 employees"); f.evidence.factMetadata!.basis = "third_party_estimate";
    expect(reviewMandateFit(brief(), target, initialAssessment, [f]).score).toBe(50);
  });
});


it("scores supplied criteria provisionally before review", () => {
  const b = brief(); criterion(b, "headcount").confirmed = false;
  const fit = reviewMandateFit(b, target, initialAssessment, [finding("headcount", "40 employees")]);
  expect(fit.provisional).toBe(true); expect(fit.assessed).toBe(true); expect(fit.score).toBe(100);
});
it("leaves a supplied mandate unassessed when evidence is absent", () => {
  const fit = reviewMandateFit(brief(), target, initialAssessment);
  expect(fit.score).toBeNull(); expect(fit.reason).toContain("Missing evidence:");
  expect(fit.assessed).toBe(false); expect(fit.completeness).toBe(0);
});
it("scores inferred and assumed criteria from sparse data before review", () => {
  const b = brief();
  Object.assign(criterion(b, "headcount"), { origin: "inferred", confirmed: false });
  Object.assign(criterion(b, "revenue"), { origin: "assumed", confirmed: false });
  const sparse = reviewMandateFit(b, target, initialAssessment, [finding("revenue", "$3m", "AUD")]);
  expect(sparse.score).toBe(100); expect(sparse.completeness).toBe(33);
  expect(sparse.provisional).toBe(true); expect(sparse.reason).toContain("Missing evidence: Headcount range");
  expect(reviewMandateFit(b, target, initialAssessment, [finding("revenue", "$3m", "AUD"), finding("headcount", "40 employees")]).score).toBe(100);
});
it("uses waste services and named managers as partial evidence", () => {
  const b = emptyBrief();
  Object.assign(criterion(b, "subsectors"), { value: "Waste management and recycling services", state: "specified", confirmed: false });
  Object.assign(criterion(b, "management"), { value: "Key management already in place to ensure continuity", state: "specified", confirmed: false });
  const fit = reviewMandateFit(b, target, initialAssessment, [finding("product", "Hazardous waste collection"), finding("product", "Office supplies"), finding("person", "National Operations Manager")]);
  expect(fit.rows.map(row => row.status)).toEqual(["potential", "potential"]);
  expect(fit.score).toBe(50); expect(fit.reason).toContain("Hazardous waste collection"); expect(fit.reason).toContain("continuity");
});
it("normalises revenue punctuation while preserving currency uncertainty", () => {
  const fit = reviewMandateFit(brief(), target, initialAssessment, [finding("revenue", "$3,000,000.", "AUD")]);
  expect(fit.rows.find(row => row.key === "revenue")!.status).toBe("supported");
  expect(reviewMandateFit(brief(), target, initialAssessment, [finding("revenue", "$3,000,000.")]).assessed).toBe(false);
});
it("does not score findings flagged as ambiguous company identities", () => {
  const f = finding("headcount", "40 employees"); f.evidence.factMetadata!.identityNote = "Could be another company";
  expect(reviewMandateFit(brief(), target, initialAssessment, [f]).assessed).toBe(false);
});

it('compares an AUD revenue band as overlapping and keeps unconfirmed currency pending', () => {
  const b = brief();
  const bandTarget = { ...target, revenue: { value: { kind: 'band' as const, label: '$1M - $10M' }, provenance: { ...target.revenue.provenance, currency: 'AUD' } } };
  const fit = reviewMandateFit(b, bandTarget, initialAssessment);
  expect(fit.rows.find(r => r.key === 'revenue')?.status).toBe('potential');
  expect(fit.score).toBe(50);
  bandTarget.revenue.provenance = { ...target.revenue.provenance, currency: "" };
  expect(reviewMandateFit(b, bandTarget, initialAssessment).score).toBeNull();
});
it('uses preferred provider headcount for the same modelled EBITDA as the profile', () => {
  const b = emptyBrief();
  Object.assign(criterion(b, 'ebitda'), { state: 'specified', value: '0–100000000', confirmed: true });
  const fit = reviewMandateFit(b, { ...target, headcount: { ...target.headcount, value: 77 } }, initialAssessment);
  expect(fit.rows[0].status).toBe('potential');
  expect(fit.rows[0].reason).toContain('modelled EBITDA');
  expect(fit.score).toBe(50);
});
it('does not widen the revenue range or score a redundant ceiling twice', () => {
  const b = brief();
  Object.assign(criterion(b, 'revenueCeiling'), { state: 'specified', value: '7000000' });
  const fit = reviewMandateFit(b, target, initialAssessment, [finding('revenue', '$6m', 'AUD')]);
  expect(fit.rows.map(r => r.key)).not.toContain('revenueCeiling');
  expect(fit.rows.find(r => r.key === 'revenue')?.status).toBe('fails');
  criterion(b, 'revenueCeiling').value = '4000000';
  expect(reviewMandateFit(b, target, initialAssessment, [finding('revenue', '$4.5m', 'AUD')]).rows.find(r => r.key === 'revenueCeiling')?.status).toBe('fails');
});
it('does not treat a headquarters state as national operating coverage', () => {
  const b = emptyBrief(); Object.assign(criterion(b, 'geography'), { state: 'specified', value: 'National' });
  expect(reviewMandateFit(b, { ...target, state: 'VIC' }, initialAssessment).score).toBeNull();
  expect(reviewMandateFit(b, target, initialAssessment, [finding('location', 'National')]).score).toBe(100);
});
it('excludes explicit government entity types while leaving provider size failures for review', () => {
  const government = { ...target, sourceData: { firmable: { firmableId: 'f1', industries: [], keywords: [], states: [], locations: [], rawResponse: { company_type: { '1': 'Government agency' } } } } };
  expect(reviewMandateFit(brief(), government, initialAssessment).eligibility.status).toBe('excluded');
  expect(reviewMandateFit(brief(), { ...target, headcount: { ...target.headcount, value: 105 } }, initialAssessment).eligibility.status).toBe('review');
});
it('does not invent laundry sector fit from a company name or query label', () => {
  const b = emptyBrief(); Object.assign(criterion(b, 'subsectors'), { state: 'specified', value: 'Industrial laundry services' });
  expect(reviewMandateFit(b, { ...target, sector: { value: 'Industrial laundry services', provenance: { ...target.sector.provenance, source: 'Google Places query match' } } }, initialAssessment).score).toBeNull();
});
it('compares sourced revenue intervals only with confirmed AUD', () => {
  const fit=reviewMandateFit(brief(),target,initialAssessment,[finding('revenue','$1M - $10M','AUD')]);
  expect(fit.rows.find(r=>r.key==='revenue')?.status).toBe('potential');
  expect(reviewMandateFit(brief(),target,initialAssessment,[finding('revenue','$1M - $10M','USD')]).score).toBeNull();
});

it('explains scoped provider matches with the actual Australian workforce, footprint and revenue assumptions',()=>{
 const b=emptyBrief();for(const [key,value]of [['geography','QLD'],['headcount','25–100'],['revenue','AUD 5000000–18000000']]as const)Object.assign(criterion(b,key),{state:'specified',value,importance:'requirement'});
 const provider={name:'Synthetic Pump Services',website:'https://pump.example.test',hq_country:'AU',revenue:'$5M - $10M',region:{AU:{employee_count:60,address:{state:'Victoria'},locations:[{name:'Queensland, QLD'}]}}};
 const t=mapFirmableProfile(provider,briefToMandate(b),'synthetic-org');
 const fit=reviewMandateFit(b,t,initialAssessment);
 expect(fit.score).toBe(50);
 expect(fit.rows.find(r=>r.key==='headcount')?.reason).toContain('60 Australian employees');
 expect(fit.rows.find(r=>r.key==='geography')?.reason).toContain('QLD');
 expect(fit.rows.find(r=>r.key==='geography')?.reason).toContain('VIC');
 expect(fit.rows.find(r=>r.key==='revenue')?.reason).toContain('$5M - $10M');
 expect(fit.rows.find(r=>r.key==='revenue')?.reason).toContain('assumed');
 expect(fit.rows.every(r=>!r.reason.startsWith('Scoped provider evidence'))).toBe(true);
});
it('uses company-specific service research when the broad provider industry does not establish subsector fit',()=>{
 const b=emptyBrief();Object.assign(criterion(b,'subsectors'),{state:'specified',value:'Water treatment equipment servicing',confirmed:false});
 const t=mapFirmableProfile({name:'Synthetic Pump Services',website:'https://pump.example.test',industries:['Industrial equipment wholesale'],region:{AU:{employee_count:60,address:{state:'Queensland'}}}},briefToMandate(b),'synthetic-org');
 const f=finding('capability','Water treatment equipment servicing');
 const fit=reviewMandateFit(b,t,initialAssessment,[f]);expect(fit.rows[0].status).toBe('potential');expect(fit.rows[0].reason).toContain('Water treatment equipment servicing');expect(fit.rows[0].sources).toContain(f.sourceUrl);
 f.evidence.factMetadata!.identityNote='Ambiguous company';expect(reviewMandateFit(b,t,initialAssessment,[f]).rows[0].status).toBe('unknown');
});
