import { parseHeadcount } from "./company-facts";
import type { SavedResearchFinding } from "./research";

const sourceUrl = "https://www.abs.gov.au/statistics/industry/industry-overview/australian-industry/2024-25/81550DO001_202425.xlsx";
// ABS Table_1: EBITDA ($m), employment ('000), same period and cohort.
export const ebitdaBenchmarks = [
  { id: "manufacturing", label: "Manufacturing — all sizes", ebitdaMillions: 48730, employmentThousands: 900.8, cells: "B121, H121", industry: /^manufacturing$/i },
  { id: "polymers", label: "Polymer and rubber product manufacturing", ebitdaMillions: 1611, employmentThousands: 40.9, cells: "B93, H93", industry: /^(?:plastics manufacturing|polymer product and rubber product manufacturing)$/i },
  { id: "fabricated-metal", label: "Fabricated metal product manufacturing", ebitdaMillions: 5357, employmentThousands: 114.8, cells: "B105, H105", industry: /^fabricated metal product manufacturing$/i },
  { id: "machinery", label: "Machinery and equipment manufacturing", ebitdaMillions: 6849, employmentThousands: 106.4, cells: "B113, H113", industry: /^machinery and equipment manufacturing$/i },
  { id: "other-goods-wholesale", label: "Other goods wholesaling", ebitdaMillions: 5743, employmentThousands: 110.7, cells: "B180, H180", industry: /^other goods wholesaling$/i },
] as const;
export type EstimatedEbitda = {
  status: "estimated" | "unavailable"; reason?: string; low?: number; high?: number;
  currency: "AUD"; metric: "EBITDA"; benchmark?: { id: string; label: string; perPerson: number; period: string; sourceUrl: string; sheet: string; cells: string };
  headcountFindingIds: string[]; modelVersion: "abs-headcount-v1"; limitations: string[];
};
export function estimateEbitda(findings: SavedResearchFinding[], benchmarkId?: string): EstimatedEbitda {
  const base: EstimatedEbitda = { status: "unavailable", currency: "AUD", metric: "EBITDA", headcountFindingIds: [], modelVersion: "abs-headcount-v1", limitations: ["Conditional industry/headcount scenario, not reported earnings or a confidence interval; actual EBITDA may be negative.", "Source date, workforce geography, group scope and comparability require review. ABS employment is June persons, not average FTE.", "Aggregate industry ratios mix company sizes and operating models; this does not establish financial qualification."] };
  const headcounts = findings.filter(f => f.evidence.kind === "headcount");
  if (!headcounts.length) return { ...base, reason: "No sourced headcount available." };
  const values = headcounts.map(f => parseHeadcount(f.evidence.value));
  if (values.some(v => !v || v.min === null || v.max === null || v.min === 0)) return { ...base, reason: "A bounded, positive headcount range is needed; open-ended counts remain unknown." };
  if (new Set(values.map(v => JSON.stringify(v))).size > 1) return { ...base, reason: "Conflicting headcount observations need review before estimating." };
  const industries = findings.filter(f => f.evidence.kind === "industry").map(f => f.evidence.value);
  const matches = ebitdaBenchmarks.filter(b => industries.some(industry => b.industry.test(industry)));
  const benchmark = benchmarkId ? ebitdaBenchmarks.find(b => b.id === benchmarkId) : matches.length === 1 ? matches[0] : undefined;
  if (!benchmark) return { ...base, reason: "Choose a comparable industry benchmark to calculate a scenario." };
  const perPerson = benchmark.ebitdaMillions * 1000 / benchmark.employmentThousands;
  return { ...base, status: "estimated", low: Math.round(values[0]!.min! * perPerson), high: Math.round(values[0]!.max! * perPerson), headcountFindingIds: headcounts.map(f => f.id), benchmark: { id: benchmark.id, label: benchmark.label, perPerson, period: "2024–25", sourceUrl, sheet: "Table_1", cells: benchmark.cells } };
}
