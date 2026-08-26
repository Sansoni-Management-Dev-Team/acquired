"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Building2, ChevronRight, CircleHelp, MapPin, Search, X } from "lucide-react";
import type { RankedTarget, ScoreBand } from "@/domain/models";

function money(value: number) {
  if (value >= 1_000_000_000) return `$${Number((value / 1_000_000_000).toFixed(1))}B`;
  if (value >= 1_000_000) return `$${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `$${Number((value / 1_000).toFixed(1))}K`;
  return `$${value}`;
}
const bands: (ScoreBand | "all")[] = ["all", "hot", "warm", "cold", "excluded"];

function Band({ value }: { value: ScoreBand }) {
  const classes = { hot: "border-lime-500/40 bg-lime-500/10 text-lime-300", warm: "border-amber-500/40 bg-amber-500/10 text-amber-300", cold: "border-sky-500/40 bg-sky-500/10 text-sky-300", excluded: "border-zinc-500/40 bg-zinc-500/10 text-zinc-400" };
  return <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[.16em] ${classes[value]}`}>{value}</span>;
}

function Qualification({ value }: { value: RankedTarget["scores"]["qualification"] }) {
  const classes = { priority: "border-white/50 bg-white text-black", develop: "border-amber-500/40 bg-amber-500/10 text-amber-300", research: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300", excluded: "border-zinc-700 bg-zinc-900 text-zinc-500" };
  return <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[.16em] ${classes[value]}`}>{value}</span>;
}

function Score({ label, value }: { label: string; value: number }) {
  return <div className="min-w-20"><div className="mb-1 flex justify-between text-[11px] text-[var(--muted)]"><span>{label}</span><strong className="text-white">{value}</strong></div><div className="h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-[var(--accent)]" style={{ width: `${value}%` }} /></div></div>;
}

function MissingValue({ reason }: { reason: string }) {
  return <span className="inline-flex items-center gap-1 text-xs italic text-[var(--muted)]"><CircleHelp size={12} />{reason}</span>;
}

function financial(value: RankedTarget["revenue"]["value"]) {
  if (value === null) return null;
  if (typeof value === "number") return money(value);
  if (value.kind === "range") return `${money(value.min)}–${money(value.max)}`;
  return value.label;
}

function Details({ target, close }: { target: RankedTarget; close: () => void }) {
  return <div className="fixed inset-0 z-20 flex justify-end bg-black/70" onMouseDown={close}>
    <section className="h-full w-full max-w-xl overflow-y-auto border-l border-[var(--border)] bg-[var(--panel)] p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between"><div><Band value={target.scores.band} /><h2 className="mt-4 text-2xl font-semibold">{target.companyName}</h2><p className="mt-1 flex items-center gap-1 text-sm text-[var(--muted)]"><MapPin size={14} />{target.suburb}, {target.state}</p></div><button aria-label="Close details" onClick={close} className="rounded-md border border-[var(--border)] p-2 hover:bg-white/5"><X size={18} /></button></div>
      <div className="mt-5 flex items-center gap-2"><Qualification value={target.scores.qualification} /><span className="text-xs text-[var(--muted)]">Opportunity qualification</span></div>
      <div className="my-7 grid grid-cols-2 gap-4 rounded-lg border border-[var(--border)] bg-black/15 p-4 sm:grid-cols-4"><Score label="Fit" value={target.scores.fit} /><Score label="Ripeness" value={target.scores.ripeness} /><Score label="Finance" value={target.scores.financeability ?? 0} /><Score label="Confidence" value={target.scores.confidence} /></div>
      {target.scores.tensions.length > 0 && <div className="mb-7 space-y-2">{target.scores.tensions.map((tension) => <p key={tension} className="rounded-md border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100">{tension}</p>)}</div>}
      <h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-[var(--muted)]">Firmographics</h3>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)]">
        {[["Revenue", target.revenue], ["EBITDA", target.ebitda], ["Headcount", target.headcount], ["Established", target.establishedYear]].map(([label, field]) => {
          const value = field as RankedTarget["revenue"];
          const shown = value.value === null ? <MissingValue reason={value.missingReason ?? "Unknown"} /> : (label === "Revenue" || label === "EBITDA") ? financial(value.value) : String(value.value);
          return <div key={label as string} className="bg-[var(--panel-raised)] p-3"><dt className="text-[11px] uppercase text-[var(--muted)]">{label as string}</dt><dd className="mt-1 text-sm">{shown}</dd><p className="mt-1 text-[10px] text-[var(--muted)]">Source: {value.provenance.source}</p></div>;
        })}
      </dl>
      <h3 className="mb-3 mt-8 text-xs font-bold uppercase tracking-[.16em] text-[var(--muted)]">Why this score</h3>
      <div className="space-y-2">{target.scores.reasons.map((reason, index) => <div key={`${reason.label}-${index}`} className="flex items-start justify-between gap-4 rounded-lg border border-[var(--border)] bg-black/10 p-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--muted)]">{reason.axis}</p><p className="mt-1 text-sm">{reason.label}</p><p className="mt-1 text-xs text-[var(--muted)]">{reason.source}</p></div><span className={reason.contribution > 0 ? "text-[var(--accent)]" : "text-red-300"}>{reason.contribution > 0 ? "+" : ""}{reason.contribution}</span></div>)}</div>
      <p className="mt-8 rounded-md border border-[var(--border)] p-3 text-xs leading-5 text-[var(--muted)]">Every value shown here retains its source and confidence. Missing values remain missing and reduce confidence; they are never imputed.</p>
    </section>
  </div>;
}

export function TargetsDashboard({ targets }: { targets: RankedTarget[] }) {
  const [band, setBand] = useState<ScoreBand | "all">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RankedTarget | null>(null);
  const filtered = useMemo(() => targets.filter((target) => (band === "all" || target.scores.band === band) && `${target.companyName} ${target.suburb} ${target.state} ${target.sector.value}`.toLowerCase().includes(query.toLowerCase())), [targets, band, query]);

  return <>
    <header className="border-b border-[var(--border)] px-5 py-6 sm:px-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--accent)]">Acquisition mandate · AU mechanical services</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Ranked targets</h1><p className="mt-2 text-sm text-[var(--muted)]">Evidence-led fit and succession readiness. Scores are deterministic.</p></div><div className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs text-[var(--muted)]"><span className="mr-2 inline-block size-2 rounded-full bg-amber-400" />Synthetic register · {targets.length} records</div></div></header>
    <div className="p-5 sm:p-8">
      <div className="mb-5 flex flex-wrap items-center gap-3"><label className="flex min-w-64 flex-1 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 text-sm focus-within:border-[var(--accent)]"><Search size={16} className="text-[var(--muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, location, sector" className="w-full bg-transparent outline-none placeholder:text-[var(--muted)]" /></label><div className="flex gap-1 rounded-md border border-[var(--border)] bg-[var(--panel)] p-1">{bands.map((item) => <button key={item} onClick={() => setBand(item)} className={`rounded px-3 py-1.5 text-xs capitalize ${band === item ? "bg-[var(--panel-raised)] text-white" : "text-[var(--muted)]"}`}>{item}</button>)}</div></div>
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]"><table className="w-full min-w-[1050px] border-collapse text-left"><thead className="bg-[var(--panel)] text-[10px] uppercase tracking-[.15em] text-[var(--muted)]"><tr><th className="px-4 py-3">Company</th><th className="px-4 py-3">Opportunity</th><th className="px-4 py-3">Fit</th><th className="px-4 py-3">Ripeness</th><th className="px-4 py-3">Finance</th><th className="px-4 py-3">Revenue</th><th className="px-4 py-3">Evidence</th><th /></tr></thead><tbody>{filtered.map((target) => <tr key={target.id} onClick={() => setSelected(target)} className="cursor-pointer border-t border-[var(--border)] bg-black/5 transition hover:bg-[var(--panel)]"><td className="px-4 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded bg-[var(--panel-raised)] text-[var(--muted)]"><Building2 size={16} /></span><div><strong className="block text-sm">{target.companyName}</strong><small className="text-[var(--muted)]">{target.suburb}, {target.state} · {target.sector.value}</small></div></div></td><td className="px-4 py-4"><Qualification value={target.scores.qualification} /></td><td className="px-4 py-4"><Score label="" value={target.scores.fit} /></td><td className="px-4 py-4"><Score label="" value={target.scores.ripeness} /></td><td className="px-4 py-4">{target.scores.financeability === null ? <MissingValue reason="Needs lender evidence" /> : <Score label="" value={target.scores.financeability} />}</td><td className="px-4 py-4 text-sm">{target.revenue.value === null ? <MissingValue reason={target.revenue.missingReason ?? "Unknown"} /> : financial(target.revenue.value)}</td><td className="px-4 py-4 text-sm"><span className="font-medium">{target.signals.length + target.scores.reasons.filter((reason) => reason.axis === "financeability").length}</span><span className="text-[var(--muted)]"> signals</span></td><td className="px-4 py-4"><ChevronRight size={17} className="text-[var(--muted)]" /></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="p-10 text-center text-sm text-[var(--muted)]">No targets match those filters.</div>}</div>
      <div className="mt-4 flex items-center justify-between text-xs text-[var(--muted)]"><span>Showing {filtered.length} of {targets.length} targets</span><a className="flex items-center gap-1 hover:text-white" href="/audit">Inspect ranking audit <ArrowUpRight size={13} /></a></div>
    </div>
    {selected && <Details target={selected} close={() => setSelected(null)} />}
  </>;
}
