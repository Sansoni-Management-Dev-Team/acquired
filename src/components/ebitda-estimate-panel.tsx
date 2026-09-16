"use client";
import { useState } from "react";
import { ebitdaBenchmarks, estimateEbitda } from "@/domain/estimated-ebitda";
import type { SavedResearchFinding } from "@/domain/research";

export function EbitdaEstimatePanel({ findings }: { findings: SavedResearchFinding[] }) {
  const [benchmark, setBenchmark] = useState("");
  const estimate = estimateEbitda(findings, benchmark || undefined);
  const money = (n: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
  return (
      <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <h4 className="font-semibold">Estimated annual EBITDA range</h4>
        <p className="text-xs text-[var(--muted)]">Sourced headcount × comparable industry EBITDA per person. The range includes variation across the available 2022–23 to 2024–25 benchmarks.</p>
        <label className="block text-sm">Comparable industry<select className="mt-1 min-h-12 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-2" value={benchmark} onChange={e => setBenchmark(e.target.value)}><option value="">Suggest from the business industry</option>{[["Industry subsectors", "subdivision"], ["Broad industries", "division"], ["Industries by employee range", "size"], ["Fallback", "economy"]].map(([label, level]) => <optgroup key={level} label={label}>{ebitdaBenchmarks.filter(b => b.level === level).map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</optgroup>)}</select></label>
        {estimate.status === "estimated" ? <>
          <p className="text-xs text-[var(--muted)]">{estimate.headcountBasis === "estimated" ? "Based on estimated headcount · indicative EBITDA" : "Based on reported headcount · indicative EBITDA"}</p>
          {estimate.headcountAggregation?.method === "mean" && <p className="text-xs text-[var(--status-amber)]">Averaged headcount from {estimate.headcountAggregation.observations} observations; lower and upper bounds averaged separately.</p>}
          <p className="text-lg font-semibold">{money(estimate.low!)} – {money(estimate.high!)} AUD / year</p>
          <p className={`text-sm ${estimate.match?.needsReview ? "text-[var(--status-amber)]" : "text-[var(--muted)]"}`}>{estimate.match?.description}</p>
          <p className="text-sm">{estimate.benchmark!.headcountLow}–{estimate.benchmark!.headcountHigh} people × {money(estimate.benchmark!.perPersonLow)}–{money(estimate.benchmark!.perPersonHigh)} EBITDA per person.</p>
          <p className="text-xs"><a className="underline" href={estimate.benchmark!.sourceUrl} target="_blank" rel="noreferrer">ABS benchmark: {estimate.benchmark!.label}</a> · {estimate.benchmark!.periods.join(", ")}</p>
          {estimate.sizeComparisons.length > 0 && <div className="space-y-2"><h5 className="text-sm font-semibold">Separate comparisons by business size</h5><p className="text-xs text-[var(--muted)]">These use the broader industry. Each row covers the part of the headcount range within that employee band.</p>{estimate.sizeComparisons.map(comparison => <p key={comparison.id} className="text-sm"><strong>{comparison.label}:</strong> {money(comparison.low)} – {money(comparison.high)} AUD / year ({comparison.headcountLow}–{comparison.headcountHigh} people).</p>)}</div>}
          <details className="text-xs text-[var(--muted)]"><summary className="cursor-pointer py-2">Assumptions and source calculations</summary><div className="space-y-2">{estimate.limitations.map(text => <p key={text}>{text}</p>)}<p>{estimate.benchmark!.sheet}: {estimate.benchmark!.cells}</p>{estimate.sizeComparisons.map(comparison => <p key={comparison.id}>{comparison.label}, {comparison.sheet}: {comparison.cells}</p>)}</div></details>
        </> : <p className="text-sm">EBITDA estimate unavailable: {estimate.reason}</p>}
      </div>
  );
}
