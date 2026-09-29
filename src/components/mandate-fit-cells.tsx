import type { AcquisitionBrief, MembershipView } from "@/domain/acquisition";
import { reviewMandateFit } from "@/domain/mandate-fit";

export function MandateFitCells({ brief, member }: { brief: AcquisitionBrief; member: MembershipView }) {
  const fit = reviewMandateFit(brief, member.target, member.assessment, member.researchFindings);
  return <>
    <td className="min-w-24 p-3"><p className="font-semibold tabular-nums">{fit.score}%</p><p className="mt-1 text-xs text-[var(--muted)]">{fit.completeness}% assessed</p></td>
    <td className="min-w-72 max-w-96 p-3"><p className="text-xs text-[var(--muted)]">{fit.reason}</p><details className="mt-2 text-xs"><summary className="min-h-12 cursor-pointer content-center font-medium underline decoration-[var(--border)]">View fit matrix &amp; sources</summary><div className="space-y-3 rounded border border-[var(--border)] p-3"><p>Requirements have weight 2; preferences have weight 1. Matches earn full points; partial or estimated matches earn half; missing evidence and mismatches earn none. Only confirmed, specified criteria count. Saved reviews take precedence.</p>{fit.rows.map(row => <section key={row.key}><p className="font-semibold">{row.label} · {row.status} · weight {row.weight}</p><p>Mandate: {row.mandate}</p><p className="mt-1 text-[var(--muted)]">{row.reason}</p>{row.sources.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer" className="mr-3 inline-flex min-h-12 items-center underline">Source {index + 1}</a>)}</section>)}</div></details></td>
  </>;
}
