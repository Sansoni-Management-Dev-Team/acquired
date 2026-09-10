import { companyFactConflicts } from "./company-facts";
import type { ResearchFinding } from "./research";

// "Found" means saved research evidence awaiting human review. It is never a
// verified figure. "Unknown" states how much was searched so an empty field is
// distinguishable from a field that was never looked for.
export type EvidenceCounts = { headcount: number; revenue: number; person: number; searches: number; researching: boolean; conflicts: string[] };
export function summariseEvidence(findings: { evidence: ResearchFinding }[], options: { searches?: number; researching?: boolean } = {}): EvidenceCounts {
  const count = (kind: ResearchFinding["kind"]) => new Set(findings.filter(f => f.evidence.kind === kind).map(f => `${f.evidence.name}:${f.evidence.value}`.toLowerCase())).size;
  return { headcount: count("headcount"), revenue: count("revenue"), person: count("person"), searches: options.searches || 0, researching: Boolean(options.researching), conflicts: companyFactConflicts(findings) };
}
export function evidenceLabel(found: number, state: Pick<EvidenceCounts, "searches" | "researching">, conflict = false) {
  if (found) return `Found — awaiting review${conflict ? " (sources disagree)" : found > 1 ? ` (${found} observations)` : ""}`;
  if (state.researching) return "Researching";
  return state.searches ? `Unknown — ${state.searches} web ${state.searches === 1 ? "search" : "searches"} run` : "Unknown — not yet researched";
}
