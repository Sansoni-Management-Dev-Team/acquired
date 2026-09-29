import type { CandidateWebsite } from "@/domain/target-candidates";
import { TargetEbitdaData, TargetResearchData } from "./target-research-data";

export function CandidateResearchCells({ candidate }: { candidate: CandidateWebsite }) {
  const pending = ["Queued", "Reading website", "Extracting data", "Checking website", "Finding website"].includes(candidate.status);
  const fallback = <span className="text-[var(--muted)]">{pending ? "Pending" : "Unknown"}</span>;
  const hasHeadcount = candidate.findings.some(finding => finding.evidence.kind === "headcount");
  return <>
    <td className="p-3"><TargetResearchData findings={candidate.findings} kind="headcount" fallback={fallback} /></td>
    <td className="p-3"><TargetResearchData findings={candidate.findings} kind="revenue" fallback={fallback} /></td>
    <td className="p-3">{pending && !hasHeadcount ? fallback : <TargetEbitdaData findings={candidate.findings} />}</td>
    <td className="p-3"><TargetResearchData findings={candidate.findings} kind="person" fallback={fallback} /></td>
    <td className="p-3">{candidate.findings.length ? `${candidate.findings.length} ${candidate.findings.length === 1 ? "finding" : "findings"}` : pending ? "Checking" : "No findings"}</td>
  </>;
}
