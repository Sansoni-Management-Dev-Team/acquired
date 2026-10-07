import Link from "next/link";
import { mandateTabHref } from "@/domain/mandate-navigation";
import type { AcquisitionBrief, MembershipView } from "@/domain/acquisition";
import { reviewMandateFit, type FitRow } from "@/domain/mandate-fit";
import { DetailTooltip } from "./detail-tooltip";

const fitGroups: { status: FitRow["status"]; label: string; className: string }[] = [
  { status: "fails", label: "Outside brief", className: "text-red-700 dark:text-red-300" },
  { status: "supported", label: "Matches", className: "text-emerald-700 dark:text-emerald-300" },
  { status: "potential", label: "Check estimates", className: "text-amber-700 dark:text-amber-300" },
  { status: "unknown", label: "Missing evidence", className: "text-[var(--muted)]" },
];

function readableEvidence(reason: string) {
  const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", notation: "compact", maximumFractionDigits: 2 });
  return reason
    .replace(/(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?) AUD/g, (_, low: string, high: string) => `${money.format(Number(low))}–${money.format(Number(high))} AUD`)
    .replace(/ \(estimated \/ unverified\)/g, " (unverified estimate)")
    .replace(/ — (partial or estimated match|matches mandate|outside mandate|needs comparable evidence)$/, "");
}

export function MandateFitCells({ brief, member, mandateId }: { brief: AcquisitionBrief; member: MembershipView; mandateId?: string }) {
  const fit = reviewMandateFit(brief, member.target, member.assessment, member.researchFindings);
  return <MandateFitSummaryCells fit={fit} mandateId={mandateId} />;
}

export function MandateFitSummaryCells({ fit, mandateId }: { fit: ReturnType<typeof reviewMandateFit>; mandateId?: string }) {
  const groups = fitGroups.map(group => ({ ...group, rows: fit.rows.filter(row => row.status === group.status) })).filter(group => group.rows.length);
  return <>
    <td className="min-w-24 p-3"><p className="font-semibold tabular-nums">{fit.eligibility.status === "excluded" ? "Excluded" : fit.score !== null ? `${fit.score}%` : "Not assessed"}</p>{!fit.rows.length && <p className="mt-1 text-xs text-[var(--muted)]">Criteria need review</p>}</td>
    <td className="min-w-72 max-w-96 p-3">
      <DetailTooltip content={<div className="space-y-4 leading-relaxed">
        <p className="font-semibold">Why this company fits</p>
        {fit.eligibility.reasons.length > 0 && <ul className="list-disc space-y-1 pl-4">{fit.eligibility.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        {groups.map(group => <section key={group.status} className="space-y-2">
          <h3 className={`font-semibold ${group.className}`}>{group.label}</h3>
          {group.rows.map(row => <div key={row.key} className="border-l-2 border-[var(--border)] pl-3">
            <p className="font-semibold">{row.label}</p>
            <p className="mt-1">{row.reason === "No comparable evidence; needs review" ? "No evidence yet." : readableEvidence(row.reason)}</p>
            <p className="mt-1 text-[var(--muted)]">Brief: {row.mandate}</p>
            <p className="text-[var(--muted)]">{row.weight === 2 ? "Required" : "Preferred"}</p>
            {row.sources.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="mr-3 inline-flex min-h-12 items-center underline">Source {index + 1}</a>)}
          </div>)}
        </section>)}
        {!fit.rows.length && <p>{fit.reason}</p>}
        <section className="space-y-1 border-t border-[var(--border)] pt-3 text-[var(--muted)]">
          <h3 className="font-semibold text-[var(--foreground)]">How the score works</h3>
          <ul className="list-disc space-y-1 pl-4">
            <li>Match = full points. Partial or estimated = half.</li>
            <li>Requirements count twice as much as preferences.</li>
            <li>Missing evidence is left out of the score. A high score can still need verification.</li>
            <li>Unreviewed criteria and estimates need checking. Saved reviews take priority.</li>
          </ul>
        </section>
      </div>}>
        <span className="block space-y-1.5 text-xs leading-relaxed">
          {fit.eligibility.reasons.map(reason => <span key={reason} className="block font-medium">{reason}</span>)}
          {groups.map(group => <span key={group.status} className="block"><span className={`font-semibold ${group.className}`}>{group.label}:</span>{" "}<span className="text-[var(--muted)]">{group.rows.map(row => row.label).join(", ")}</span></span>)}
          {!fit.rows.length && <span className="text-[var(--muted)]">{fit.reason}</span>}
        </span>
      </DetailTooltip>
      {!fit.rows.length && mandateId && <Link className="mt-2 block text-xs underline" href={mandateTabHref(mandateId, "brief")}>Review criteria in Brief</Link>}
    </td>
  </>;
}
