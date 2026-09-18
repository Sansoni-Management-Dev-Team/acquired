import type { RankedTarget, SignalWeight } from "./models";
import { COMPANY_DATA_SOURCE } from "./provider-display";

export type PersistableTargetEvidence = {
  kind: string;
  value: string;
  weight: Exclude<SignalWeight, "very-high"> | "very_high";
  direction: "positive";
  confidence: number;
  source: string;
  sourceUrl?: string;
  capturedAt: Date;
};

export function targetEvidence(target: RankedTarget): PersistableTargetEvidence[] {
  const firmable = target.sourceData?.firmable;
  if (!firmable) return [];
  const capturedAt = new Date(target.establishedYear.provenance.capturedAt);
  const sourceUrl = firmable.website;
  const evidence: PersistableTargetEvidence[] = [];

  if (firmable.yearFounded) evidence.push({
    kind: "company_longevity", value: `${target.companyName} has operated since ${firmable.yearFounded}`,
    weight: "low", direction: "positive", confidence: target.establishedYear.provenance.confidence,
    source: COMPANY_DATA_SOURCE, sourceUrl, capturedAt,
  });
  if (firmable.industries.length) evidence.push({
    kind: "industry_focus", value: `Company data lists ${firmable.industries.slice(0, 3).join(", ")} as company industries`,
    weight: "low", direction: "positive", confidence: 75, source: COMPANY_DATA_SOURCE, sourceUrl, capturedAt,
  });
  if (firmable.employeeCount) evidence.push({
    kind: "operating_scale", value: `Company data reports ${firmable.employeeCount} Australian employees`,
    weight: "low", direction: "positive", confidence: target.headcount.provenance.confidence,
    source: COMPANY_DATA_SOURCE, sourceUrl, capturedAt,
  });
  if (firmable.headquarters) evidence.push({
    kind: "headquarters", value: `Company data lists the company headquarters as ${firmable.headquarters}`,
    weight: "low", direction: "positive", confidence: 70, source: COMPANY_DATA_SOURCE, sourceUrl, capturedAt,
  });
  if (firmable.tagline) evidence.push({
    kind: "company_positioning", value: `Company data records the company tagline as “${firmable.tagline}”`,
    weight: "low", direction: "positive", confidence: 65, source: COMPANY_DATA_SOURCE, sourceUrl, capturedAt,
  });
  return evidence;
}
