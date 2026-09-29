import { briefToMandate, criterionDefinitions, type AcquisitionBrief, type Assessment, type CriterionKey } from "./acquisition";
import { parseHeadcount } from "./company-facts";
import { estimateEbitda } from "./estimated-ebitda";
import type { FinancialValue, TargetCandidate } from "./models";
import type { SavedResearchFinding } from "./research";

export type FitRow = { key: CriterionKey; label: string; mandate: string; weight: number; status: "supported" | "potential" | "fails" | "unknown"; reason: string; sources: string[] };
type Observation = { value: string; sources: string[]; estimated?: boolean; min?: number | null; max?: number | null };
const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function financial(value: FinancialValue | null, sourceUrl?: string): Observation[] {
  if (value === null || typeof value === "object" && value.kind !== "range") return [];
  return [{ value: typeof value === "number" ? `${value} AUD` : `${value.min}–${value.max} AUD`, min: typeof value === "number" ? value : value.min, max: typeof value === "number" ? value : value.max, sources: sourceUrl ? [sourceUrl] : [] }];
}
function revenueObservation(f: SavedResearchFinding): Observation {
  const match = f.evidence.value.trim().match(/^(?:(AUD|A\$)\s*)?\$?([\d,]+(?:\.\d+)?)\s*(k|m|b|million|billion)?$/i);
  const aud = f.evidence.factMetadata?.currency === "AUD" || (!f.evidence.factMetadata?.currency && Boolean(match?.[1]));
  const amount = match && aud ? Number(match[2].replaceAll(",", "")) * ({ k: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 }[match[3]?.toLowerCase() || ""] || 1) : null;
  return { value: f.evidence.value, min: amount, max: amount, sources: [f.sourceUrl], estimated: f.evidence.factMetadata?.basis !== "reported" || f.evidence.factMetadata?.scope === "group" };
}

/** Evidence-backed fit, not a probability of a successful acquisition. Unknowns earn no points. */
export function reviewMandateFit(brief: AcquisitionBrief, target: TargetCandidate, assessment: Assessment, findings: SavedResearchFinding[] = []) {
  const filters = briefToMandate(brief);
  const observations = (kind: string): Observation[] => findings.filter(f => f.evidence.kind === kind).map(f => ({ value: f.evidence.value, sources: [f.sourceUrl], estimated: f.evidence.factMetadata?.basis !== "reported" || f.evidence.factMetadata?.scope === "group" }));
  const rows: FitRow[] = brief.criteria.filter(c => c.confirmed && c.state === "specified").map(c => {
    const row: FitRow = { key: c.key, label: criterionDefinitions.find(([key]) => key === c.key)![1], mandate: c.value, weight: c.importance === "requirement" ? 2 : 1, status: "unknown", reason: "No comparable evidence; needs review", sources: [] };
    const reviewed = assessment.evidence.find(e => e.criterionKey === c.key);
    if (reviewed) return { ...row, status: reviewed.assessment === "supported" && ["modelled", "inferred"].includes(reviewed.kind) ? "potential" : reviewed.assessment, reason: `${reviewed.value || "No evidence"}${reviewed.kind === "modelled" || reviewed.kind === "inferred" ? " (estimated)" : " (reviewed)"}`, sources: reviewed.sourceUrl ? [reviewed.sourceUrl] : [] };
    let values: Observation[] = [];
    let range: { min: number; max: number | null } | undefined;
    if (c.key === "headcount") {
      values = observations("headcount").map(o => { const parsed = parseHeadcount(o.value); return { ...o, ...parsed, estimated: o.estimated || parsed?.approximate }; });
      if (!values.length && target.headcount.value !== null) values = [{ value: String(target.headcount.value), min: target.headcount.value, max: target.headcount.value, sources: target.headcount.provenance.sourceUrl ? [target.headcount.provenance.sourceUrl] : [], estimated: target.headcount.provenance.confidence < 80 }];
      range = filters.headcount;
    } else if (c.key === "revenue" || c.key === "revenueCeiling") {
      values = findings.filter(f => f.evidence.kind === "revenue").map(revenueObservation);
      if (!values.length) values = financial(target.revenue.value, target.revenue.provenance.sourceUrl).map(o => ({ ...o, estimated: target.revenue.provenance.confidence < 80 }));
      range = c.key === "revenueCeiling" ? { min: 0, max: filters.revenue.max } : filters.revenue;
    } else if (c.key === "ebitda") {
      values = financial(target.ebitda.value, target.ebitda.provenance.sourceUrl).map(o => ({ ...o, estimated: target.ebitda.provenance.confidence < 80 }));
      if (!values.length) {
        const estimate = estimateEbitda(findings);
        if (estimate.status === "estimated") values = [{ value: `${estimate.low}–${estimate.high} AUD (modelled EBITDA)`, min: estimate.low, max: estimate.high, estimated: true, sources: estimate.benchmark ? [estimate.benchmark.sourceUrl] : [] }];
      }
      range = filters.ebitda;
    } else if (c.key === "subsectors") {
      values = observations("industry");
      if (!values.length && target.sector.value) values = [{ value: target.sector.value, sources: target.sector.provenance.sourceUrl ? [target.sector.provenance.sourceUrl] : [], estimated: target.sector.provenance.confidence < 80 }];
    } else if (c.key === "geography") {
      values = observations("location");
      if (!values.length && target.state && target.state !== "Unknown") values = [{ value: target.state, sources: [] }];
    }
    if (!values.length) return row;
    const outcomes = values.map(o => {
      if (range) {
        if (o.min == null && o.max == null) return "unknown";
        if (o.max != null && o.max < range.min || o.min != null && range.max !== null && o.min > range.max) return "fails";
        if (o.min != null && o.min >= range.min && (range.max === null || o.max != null && o.max <= range.max)) return o.estimated ? "potential" : "supported";
        return "potential";
      }
      const actual = normalise(o.value);
      const alternatives = c.value.split(/;|\n|\bor\b/i).map(normalise).filter(Boolean);
      const matched = alternatives.some(value => actual === value || actual.includes(value));
      if (matched) return o.estimated ? "potential" : "supported";
      // Broader state matches only partially satisfy city-specific mandates.
      if (c.key === "geography" && filters.states.length) {
        const observedStates = briefToMandate({ ...brief, criteria: brief.criteria.map(item => item.key === "geography" ? { ...item, value: o.value } : item) }).states;
        if (observedStates.length) {
          if (!observedStates.some(state => filters.states.includes(state))) return "fails";
          const stateOnly = /national|australia-wide|all australia/i.test(c.value) || c.value.split(/[,;\n]|\band\b|\bor\b/i).every(part => /^(ACT|NSW|NT|QLD|SA|TAS|VIC|WA|Victoria|New South Wales|Queensland|South Australia|Western Australia|Tasmania|Northern Territory|Australian Capital Territory)$/i.test(part.trim()));
          return stateOnly && !o.estimated ? "supported" : "potential";
        }
      }
      return "unknown";
    });
    const unique = new Set(outcomes);
    row.status = unique.size === 1 ? outcomes[0] : "potential";
    if (unique.has("unknown") && unique.size > 1 && !unique.has("supported") && !unique.has("potential")) row.status = "unknown";
    row.sources = [...new Set(values.flatMap(o => o.sources))];
    row.reason = `${values.map(o => o.value).filter((v, i, all) => all.indexOf(v) === i).join("; ")}${unique.size > 1 ? " — sources disagree or are incomplete" : row.status === "unknown" ? " — needs comparable evidence" : row.status === "fails" ? " — outside mandate" : row.status === "potential" ? " — partial or estimated match" : " — matches mandate"}`;
    return row;
  });
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  const earned = rows.reduce((sum, row) => sum + row.weight * (row.status === "supported" ? 1 : row.status === "potential" ? 0.5 : 0), 0);
  const tested = rows.filter(row => row.status !== "unknown");
  const summary = (status: FitRow["status"], label: string) => {
    const matches = rows.filter(row => row.status === status);
    return matches.length ? `${label}: ${matches.map(row => row.label).join(", ")}.` : "";
  };
  return { score: total ? Math.round(earned / total * 100) : 0, completeness: total ? Math.round(tested.reduce((sum, row) => sum + row.weight, 0) / total * 100) : 0, rows, reason: total ? [summary("supported", "Matches"), summary("potential", "Partial / estimated"), summary("fails", "Outside mandate"), summary("unknown", "Missing evidence")].filter(Boolean).join(" ") : "Confirm mandate criteria to assess fit." };
}
