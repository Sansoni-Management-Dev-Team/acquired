import type { RankedTarget, SignalWeight } from "./models";

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
    source: "Firmable", sourceUrl, capturedAt,
  });
  if (firmable.industries.length) evidence.push({
    kind: "industry_focus", value: `Firmable lists ${firmable.industries.slice(0, 3).join(", ")} as company industries`,
    weight: "low", direction: "positive", confidence: 75, source: "Firmable", sourceUrl, capturedAt,
  });
  if (firmable.employeeCount) evidence.push({
    kind: "operating_scale", value: `Firmable reports ${firmable.employeeCount} Australian employees`,
    weight: "low", direction: "positive", confidence: target.headcount.provenance.confidence,
    source: "Firmable", sourceUrl, capturedAt,
  });
  if (firmable.headquarters) evidence.push({
    kind: "headquarters", value: `Firmable lists the company headquarters as ${firmable.headquarters}`,
    weight: "low", direction: "positive", confidence: 70, source: "Firmable", sourceUrl, capturedAt,
  });
  if (firmable.tagline) evidence.push({
    kind: "company_positioning", value: `Firmable records the company tagline as “${firmable.tagline}”`,
    weight: "low", direction: "positive", confidence: 65, source: "Firmable", sourceUrl, capturedAt,
  });
  return evidence;
}
