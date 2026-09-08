import { z } from "zod";
import type { Mandate, RankedTarget } from "./models";

export const criterionDefinitions = [
  ["subsectors", "Sub-sectors and capabilities", "discovery", "Financial screen"],
  ["geography", "Geography", "discovery", "Financial screen"],
  ["revenue", "Revenue range", "discovery", "Financial screen"],
  ["revenueCeiling", "Revenue ceiling", "discovery", "Financial screen"],
  ["headcount", "Headcount range", "discovery", "Financial screen"],
  ["ebitda", "EBITDA range", "contact", "Financial screen"],
  ["margin", "Sustainable margin", "contact", "Financial screen"],
  ["accreditations", "Accreditations and scope", "overlay", "Financial screen"],
  ["management", "Management in place", "contact", "Management and owner dependence"],
  ["ownerDependence", "Owner dependence", "contact", "Management and owner dependence"],
  ["multiple", "Earnings multiple and basis", "contact", "Valuation and payback"],
  ["payback", "Desired payback", "contact", "Valuation and payback"],
  ["vendorMotivation", "Vendor motivations (in preference order)", "contact", "Vendor motivation"],
  ["sellerEngagement", "Willingness to engage", "contact", "Vendor motivation"],
  ["property", "Property preference", "contact", "Property and assets"],
  ["structure", "Structure appetite", "contact", "Structure"],
  ["concentration", "Customer concentration limit", "contact", "Financial screen"],
  ["timing", "Timing and transaction constraints", "contact", "Structure"],
  ["dealBreakers", "Hard deal breakers", "contact", "Structure"],
] as const;
export type CriterionKey = typeof criterionDefinitions[number][0];
export const criterionSchema = z.object({
  key: z.enum(criterionDefinitions.map(([key]) => key) as [CriterionKey, ...CriterionKey[]]),
  value: z.string().max(1500),
  importance: z.enum(["requirement", "preference"]),
  origin: z.enum(["supplied", "inferred", "assumed"]),
  state: z.enum(["specified", "unknown", "unrestricted"]),
  confirmed: z.boolean(),
});
export const briefSchema = z.object({
  name: z.string().trim().min(1).max(100),
  naturalLanguage: z.string().max(10000),
  investmentThesis: z.string().max(1500),
  outreachPositioning: z.string().max(1500),
  disclosureApproved: z.boolean(),
  criteria: z.array(criterionSchema).length(criterionDefinitions.length),
}).superRefine((brief, ctx) => {
  for (const key of ["revenue", "revenueCeiling", "ebitda", "headcount"] as const) {
    const c = brief.criteria.find(c => c.key === key);
    if (c?.state === "specified") {
      const numbers = [...c.value.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(million|billion|[mkb])?/gi)];
      if (!numbers.length) ctx.addIssue({ code: "custom", message: `${key}: enter a numeric range or mark unknown` });
      if (numbers.length > 2) ctx.addIssue({ code: "custom", message: `${key}: use one minimum and an optional maximum` });
      if (numbers.length === 2) {
        const unit = (v?: string) => ({m: 1e6, million: 1e6, k: 1e3, b: 1e9, billion: 1e9}[v?.toLowerCase() || ""] || 1);
        if (Number(numbers[0][1].replaceAll(",", "")) * unit(numbers[0][2] || numbers[1][2]) > Number(numbers[1][1].replaceAll(",", "")) * unit(numbers[1][2] || numbers[0][2])) ctx.addIssue({ code: "custom", message: `${key}: minimum must not exceed maximum` });
      }
    }
  }
  if (brief.criteria.length === criterionDefinitions.length && new Set(brief.criteria.map(c => c.key)).size === criterionDefinitions.length) {
    const filters = briefToMandate(brief);
    if (filters.revenue.max !== null && filters.revenue.min > filters.revenue.max) ctx.addIssue({ code: "custom", message: "Revenue minimum must not exceed the separate revenue ceiling" });
  }
  if (new Set(brief.criteria.map(c => c.key)).size !== criterionDefinitions.length) ctx.addIssue({ code: "custom", message: "Every criterion must appear exactly once" });
  for (const c of brief.criteria) if (c.state === "specified" && !c.value.trim()) ctx.addIssue({ code: "custom", message: `${c.key} needs a value or an explicit unknown` });
});
export type AcquisitionBrief = z.infer<typeof briefSchema>;
export type Criterion = z.infer<typeof criterionSchema>;
export function emptyBrief(): AcquisitionBrief {
  return { name: "New mandate", naturalLanguage: "", investmentThesis: "", outreachPositioning: "", disclosureApproved: false, criteria: criterionDefinitions.map(([key]) => ({ key, value: "", importance: "preference", origin: "supplied", state: "unknown", confirmed: false })) };
}
export function criterion(brief: AcquisitionBrief, key: CriterionKey) { return brief.criteria.find(c => c.key === key)!; }
export function searchReadiness(brief: AcquisitionBrief) {
  return (["geography", "subsectors"] as const).flatMap(key => {
    const c = criterion(brief, key);
    return c.state === "unknown" || !c.confirmed ? [`Confirm ${key} or a testing assumption before discovery.`] : [];
  });
}
export function briefToMandate(brief: AcquisitionBrief): Mandate {
  const geo = criterion(brief, "geography");
  const all = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];
  const names: Record<string, string> = { victoria: "VIC", melbourne: "VIC", sydney: "NSW", "new south wales": "NSW", queensland: "QLD", brisbane: "QLD", "western australia": "WA", perth: "WA", "south australia": "SA", adelaide: "SA", tasmania: "TAS", hobart: "TAS", "northern territory": "NT", darwin: "NT", canberra: "ACT" };
  const states = geo.state === "unrestricted" || /national|australia-wide|all australia/i.test(geo.value) ? all : [...new Set([...all.filter(s => new RegExp(`\\b${s}\\b`, "i").test(geo.value)), ...Object.entries(names).filter(([name]) => geo.value.toLowerCase().includes(name)).map(([,state]) => state)])];
  function range(key: CriterionKey) {
    const c = criterion(brief, key);
    const amounts = [...c.value.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(million|billion|[mkb])?/gi)];
    const values = amounts.map((a, i) => Number(a[1].replaceAll(",", "")) * ({ m: 1e6, million: 1e6, k: 1e3, b: 1e9, billion: 1e9 }[a[2]?.toLowerCase() || (i === 0 ? amounts[1]?.[2]?.toLowerCase() : "")] || 1));
    return c.state !== "specified" ? { min: 0, max: null } : { min: values[0] ?? 0, max: values[1] ?? null };
  }
  return { sectors: criterion(brief, "subsectors").value.split(/[;\n]/).map(s => s.trim()).filter(Boolean), states, revenue: { ...range("revenue"), ...(criterion(brief,"revenueCeiling").state === "specified" ? { max: range("revenueCeiling").min } : {}) }, ebitda: range("ebitda"), ...(criterion(brief, "headcount").state === "specified" ? { headcount: { min: range("headcount").min, max: range("headcount").max ?? Number.MAX_SAFE_INTEGER } } : {}), unknownFields: brief.criteria.filter(c => c.state === "unknown").map(c => c.key), requirements: brief.criteria.filter(c => c.importance === "requirement" && c.confirmed && c.state === "specified").map(c => c.key) };
}
export const evidenceSchema = z.object({
  criterionKey: z.enum(criterionDefinitions.map(([key]) => key) as [CriterionKey, ...CriterionKey[]]),
  assessment: z.enum(["supported", "potential", "fails", "unknown"]),
  kind: z.enum(["modelled", "website", "register", "inferred", "owner-stated", "document-verified"]),
  value: z.string().max(2000), source: z.string().max(500), sourceUrl: z.union([z.string().url(), z.literal("")]),
  capturedAt: z.string().datetime(), confidence: z.number().min(0).max(100), nextStep: z.string().max(1000),
}).superRefine((e, ctx) => { if (e.assessment !== "unknown" && (!e.source.trim() || !e.value.trim())) ctx.addIssue({ code: "custom", message: "Assessed evidence requires a value and source" }); });
export type CriterionEvidence = z.infer<typeof evidenceSchema>;
export const accreditationSchema = z.object({
  id: z.string().uuid(), issuer: z.string().trim().min(1).max(200), scope: z.string().trim().min(1).max(1000), identifier: z.string().max(200), site: z.string().max(300),
  status: z.enum(["current", "expired", "unverified", "withdrawn"]), verifiedAt: z.string().date(), expiresAt: z.union([z.string().date(), z.literal("")]),
  source: z.string().trim().min(1).max(500), sourceUrl: z.string().url(), confidence: z.number().min(0).max(100),
});
export type Accreditation = z.infer<typeof accreditationSchema>;
export const pipelineStages = ["identified", "reviewing", "shortlisted", "outreach-approved", "contacted", "in-conversation", "qualified", "parked", "excluded"] as const;
export const financeReviewSchema = z.object({
  dscrAtStress: z.number().nonnegative().nullable(), customerConcentrationPct: z.number().min(0).max(100).nullable(),
  recurringRevenuePct: z.number().min(0).max(100).nullable(), addBacksPctOfCashFlow: z.number().min(0).max(100).nullable(),
  gmInPlace: z.boolean().nullable(), goodwillType: z.enum(["business", "mixed", "personal"]).nullable(),
  source: z.string().max(500), sourceUrl: z.union([z.string().url(), z.literal("")]), capturedAt: z.string().datetime(), confidence: z.number().min(0).max(100),
  structureReviewed: z.boolean(),
}).superRefine((r, ctx) => { if (Object.entries(r).some(([key, value]) => ["dscrAtStress", "customerConcentrationPct", "recurringRevenuePct", "addBacksPctOfCashFlow", "gmInPlace", "goodwillType"].includes(key) && value !== null) && !r.source.trim()) ctx.addIssue({ code: "custom", message: "Bankability inputs need a source" }); });
export type FinanceReview = z.infer<typeof financeReviewSchema>;
export function emptyFinanceReview(): FinanceReview { return { dscrAtStress: null, customerConcentrationPct: null, recurringRevenuePct: null, addBacksPctOfCashFlow: null, gmInPlace: null, goodwillType: null, source: "", sourceUrl: "", capturedAt: new Date().toISOString(), confidence: 0, structureReviewed: false }; }
export const assessmentSchema = z.object({ financeReview: financeReviewSchema.optional(), stage: z.enum(pipelineStages), reason: z.string().max(2000), nextAction: z.string().max(1000), evidence: z.array(evidenceSchema).max(100), qualificationConfirmed: z.boolean() }).superRefine((a, ctx) => { if (new Set(a.evidence.map(e => e.criterionKey)).size !== a.evidence.length) ctx.addIssue({ code: "custom", message: "Only one current assessment per criterion is allowed" }); });
export type Assessment = z.infer<typeof assessmentSchema>;
export const initialAssessment: Assessment = { stage: "identified", reason: "", nextAction: "Review sub-sector relevance", evidence: [], qualificationConfirmed: false };
export function qualificationGaps(brief: AcquisitionBrief, assessment: Assessment) {
  return brief.criteria.filter(c => (c.state === "unknown" || !c.confirmed) || (c.importance === "requirement" && c.state === "specified" && !assessment.evidence.some(e => e.criterionKey === c.key && e.assessment === "supported" && ["owner-stated", "document-verified", "register"].includes(e.kind)))).map(c => criterionDefinitions.find(([key]) => key === c.key)![1]);
}
export function transitionErrors(brief: AcquisitionBrief, assessment: Assessment) {
  if (["parked", "excluded"].includes(assessment.stage) && !assessment.reason.trim()) return ["Record a reason for parking or exclusion."];
  if (assessment.stage === "qualified") return [...qualificationGaps(brief, assessment).map(s => `Resolve ${s} before qualification.`), ...(!assessment.qualificationConfirmed ? ["Confirm the qualification review."] : [])];
  return [];
}
export function worksheet(brief: AcquisitionBrief, target: RankedTarget, assessment: Assessment): CriterionEvidence[] {
  return brief.criteria.map(c => {
    const saved = assessment.evidence.find(e => e.criterionKey === c.key);
    if (saved) return saved;
    if (c.key === "accreditations" && target.accreditations?.length) {
      const today = new Date().toISOString().slice(0,10);
      const current = target.accreditations.filter(a => a.status === "current" && a.verifiedAt <= today && (!a.expiresAt || a.expiresAt >= today));
      if (current.length) return { criterionKey: c.key, assessment: "potential" as const, kind: "register" as const, value: current.map(a => `${a.issuer}: ${a.scope}${a.site ? ` (${a.site})` : ""}`).join("; "), source: current[0].source, sourceUrl: current[0].sourceUrl, capturedAt: `${current[0].verifiedAt}T00:00:00.000Z`, confidence: Math.min(...current.map(a => a.confidence)), nextStep: "Check required accreditation, scope and site against each linked record" };
    }
    const field = c.key === "revenue" ? target.revenue : c.key === "headcount" ? target.headcount : c.key === "ebitda" ? target.ebitda : c.key === "subsectors" ? target.sector : null;
    return { criterionKey: c.key, assessment: field?.value != null ? "potential" : "unknown", kind: c.key === "revenue" ? "modelled" : "inferred", value: field?.value == null ? "" : typeof field.value === "object" ? (field.value.kind === "band" ? field.value.label : `$${field.value.min.toLocaleString("en-AU")}–$${field.value.max.toLocaleString("en-AU")}`) : String(field.value), source: field?.provenance.source || "", sourceUrl: field?.provenance.sourceUrl || "", capturedAt: field?.provenance.capturedAt || new Date(0).toISOString(), confidence: field?.value == null ? 0 : field.provenance.confidence, nextStep: criterionDefinitions.find(([key]) => key === c.key)![2] === "contact" ? "Ask the owner and record supporting evidence" : "Verify relevance and source" };
  });
}
export const valuationSchema = z.object({
  id: z.string().uuid(), label: z.string().trim().min(1).max(200), subsector: z.string().trim().min(1).max(200), type: z.enum(["asking", "completed"]), observedAt: z.string().date(),
  source: z.string().trim().min(1).max(500), sourceUrl: z.union([z.string().url(), z.literal("")]),
  price: z.number().positive(), earnings: z.number().positive(), basis: z.enum(["EBITDA", "net-earnings"]), period: z.string().trim().min(1).max(200),
  property: z.enum(["included", "excluded", "unknown"]), contingentConsideration: z.string().max(1000), notes: z.string().max(2000),
});
export type ValuationObservation = z.infer<typeof valuationSchema>;
export function indicativeMultiple(o: ValuationObservation) { return o.price / o.earnings; }
export type CoverageSource = { name: string; status: "searched" | "partial" | "failed" | "not-configured"; discovered: number; unique: number; overlap: number; checkedAt: string; note: string };
export type CoverageRun = { id: string; sources: CoverageSource[]; createdAt: string };
export type MandateView = { id: string; brief: AcquisitionBrief; createdAt: string };
export type MembershipView = { target: RankedTarget; assessment: Assessment; accreditations: Accreditation[]; version: number };
