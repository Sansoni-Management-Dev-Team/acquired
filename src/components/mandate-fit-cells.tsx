import Link from "next/link";
import { mandateTabHref } from "@/domain/mandate-navigation";
import type { AcquisitionBrief, MembershipView } from "@/domain/acquisition";
import { reviewMandateFit } from "@/domain/mandate-fit";
import { DetailTooltip } from "./detail-tooltip";

export function MandateFitCells({ brief, member, mandateId }: { brief: AcquisitionBrief; member: MembershipView; mandateId?: string }) {
  const fit = reviewMandateFit(brief, member.target, member.assessment, member.researchFindings);
  return <MandateFitSummaryCells fit={fit} mandateId={mandateId} />;
}

export function MandateFitSummaryCells({ fit, mandateId }: { fit: ReturnType<typeof reviewMandateFit>; mandateId?: string }) {
  return <>
    <td className="min-w-24 p-3"><p className="font-semibold tabular-nums">{fit.assessed ? `${fit.score}%` : "Not assessed"}</p><p className="mt-1 text-xs text-[var(--muted)]">{fit.rows.length ? `${fit.completeness}% assessed${fit.provisional ? " · Provisional" : ""}` : "Criteria need review"}</p></td>
    <td className="min-w-72 max-w-96 p-3"><DetailTooltip content={<div className="space-y-3"><p>{fit.reason}</p><p>Requirements have weight 2; preferences have weight 1. Fit is calculated across assessed criteria. Matches earn full points; partial or estimated matches earn half; mismatches earn none. Missing evidence reduces coverage, not fit. Specified criteria supplied in the brief can be scored provisionally until reviewed. Saved reviews take precedence.</p>{fit.rows.map(row => <section key={row.key}><p className="font-semibold">{row.label} · {row.status} · weight {row.weight}</p><p>Mandate: {row.mandate}</p><p className="mt-1 text-[var(--muted)]">{row.reason}</p>{row.sources.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="mr-3 inline-flex min-h-12 items-center underline">Source {index + 1}</a>)}</section>)}</div>}><span className="line-clamp-3 text-xs text-[var(--muted)]">{fit.reason}</span></DetailTooltip>{!fit.rows.length && mandateId && <Link className="mt-2 block text-xs underline" href={mandateTabHref(mandateId, "brief")}>Review criteria in Brief</Link>}</td>
  </>;
}
