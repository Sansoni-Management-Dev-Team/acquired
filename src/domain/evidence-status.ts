import { companyFactConflicts } from "./company-facts";
import type { ResearchFinding } from "./research";

// "Found" means saved research evidence awaiting human review. It is never a
// verified figure. "Unknown" states how much was searched so an empty field is
// distinguishable from a field that was never looked for.
export type EvidenceCounts = { headcount: number; revenue: number; person: number; snippetEstimates: number; searches: number; researching: boolean; conflicts: string[] };
export function summariseEvidence(findings: { evidence: ResearchFinding }[], options: { searches?: number; researching?: boolean } = {}): EvidenceCounts {
  const snippet = (f: { evidence: ResearchFinding }) => f.evidence.factMetadata?.basis === "search_snippet";
  const count = (kind: ResearchFinding["kind"]) => new Set(findings.filter(f => f.evidence.kind === kind && !snippet(f)).map(f => `${f.evidence.name}:${f.evidence.value}`.toLowerCase())).size;
  return { headcount: count("headcount"), revenue: count("revenue"), person: count("person"), snippetEstimates: new Set(findings.filter(f => f.evidence.kind === "headcount" && snippet(f)).map(f => f.evidence.value.toLowerCase())).size, searches: options.searches || 0, researching: Boolean(options.researching), conflicts: companyFactConflicts(findings.filter(f => !snippet(f))) };
}
export function evidenceLabel(found: number, state: Pick<EvidenceCounts, "searches" | "researching"> & { snippetEstimates?: number }, conflict = false) {
  if (found) return `Found — awaiting review${conflict ? " (sources disagree)" : found > 1 ? ` (${found} observations)` : ""}`;
  if (state.researching) return "Researching";
  if (state.snippetEstimates) return `Search-result estimates only (${state.snippetEstimates}) — unverified`;
  return state.searches ? `Unknown — ${state.searches} web ${state.searches === 1 ? "search" : "searches"} run` : "Unknown — not yet researched";
}
