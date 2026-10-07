import {projectFirmableCompanyFields} from './firmable-company-fields';
import type {BackgroundCompanyField} from './company-background-types';
import { assessmentDecisionView, bankabilityReviewCells, criterionDefinitions, worksheet, type AcquisitionBrief, type MembershipView } from "./acquisition";
import { contactCompleteness } from "./contact-completeness";
import { companyScopedFacts } from "./company-scoped-facts";

export type CompletenessStatus = "reported" | "verified" | "estimated" | "reviewed" | "unavailable" | "unattempted" | "failed" | "not_applicable";
export type CompletenessCell = { field: string; status: CompletenessStatus; value: unknown; source: string | null; observed_at: string | null; scope: string | null; currency: string | null; period: string | null; reason: string | null };
const bankLabels = { dscrAtStress: "DSCR at stress", customerConcentrationPct: "Largest customer %", recurringRevenuePct: "Recurring revenue %", addBacksPctOfCashFlow: "Add-backs %", gmInPlace: "Independent GM", goodwillType: "Goodwill profile" };
const baseFields = ["ABN", "ACN", "AU headcount", "AU headcount band", "AU revenue band", "AU state", "AU suburb", "Company email", "Company name", "Company phone", "Description", "Domain", "Firmable identity", "Mapped headcount", "Mapped headcount band", "Mapped revenue", "Mapped sector", "Mapped state", "Mapped suburb", "Saved EBITDA", "Year founded"];
const operationalFields = ["Contact coverage by company", "Contact name and role", "Contact email", "Contact saved phone", "Contact phone availability", "Run counts and failures", "Monitoring sample continuity"];
export const completenessFields = [...baseFields, ...Object.values(bankLabels).map(label => `Bankability: ${label}`), ...criterionDefinitions.map(([key]) => `Mandate criterion: ${key}`), ...operationalFields];
const known = (value: unknown) => value !== null && value !== undefined && value !== "" && value !== "Unknown" && value !== "Unclassified" && (!Array.isArray(value) || value.length > 0);

/** The same worksheet and scoped facts used by product consumers drive the audit. */
export function companyCompleteness(member: MembershipView, brief: AcquisitionBrief, options: { contacts?: Array<Record<string, unknown>>; run?: Record<string, unknown>; monitoring?: Record<string, unknown> } = {}) {
  const target = member.target, provider = target.sourceData?.firmable, facts = provider?.scopedFacts || (provider?.rawResponse ? companyScopedFacts(provider.rawResponse, provider.capturedAt || target.headcount.provenance.capturedAt || new Date(0).toISOString()) : undefined);
  const originalProvider=provider?.rawResponse?projectFirmableCompanyFields(provider.rawResponse,provider.firmableId,provider.capturedAt||target.headcount.provenance.capturedAt):undefined;
  const assessment = assessmentDecisionView(brief, target, member.assessment);
  const cells = new Map<string, CompletenessCell>();
  const websiteResearch = provider?.rawResponse?.websiteResearch as { status?: string; fields?: Record<string, string> } | undefined;
  const websiteFields: Record<string, string> = {
    "Description": "description", "Company email": "company_emails", "Company phone": "company_phones",
    "Year founded": "year_founded", "ACN": "acn", "AU headcount": "employee_count",
    "AU headcount band": "employee_count", "Mapped headcount": "employee_count", "Mapped headcount band": "employee_count",
    "AU revenue band": "revenue", "Mapped revenue": "revenue", "AU state": "website_address",
    "AU suburb": "website_address", "Mapped state": "website_address", "Mapped suburb": "website_address",
  };
  const add = (field: string, value: unknown, meta: { status?: CompletenessStatus; source?: string; capturedAt?: string; scope?: string; currency?: string; period?: string; reason?: string } = {}) => {
    const available = known(value);
    const background=target.sourceData?.backgroundResearch?.fields[websiteFields[field] as BackgroundCompanyField];
    const originalValues:Record<string,unknown>={Description:originalProvider?.description,'Company email':originalProvider?.companyEmails,'Company phone':originalProvider?.companyPhones,ACN:originalProvider?.acn};
    const observation=background?.observations.find(f=>JSON.stringify(f.value)===JSON.stringify(value)||Array.isArray(value)&&value.includes(f.value));
    if(field in originalValues&&!known(originalValues[field])&&observation)meta={...meta,source:observation.sourceUrl,capturedAt:observation.capturedAt,scope:observation.scope,currency:observation.currency||undefined,period:observation.period||undefined,reason:'Published web evidence'};
    if(!available&&background?.status==='failed')meta={...meta,status:'failed',reason:background.missingReason};
    if(!available&&background?.status==='queued')meta={...meta,status:'unattempted',reason:'Company saved; missing-field research queued independently'};
    const incompleteRead = !available && websiteResearch?.fields?.[websiteFields[field]] === "research_incomplete" && ["failed", "partial"].includes(websiteResearch.status || "");
    cells.set(field, { field, value: available ? value : null, status: incompleteRead ? "failed" : meta.status || (available ? "reported" : "unavailable"), source: meta.source || null, observed_at: meta.capturedAt || null, scope: meta.scope || null, currency: meta.currency || null, period: meta.period || null, reason: incompleteRead ? `Website research ${websiteResearch?.status}; no retained evidence for this field` : meta.reason || (available ? null : "No retained source value") });
  };
  const profile = { source: provider ? "Company profile" : "Company discovery", capturedAt: provider?.capturedAt };
  add("Company name", target.companyName, profile); add("Domain", target.domain, profile);
  const registryFinding = member.researchFindings?.find(f => f.evidence.kind === "identifier" && f.evidence.name === "ABN" && f.evidence.value === target.abn && f.sourceUrl.startsWith("https://abr.business.gov.au/"));
  const firmableAbn = Boolean(target.abn && provider?.firmableId && provider.abn?.replace(/\D/g,'') === target.abn);
  const verifiedAbn = Boolean(target.abn && (registryFinding || !firmableAbn && target.sourceData?.abnVerification?.status === "matched"));
  add("ABN", target.abn, { ...profile, status: verifiedAbn ? "verified" : target.abn ? "reported" : "unavailable", source: firmableAbn ? "Firmable company profile" : profile.source, reason: verifiedAbn ? undefined : firmableAbn ? "Accepted from Firmable; independent registry verification is supplemental" : "Legal identity not verified; inspect registry resolution evidence" });
  add("ACN", provider?.acn, profile); add("Firmable identity", provider?.firmableId, profile);
  add("Description", provider?.description, profile); add("Company email", provider?.companyEmails, profile); add("Company phone", provider?.companyPhones, profile);
  add("AU headcount", facts?.headcount.AU.value, facts?.headcount.AU);
  add("AU headcount band", facts?.headcount.AU.value == null ? null : { min: facts.headcount.AU.value, max: facts.headcount.AU.value }, facts?.headcount.AU);
  add("AU revenue band", facts?.revenue.AU.value, { ...facts?.revenue.AU, status: facts?.revenue.AU.assumption ? 'estimated' : undefined, reason: facts?.revenue.AU.assumption });
  add("AU state", facts?.headquarters.value?.state, facts?.headquarters);
  add("AU suburb", facts?.headquarters.value?.suburb, facts?.headquarters);
  for (const [field, derived] of [["Mapped headcount", target.headcount], ["Mapped headcount band", target.headcountBand], ["Mapped revenue", target.revenue], ["Mapped sector", target.sector], ["Saved EBITDA", target.ebitda], ["Year founded", target.establishedYear]] as const) {
    add(field, derived?.value, { ...derived?.provenance, status: derived?.researchState === "estimated" ? "estimated" : undefined, reason: derived?.provenance.assumption || derived?.missingReason });
  }
  add("Mapped state", target.state, facts?.headquarters || profile); add("Mapped suburb", target.suburb, facts?.headquarters || profile);
  const rows = worksheet(brief, target, assessment);
  for (const row of rows) {
    const criterion = brief.criteria.find(c => c.key === row.criterionKey);
    const available = known(row.value);
    add(`Mandate criterion: ${row.criterionKey}`, row.value, { source: row.source, capturedAt: row.capturedAt,
      status: criterion?.state === "unrestricted" ? "not_applicable" : available ? row.reviewState !== "provisional" ? "reviewed" : row.kind === "modelled" ? "estimated" : "reported" : "unattempted",
      reason: criterion?.state === "unknown" ? "Mandate requirement not specified" : !available ? row.nextStep : row.reviewState === "provisional" ? "Provisional evidence; review required" : undefined });
  }
  for (const cell of bankabilityReviewCells(assessment)) add(`Bankability: ${bankLabels[cell.key]}`, cell.value, { status: cell.status, source: assessment.financeReview?.source, capturedAt: assessment.financeReview?.capturedAt, reason: cell.status !== "reviewed" ? cell.requiredEvidence : cell.structureReviewed ? undefined : "Evidence reviewed; financing structure remains unreviewed" });
  if (options.contacts) {
    const details = options.contacts.map(contactCompleteness);
    add("Contact coverage by company", options.contacts.length, { source: "Durable contact rows" });
    add("Contact name and role", options.contacts.filter(c => known(c.displayName) && known(c.role)).length, { source: "Durable contact rows" });
    add("Contact email", { saved: details.filter(d => d.email.saved).length, sourceUnavailable: details.filter(d => d.email.status === "unavailable").length, unknown: details.filter(d => d.email.status === "not_reported").length }, { source: "Durable contact values and lookup results" });
    add("Contact saved phone", details.filter(d => d.phone.saved).length, { source: "Durable contact values" });
    add("Contact phone availability", { advertised: details.filter(d => d.phone.potentiallyAvailable).length, manualLookupRequired: details.filter(d => d.phone.status === "not_requested").length }, { source: "Provider flags and lookup policy", reason: "Advertised availability does not mean a phone is saved" });
  }
  add("Run counts and failures", options.run, { status: options.run ? "reported" : "unattempted", reason: options.run ? undefined : "Run reconciliation not supplied to this snapshot" });
  add("Monitoring sample continuity", options.monitoring, { status: options.monitoring ? "reported" : "unattempted", reason: options.monitoring ? undefined : "Monitor evidence not supplied to this snapshot" });
  for (const field of completenessFields) if (!cells.has(field)) add(field, null, { status: "unattempted", reason: "Contact research not supplied to this snapshot" });
  return { companyId: target.id, companyName: target.companyName, assessmentStage: assessment.stage, cells: completenessFields.map(field => cells.get(field)!), counts: [...cells.values()].reduce((counts, cell) => ({ ...counts, [cell.status]: (counts[cell.status] || 0) + 1 }), {} as Partial<Record<CompletenessStatus, number>>) };
}
