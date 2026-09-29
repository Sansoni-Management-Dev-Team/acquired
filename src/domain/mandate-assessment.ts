import type { BuyerProfile } from "./buyer-profile";
import { briefToMandate, criterionDefinitions, type AcquisitionBrief, type Assessment } from "./acquisition";
import type { RankedTarget, FinanceabilityEvidence } from "./models";
import { rankTarget } from "./scoring";

export function assessMembership(target: RankedTarget, brief: AcquisitionBrief, assessment: Assessment, _buyer: BuyerProfile | null): RankedTarget {
  void _buyer; // Keep the existing call signature while legacy buyer capital fields are phased out.
  const finance = assessment.financeReview;
  const financeability: FinanceabilityEvidence = {};
  if (finance?.source) {
    const provenance = { source: finance.source, sourceUrl: finance.sourceUrl || undefined, capturedAt: finance.capturedAt, confidence: finance.confidence };
    for (const key of ["dscrAtStress", "customerConcentrationPct", "recurringRevenuePct", "addBacksPctOfCashFlow"] as const) if (finance[key] !== null) financeability[key] = { value: finance[key], provenance };
    if (finance.gmInPlace !== null) financeability.gmInPlace = { value: finance.gmInPlace, provenance };
    if (finance.goodwillType !== null) financeability.goodwillType = { value: finance.goodwillType, provenance };
  }
  const ripenessSignals = target.signals.filter(signal => /tenure|succession|retirement|seller_engagement|sole_director|age_band/.test(signal.kind));
  const ranked = rankTarget({ ...target, signals: ripenessSignals, financeability: Object.keys(financeability).length ? financeability : target.financeability }, briefToMandate(brief));
  ranked.signals = target.signals;
  const relevant = brief.criteria.filter(c => c.state === "specified" && c.confirmed);
  const fitCriteria = relevant.filter(c => !["vendorMotivation", "sellerEngagement", "timing"].includes(c.key));
  const tested = fitCriteria.flatMap(c => assessment.evidence.filter(e => e.criterionKey === c.key && e.assessment !== "unknown"));
  if (assessment.evidence.length) {
    ranked.scores.fit = fitCriteria.length ? Math.round(tested.reduce((s,e) => s + (e.assessment === "supported" ? 1 : e.assessment === "potential" ? 0.5 : 0), 0) / fitCriteria.length * 100) : 0;
    ranked.scores.completeness!.fit = fitCriteria.length ? Math.round(tested.length / fitCriteria.length * 100) : 0;
    ranked.scores.axisConfidence!.fit = tested.length ? Math.round(tested.reduce((s,e) => s + e.confidence, 0) / tested.length) : 0;
    ranked.scores.reasons = ranked.scores.reasons.filter(r => r.axis !== "fit");
    ranked.scores.reasons.push(...tested.map(e => ({ axis: "fit" as const, label: `${criterionDefinitions.find(([key]) => key === e.criterionKey)![1]}: ${e.assessment}`, contribution: e.assessment === "supported" ? 1 : 0, source: e.source, sourceUrl: e.sourceUrl || undefined })));
  }
  const engagement = assessment.evidence.find(e => e.criterionKey === "sellerEngagement" && ["owner-stated", "document-verified"].includes(e.kind) && ["supported", "fails"].includes(e.assessment));
  if (engagement) {
    ranked.scores.ripeness = engagement.assessment === "supported" ? 100 : 0;
    ranked.scores.completeness!.ripeness = 100;
    ranked.scores.axisConfidence!.ripeness = engagement.confidence;
    ranked.scores.reasons = ranked.scores.reasons.filter(r => r.axis !== "ripeness");
    ranked.scores.reasons.push({ axis: "ripeness", label: `Seller engagement: ${engagement.value}`, contribution: ranked.scores.ripeness, source: engagement.source, sourceUrl: engagement.sourceUrl || undefined });
  }
  // A fit preference failing is not a hard rejection. Inferences and estimates cannot hard-exclude.
  const hardFailure = relevant.some(c => c.importance === "requirement" && assessment.evidence.some(e => e.criterionKey === c.key && e.assessment === "fails" && ["register", "owner-stated", "document-verified"].includes(e.kind) && e.confidence >= 80));
  if (hardFailure || assessment.stage === "excluded") { ranked.scores.band = "excluded"; ranked.scores.qualification = "excluded"; }
  else { ranked.scores.band = "cold"; ranked.scores.qualification = assessment.stage === "qualified" ? "priority" : ["shortlisted", "outreach-approved", "contacted", "in-conversation"].includes(assessment.stage) ? "develop" : "research"; }
  if (!finance?.structureReviewed) {
    ranked.scores.financeability = null;
    ranked.scores.tensions.push("Bankability requires a reviewed deal structure alongside target evidence.");
  }
  ranked.scores.confidence = Math.round((ranked.scores.axisConfidence!.fit + ranked.scores.axisConfidence!.ripeness + ranked.scores.axisConfidence!.bankability) / 3);
  return ranked;
}
