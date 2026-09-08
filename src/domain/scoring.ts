import type { DerivedValue, FinancialValue, Mandate, OpportunityQualification, RankedTarget, ScoreBand, Signal, TargetCandidate } from "./models";

export const DEFAULT_BAND_THRESHOLDS = {
  hot: { fit: 75, ripeness: 70, confidence: 60 },
  warm: { fit: 60, ripeness: 45, confidence: 40 },
} as const;

const signalPoints = { low: 6, medium: 12, high: 22, "very-high": 35 } as const;

function inRange(value: number, range: { min: number; max: number | null }) {
  return value >= range.min && (range.max === null || value <= range.max);
}

function financialMatch(value: FinancialValue, mandate: { min: number; max: number | null }) {
  if (typeof value === "number") return inRange(value, mandate);
  if (value.kind === "range") return (mandate.max === null || value.min <= mandate.max) && value.max >= mandate.min;
  return undefined;
}

function calculateFit(target: TargetCandidate, mandate: Mandate) {
  const reasons: RankedTarget["scores"]["reasons"] = [];
  let score = 0;
  const locationKnown = /^(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/.test(target.state) && mandate.states.length > 0;
  let knownWeight = locationKnown ? 10 : 0;
  let confidenceTotal = locationKnown ? 1000 : 0;
  let excluded = mandate.states.length > 0 && !["Unknown", ""].includes(target.state) && !mandate.states.includes(target.state) && (!mandate.requirements || mandate.requirements.includes("geography"));

  if (!excluded && locationKnown) {
    score += 10;
    reasons.push({ axis: "fit", label: `Located in ${target.state}`, contribution: 10, source: "Discovery record" });
  }

  const checks: Array<{ field: DerivedValue<unknown>; weight: number; label: string; match: (value: unknown) => boolean | undefined }> = [
    { field: target.sector, weight: 30, label: "Sector matches mandate", match: (value) => typeof value === "string" && mandate.sectors.some((sector) => {
      const actual = value.toLowerCase(); const requested = sector.toLowerCase();
      return actual.includes(requested) || requested.includes(actual);
    }) },
    { field: target.revenue, weight: 25, label: "Revenue within mandate", match: (value) => financialMatch(value as FinancialValue, mandate.revenue) },
    { field: target.ebitda, weight: 25, label: "EBITDA within mandate", match: (value) => financialMatch(value as FinancialValue, mandate.ebitda) },
    {
      field: target.headcount,
      weight: 10,
      label: "Headcount within mandate",
      match: (value: unknown) => typeof value === "number" && (!mandate.headcount || inRange(value, mandate.headcount)),
    },
  ];

  for (const check of checks) {
    if (check.field.value === null || (check.label.startsWith("Revenue") && mandate.unknownFields?.includes("revenue")) || (check.label.startsWith("EBITDA") && mandate.unknownFields?.includes("ebitda"))) continue;
    const matches = check.match(check.field.value);
    if (matches === undefined) continue;
    knownWeight += check.weight;
    confidenceTotal += check.weight * check.field.provenance.confidence;
    if (matches) {
      score += check.weight;
      reasons.push({
        axis: "fit",
        label: check.label,
        contribution: check.weight,
        source: check.field.provenance.source,
        sourceUrl: check.field.provenance.sourceUrl,
      });
    } else if (check.weight >= 25 && check.field.provenance.confidence >= 80 && typeof check.field.value === "number" && (!mandate.requirements || mandate.requirements.includes(check.label.startsWith("Revenue") ? "revenue" : "ebitda"))) {
      excluded = true;
    }
  }

  return { score, completeness: knownWeight, evidenceConfidence: knownWeight ? Math.round(confidenceTotal / knownWeight) : 0, reasons, excluded };
}

function calculateRipeness(signals: Signal[]) {
  const reasons: RankedTarget["scores"]["reasons"] = [];
  let score = 0;

  for (const signal of signals) {
    const points = signalPoints[signal.weight] * (signal.direction === "positive" ? 1 : -1);
    score += points;
    reasons.push({
      axis: "ripeness",
      label: signal.value,
      contribution: points,
      source: signal.provenance.source,
      sourceUrl: signal.provenance.sourceUrl,
    });
  }

  const confidence = signals.length
    ? Math.round(signals.reduce((sum, signal) => sum + signal.provenance.confidence, 0) / signals.length)
    : 0;

  return { score: Math.max(0, Math.min(100, score)), confidence, reasons };
}

function calculateFinanceability(target: TargetCandidate) {
  const evidence = target.financeability;
  if (!evidence) return { score: null, completeness: 0, confidence: 0, reasons: [] as RankedTarget["scores"]["reasons"] };
  const reasons: RankedTarget["scores"]["reasons"] = [];
  let earned = 0; let possible = 0; let confidenceTotal = 0;
  const assess = <T>(field: DerivedValue<T> | undefined, weight: number, label: (value: T) => string, pass: (value: T) => boolean) => {
    if (!field || field.value === null) return;
    possible += weight; confidenceTotal += field.provenance.confidence * weight;
    const passed = pass(field.value); if (passed) earned += weight;
    reasons.push({ axis: "financeability", label: label(field.value), contribution: passed ? weight : 0, source: field.provenance.source, sourceUrl: field.provenance.sourceUrl });
  };
  assess(evidence.dscrAtStress, 30, (value) => `DSCR at stress rate ${value.toFixed(2)}x`, (value) => value >= 1.25);
  assess(evidence.customerConcentrationPct, 15, (value) => `Largest customer ${value}% of revenue`, (value) => value <= 20);
  assess(evidence.recurringRevenuePct, 10, (value) => `Recurring/service revenue ${value}%`, (value) => value >= 35);
  assess(evidence.goodwillType, 20, (value) => `${value[0].toUpperCase()}${value.slice(1)} goodwill profile`, (value) => value === "business");
  assess(evidence.gmInPlace, 15, (value) => value ? "General manager in place" : "No independent general manager", Boolean);
  assess(evidence.addBacksPctOfCashFlow, 10, (value) => `Add-backs ${value}% of cash flow`, (value) => value <= 20);
  return { score: possible >= 50 ? Math.round(earned / possible * 100) : null, completeness: possible, confidence: possible ? Math.round(confidenceTotal / possible) : 0, reasons };
}

function qualify(fit: number, ripeness: number, financeability: number | null, confidence: number, excluded: boolean): OpportunityQualification {
  if (excluded) return "excluded";
  if (fit >= 75 && ripeness >= 70 && financeability !== null && financeability >= 60 && confidence >= 60) return "priority";
  if (fit >= 60 && ripeness >= 45 && (financeability === null || financeability >= 50)) return confidence >= 55 ? "develop" : "research";
  return "research";
}

export function determineBand(fit: number, ripeness: number, confidence: number, excluded = false): ScoreBand {
  if (excluded) return "excluded";
  if (fit >= 75 && ripeness >= 70 && confidence >= 60) return "hot";
  if (fit >= 60 && ripeness >= 45 && confidence >= 40) return "warm";
  return "cold";
}

export function rankTarget(target: TargetCandidate, mandate: Mandate): RankedTarget {
  const fit = calculateFit(target, mandate);
  const ripeness = calculateRipeness(target.signals);
  const financeability = calculateFinanceability(target);
  const completeness = Math.min(100, 20 + [target.sector, target.revenue, target.ebitda, target.headcount, target.establishedYear].filter((field) => field.value !== null).length * 12 + target.signals.length * 5);
  const confidence = Math.round((fit.evidenceConfidence * 0.4) + (ripeness.confidence * 0.3) + (completeness * 0.2) + (financeability.confidence * 0.1));
  const tensions: string[] = [];
  if (ripeness.score >= 70 && financeability.score !== null && financeability.score < 55) tensions.push("Owner readiness is high, but the current evidence indicates weak financeability.");
  if (financeability.score !== null && financeability.score >= 70 && ripeness.score < 45) tensions.push("The business appears financeable, but there is little evidence the owner is ready to engage.");
  if (financeability.score === null) tensions.push("Financeability is unscored until operating and lender evidence is collected.");

  return {
    ...target,
    scores: {
      fit: fit.score,
      ripeness: ripeness.score,
      financeability: financeability.score,
      confidence,
      completeness: { fit: fit.completeness, ripeness: target.signals.length ? Math.min(100, target.signals.length * 20) : 0, bankability: financeability.completeness },
      axisConfidence: { fit: fit.evidenceConfidence, ripeness: ripeness.confidence, bankability: financeability.confidence },
      band: determineBand(fit.score, ripeness.score, confidence, fit.excluded),
      qualification: qualify(fit.score, ripeness.score, financeability.score, confidence, fit.excluded),
      tensions,
      reasons: [...fit.reasons, ...ripeness.reasons, ...financeability.reasons],
    },
  };
}

export function rankTargets(targets: TargetCandidate[], mandate: Mandate) {
  const bandOrder: Record<ScoreBand, number> = { hot: 0, warm: 1, cold: 2, excluded: 3 };
  return targets.map((target) => rankTarget(target, mandate)).sort((a, b) =>
    bandOrder[a.scores.band] - bandOrder[b.scores.band]
      || b.scores.fit + b.scores.ripeness - (a.scores.fit + a.scores.ripeness),
  );
}
