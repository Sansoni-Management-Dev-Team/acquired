import { parseHeadcount } from "./company-facts";
import type { SavedResearchFinding } from "./research";
import reference from "./data/abs-ebitda-benchmarks.json";

export const ebitdaBenchmarks = reference.benchmarks;
type Benchmark = typeof ebitdaBenchmarks[number];
const legacyIds: Record<string, string> = {
  manufacturing: "division-manufacturing", polymers: "anzsic-19", "fabricated-metal": "anzsic-22",
  machinery: "anzsic-24", "other-goods-wholesale": "anzsic-37",
};
const aliases: Record<string, string[]> = {
  "anzsic-19": ["plastics manufacturing", "rubber manufacturing", "polymer manufacturing"],
  "anzsic-22": ["metal fabrication", "sheet metal fabrication", "structural steel fabrication"],
  "anzsic-24": ["industrial machinery manufacturing", "sensor manufacturing", "instrumentation manufacturing"],
  "anzsic-69": ["calibration laboratory", "testing laboratory", "engineering consultancy", "scientific testing"],
  "anzsic-70": ["software development", "IT services", "computer consulting"],
  "anzsic-94": ["equipment repair", "industrial maintenance"],
};
const normalise = (value: string) => value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (value: string) => normalise(value).split(" ").filter(word => !["and", "of", "the", "other", "related", "except", "private"].includes(word)).map(word => word.replace(/manufacturers?$/, "manufacturing").replace(/ies$/, "y").replace(/s$/, ""));
function distance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length];
}
function similarity(input: string, label: string) {
  const left = [...new Set(tokens(input))], right = [...new Set(tokens(label))];
  if (!left.length || !right.length) return 0;
  const matched = left.reduce((sum, word) => sum + Math.max(0, ...right.map(other => word === other ? 1 : word.length >= 5 && other.length >= 5 && distance(word, other) <= 1 ? 0.8 : 0)), 0);
  return matched / Math.max(left.length, right.length);
}
export type BenchmarkMatch = { id: string; method: "exact" | "alias" | "fuzzy" | "fallback" | "manual"; description: string; needsReview: boolean };
export function matchEbitdaBenchmark(industries: string[]): BenchmarkMatch {
  const labels = [...new Set(industries.map(normalise).filter(Boolean))];
  const candidates = ebitdaBenchmarks.filter(b => b.level !== "size" && b.level !== "economy");
  const exact = candidates.filter(b => labels.includes(normalise(b.label)));
  if (exact.length === 1) return { id: exact[0].id, method: "exact", description: `Matched published industry: ${exact[0].label}.`, needsReview: false };
  const alias = candidates.filter(b => (aliases[b.id] || []).some(a => labels.includes(normalise(a))));
  if (!exact.length && alias.length === 1) return { id: alias[0].id, method: "alias", description: `Suggested comparable industry: ${alias[0].label}. Review the business's operating model.`, needsReview: true };
  const ranked = candidates.map(b => ({ b, score: Math.max(0, ...labels.flatMap(label => [b.label, ...(aliases[b.id] || [])].map(name => similarity(label, name)))) })).sort((a, b) => b.score - a.score || a.b.id.localeCompare(b.b.id));
  const best = ranked[0], runnerUp = ranked[1];
  if (exact.length <= 1 && best && best.score >= 0.45 && best.score - (runnerUp?.score || 0) >= 0.08) {
    return { id: best.b.id, method: "fuzzy", description: `Suggested industry from the business description: ${best.b.label}. Confirm this match before using the estimate.`, needsReview: true };
  }
  return { id: "all-industries", method: "fallback", description: "Industry match unconfirmed. Using the broad Australian industry benchmark; choose a closer industry below.", needsReview: true };
}
export type EbitdaScenario = {
  id: string; label: string; low: number; high: number; headcountLow: number; headcountHigh: number;
  perPersonLow: number; perPersonHigh: number; perPerson: number; period: string;
  sourceUrl: string; sheet: string; cells: string; periods: string[];
};
export type EstimatedEbitda = {
  status: "estimated" | "unavailable"; reason?: string; low?: number; high?: number;
  currency: "AUD"; metric: "EBITDA"; benchmark?: EbitdaScenario; match?: BenchmarkMatch;
  sizeComparisons: EbitdaScenario[]; headcountFindingIds: string[]; headcountBasis?: "reported" | "estimated";
  modelVersion: "abs-headcount-v3"; limitations: string[];
};
function scenario(benchmark: Benchmark, min: number, max: number): EbitdaScenario {
  const rates = benchmark.observations.map(o => o.ebitdaMillions * 1000 / o.employmentThousands);
  const values = rates.flatMap(rate => [min * rate, max * rate]);
  const latest = benchmark.observations[benchmark.observations.length - 1];
  return { id: benchmark.id, label: benchmark.label, low: Math.round(Math.min(...values)), high: Math.round(Math.max(...values)),
    headcountLow: min, headcountHigh: max, perPersonLow: Math.min(...rates), perPersonHigh: Math.max(...rates),
    perPerson: rates[rates.length - 1], period: latest.period.replace("-", "–"), periods: benchmark.observations.map(o => o.period),
    sourceUrl: reference.sourceUrl, sheet: benchmark.sheet, cells: benchmark.observations.map(o => `${o.period}: ${o.cells}`).join("; ") };
}
export function estimateEbitda(findings: SavedResearchFinding[], benchmarkId?: string): EstimatedEbitda {
  const base: EstimatedEbitda = { status: "unavailable", currency: "AUD", metric: "EBITDA", headcountFindingIds: [], sizeComparisons: [], modelVersion: "abs-headcount-v3", limitations: [
    "Indicative annual EBITDA range from headcount and historical industry ratios, not reported earnings or a confidence interval; actual EBITDA may be negative.",
    "The range uses the lowest and highest available annual ratios from 2022–23 to 2024–25. It does not capture the full variation between individual businesses.",
    "Check source date, workforce geography and group scope. ABS employment counts June persons, including working proprietors, not average FTE.",
    "Subsector benchmarks mix company sizes. Size comparisons cover broader industries and are separate scenarios, not a combined subsector-and-size estimate.",
  ] };
  const headcounts = findings.filter(f => f.evidence.kind === "headcount");
  if (!headcounts.length) return { ...base, reason: "No sourced headcount available." };
  const values = headcounts.map(f => parseHeadcount(f.evidence.value));
  if (values.some(v => !v || v.min === null || v.max === null || v.min === 0)) return { ...base, reason: "A bounded, positive headcount range is needed; open-ended counts remain unknown." };
  if (new Set(values.map(v => JSON.stringify(v))).size > 1) return { ...base, reason: "Conflicting headcount observations need review before estimating." };
  const headcountBasis = headcounts.some(f => ["third_party_estimate", "search_snippet"].includes(f.evidence.factMetadata?.basis || "")) ? "estimated" : "reported";
  if (headcountBasis === "estimated") base.limitations.push("Based on estimated headcount from a third-party profile or search result; the resulting EBITDA is an indicative estimate, not reported earnings.");
  const industries = findings.filter(f => f.evidence.kind === "industry").map(f => f.evidence.value);
  const match: BenchmarkMatch = benchmarkId ? { id: legacyIds[benchmarkId] || benchmarkId, method: "manual", description: "Industry benchmark selected manually.", needsReview: false } : matchEbitdaBenchmark(industries);
  const benchmark = ebitdaBenchmarks.find(b => b.id === match.id);
  if (!benchmark) return { ...base, reason: "Selected benchmark is unavailable. Choose another industry." };
  const min = values[0]!.min!, max = values[0]!.max!;
  if (benchmark.level === "size" && (min < benchmark.sizeMin! || max > (benchmark.sizeMax ?? Infinity))) return { ...base, reason: "The selected employee band does not cover the sourced headcount range. Choose an industry benchmark to see all overlapping size comparisons." };
  const selected = scenario(benchmark, min, max);
  const sizeComparisons = benchmark.level === "size" || !benchmark.division ? [] : ebitdaBenchmarks
    .filter(b => b.level === "size" && b.division === benchmark.division && b.sizeMin! <= max && (b.sizeMax ?? Infinity) >= min)
    .map(b => scenario(b, Math.max(min, b.sizeMin!), Math.min(max, b.sizeMax ?? Infinity)));
  return { ...base, status: "estimated", headcountBasis, low: selected.low, high: selected.high, headcountFindingIds: headcounts.map(f => f.id), benchmark: selected, match, sizeComparisons };
}
