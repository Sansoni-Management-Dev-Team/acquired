"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Building2, ChevronRight, CircleHelp, LoaderCircle, MapPin, Search, X } from "lucide-react";
import type { LiveSearchSummary } from "@/adapters/live-target-search";
import type { BusinessResultLimit } from "@/adapters/google-places-client";
import type { RankedTarget, ScoreBand } from "@/domain/models";
import { mergeRankedTargets } from "@/domain/merge-targets";

function money(value: number) {
  if (value >= 1_000_000_000) return `$${Number((value / 1_000_000_000).toFixed(1))}B`;
  if (value >= 1_000_000) return `$${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `$${Number((value / 1_000).toFixed(1))}K`;
  return `$${value}`;
}
const bands: (ScoreBand | "all")[] = ["all", "hot", "warm", "cold", "excluded"];
const initialSearch = "I'm looking to buy an industrials or building-services business in Melbourne doing $2–20m revenue with at least $1m EBITDA.";
const resultLimits: Array<{ value: BusinessResultLimit; label: string }> = [
  { value: 1, label: "1" }, { value: 3, label: "3" }, { value: 5, label: "5" }, { value: 10, label: "10" }, { value: "max", label: "Max (20)" },
];
type SearchResponse = { targets: RankedTarget[]; summary: LiveSearchSummary; effectiveLimit: number; error?: string };

function Band({ value }: { value: ScoreBand }) {
  const classes = { hot: "border-lime-500/40 bg-lime-500/10 text-[var(--status-lime)]", warm: "border-amber-500/40 bg-amber-500/10 text-[var(--status-amber)]", cold: "border-sky-500/40 bg-sky-500/10 text-[var(--status-sky)]", excluded: "border-zinc-500/40 bg-zinc-500/10 text-[var(--status-zinc)]" };
  return <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[.16em] ${classes[value]}`}>{value}</span>;
}

function Qualification({ value }: { value: RankedTarget["scores"]["qualification"] }) {
  const classes = { priority: "border-[var(--foreground)]/50 bg-[var(--accent)] text-[var(--on-accent)]", develop: "border-amber-500/40 bg-amber-500/10 text-[var(--status-amber)]", research: "border-zinc-500/40 bg-zinc-500/10 text-[var(--status-zinc)]", excluded: "border-[var(--border)] bg-[var(--panel)] text-[var(--status-zinc)]0" };
  return <span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-[.16em] ${classes[value]}`}>{value}</span>;
}

function Score({ label, value }: { label: string; value: number }) {
  return <div className="min-w-20"><div className="mb-1 flex justify-between text-[11px] text-[var(--muted)]"><span>{label}</span><strong className="text-[var(--foreground)]">{value}</strong></div><div className="h-1 overflow-hidden rounded bg-[var(--accent)]/10"><div className="h-full bg-[var(--accent)]" style={{ width: `${value}%` }} /></div></div>;
}

function MissingValue({ reason }: { reason: string }) {
  return <span className="inline-flex items-center gap-1 text-xs italic text-[var(--muted)]"><CircleHelp size={12} />{reason}</span>;
}

function SourceField({ label, value, href }: { label: string; value?: string | number | null; href?: string }) {
  const shown = value === undefined || value === null || value === "" ? "Not provided" : String(value);
  return <div className="min-w-0 border-t border-[var(--border)] py-3 first:border-t-0"><dt className="text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--muted)]">{label}</dt><dd className="mt-1 break-words text-sm">{href && value ? <a href={href} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline decoration-white/20 underline-offset-4 hover:text-[var(--foreground)]">{shown}</a> : shown}</dd></div>;
}

function SourceList({ label, values }: { label: string; values?: string[] }) {
  return <div className="border-t border-[var(--border)] py-3 first:border-t-0"><dt className="text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--muted)]">{label}</dt><dd className="mt-2 flex flex-wrap gap-1.5">{values?.length ? values.map((value) => <span key={value} className="rounded-full border border-[var(--border)] bg-[var(--accent)]/[.03] px-2 py-1 text-xs text-[var(--status-zinc)]">{value}</span>) : <span className="text-sm text-[var(--muted)]">Not provided</span>}</dd></div>;
}

function SourceData({ target }: { target: RankedTarget }) {
  const google = target.sourceData?.googlePlaces;
  const directory = target.sourceData?.manufacturingDirectory;
  const firmable = target.sourceData?.firmable;
  if (!google && !directory && !firmable) return null;
  return <>
    <h3 className="mb-3 mt-8 text-xs font-bold uppercase tracking-[.16em] text-[var(--muted)]">Source data</h3>
    <div className="grid gap-3 lg:grid-cols-2">
      {google && <section className="rounded-lg border border-[var(--border)] bg-black/10 p-4">
        <div className="mb-2 flex items-center justify-between gap-3"><h4 className="text-sm font-semibold">Google Places</h4><span className="rounded-full border border-sky-400/25 bg-sky-400/5 px-2 py-1 text-[9px] font-bold uppercase tracking-[.14em] text-[var(--status-sky)]">Discovery</span></div>
        <dl><SourceField label="Place ID" value={google.placeId} /><SourceField label="Listed name" value={google.name} /><SourceField label="Formatted address" value={google.formattedAddress} /><SourceField label="Primary type" value={google.primaryType} /><SourceList label="Place types" values={google.types} /><SourceField label="Website" value={google.website} href={google.website} /></dl>
      </section>}
      {directory && <section className="rounded-lg border border-[var(--border)] bg-black/10 p-4">
        <div className="mb-2 flex items-center justify-between gap-3"><h4 className="text-sm font-semibold">Manufacturing sources</h4><span className="rounded-full border border-amber-400/25 bg-amber-400/5 px-2 py-1 text-[9px] font-bold uppercase tracking-[.14em] text-[var(--status-amber)]">Discovery</span></div>
        <dl>
          <SourceField label="Directory ID" value={directory.recordId} />
          <SourceField label="Listed name" value={directory.name} />
          <SourceField label="Address" value={directory.address} />
          <SourceField label="Phone" value={directory.phone} />
          <SourceField label="Email" value={directory.email} />
          <SourceField label="Website" value={directory.website} href={directory.website} />
          <SourceField label="ABN" value={directory.abn} />
          <SourceField label="Identifier evidence" value={directory.identifierEvidence ? `${directory.identifierEvidence.confidence}% confidence` : undefined} href={directory.identifierEvidence?.sourceUrl} />
          <SourceField label="Description" value={directory.description} />
          <SourceList label="Categories" values={directory.categories} />
          <SourceList label="Keywords" values={directory.keywords} />
          <SourceList label="Capabilities" values={directory.capabilities} />
          <SourceList label="Sources" values={[...new Set(directory.sourceRecords.map((record) => record.source))]} />
          <SourceField label="Manufacturing confidence" value={directory.manufacturingConfidence} />
          <SourceField label="Manufacturing evidence score" value={directory.manufacturingScore} />
        </dl>
      </section>}
      <section className="rounded-lg border border-[var(--border)] bg-black/10 p-4">
        <div className="mb-2 flex items-center justify-between gap-3"><h4 className="text-sm font-semibold">Firmable</h4><span className="rounded-full border border-lime-400/25 bg-lime-400/5 px-2 py-1 text-[9px] font-bold uppercase tracking-[.14em] text-[var(--status-lime)]">Enrichment</span></div>
        {firmable ? <dl>
          <SourceField label="Firmable ID" value={firmable.firmableId} />
          <SourceField label="Company name" value={firmable.name} />
          <SourceField label="Domain" value={firmable.domain} />
          <SourceField label="Website" value={firmable.website} href={firmable.website} />
          <SourceField label="Description" value={firmable.description} />
          <SourceField label="Tagline" value={firmable.tagline} />
          <SourceField label="Company type" value={firmable.companyType} />
          <SourceField label="Company size" value={firmable.companySize} />
          <SourceField label="Revenue band" value={firmable.revenueBand} />
          <SourceField label="AU employee count" value={firmable.employeeCount} />
          <SourceField label="Year founded" value={firmable.yearFounded} />
          <SourceField label="Headquarters" value={firmable.headquarters} />
          <SourceField label="ABN" value={firmable.abn} />
          <SourceField label="ACN" value={firmable.acn} />
          <SourceField label="ANZSIC" value={firmable.anzsic} />
          <SourceField label="ABN status" value={firmable.abnStatus} />
          <SourceField label="LinkedIn" value={firmable.linkedin} href={firmable.linkedin?.startsWith("http") ? firmable.linkedin : undefined} />
          <SourceList label="Industries" values={firmable.industries} />
          <SourceList label="States" values={firmable.states} />
          <SourceList label="Locations" values={firmable.locations} />
          <SourceList label="Keywords" values={firmable.keywords} />
        </dl> : <p className="mt-4 text-sm leading-6 text-[var(--muted)]">Firmable enrichment was unavailable for this company identifier.</p>}
      </section>
    </div>
  </>;
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
      <div className="flex items-start justify-between"><div><Band value={target.scores.band} /><h2 className="mt-4 text-2xl font-semibold">{target.companyName}</h2><p className="mt-1 flex items-center gap-1 text-sm text-[var(--muted)]"><MapPin size={14} />{target.suburb}, {target.state}</p></div><button aria-label="Close details" onClick={close} className="rounded-md border border-[var(--border)] p-2 hover:bg-[var(--accent)]/5"><X size={18} /></button></div>
      <div className="mt-5 flex items-center gap-2"><Qualification value={target.scores.qualification} /><span className="text-xs text-[var(--muted)]">Opportunity qualification</span></div>
      <div className="my-7 grid grid-cols-2 gap-4 rounded-lg border border-[var(--border)] bg-[var(--input)] p-4 sm:grid-cols-4"><Score label="Fit" value={target.scores.fit} /><Score label="Ripeness" value={target.scores.ripeness} />{target.scores.financeability === null ? <div><p className="mb-1 text-[11px] text-[var(--muted)]">Finance</p><MissingValue reason="Unscored" /></div> : <Score label="Finance" value={target.scores.financeability} />}<Score label="Confidence" value={target.scores.confidence} /></div>
      {target.scores.tensions.length > 0 && <div className="mb-7 space-y-2">{target.scores.tensions.map((tension) => <p key={tension} className="rounded-md border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-[var(--status-amber)]">{tension}</p>)}</div>}
      <h3 className="mb-3 text-xs font-bold uppercase tracking-[.16em] text-[var(--muted)]">Firmographics</h3>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)]">
        {[["Revenue", target.revenue], ["EBITDA", target.ebitda], ["Headcount", target.headcount], ["Established", target.establishedYear]].map(([label, field]) => {
          const value = field as RankedTarget["revenue"];
          const shown = value.value === null ? <MissingValue reason={value.missingReason ?? "Unknown"} /> : (label === "Revenue" || label === "EBITDA") ? financial(value.value) : String(value.value);
          return <div key={label as string} className="bg-[var(--panel-raised)] p-3"><dt className="text-[11px] uppercase text-[var(--muted)]">{label as string}</dt><dd className="mt-1 text-sm">{shown}</dd><p className="mt-1 text-[10px] text-[var(--muted)]">Source: {value.provenance.source}</p></div>;
        })}
      </dl>
      <SourceData target={target} />
      <h3 className="mb-3 mt-8 text-xs font-bold uppercase tracking-[.16em] text-[var(--muted)]">Why this score</h3>
      <div className="space-y-2">{target.scores.reasons.map((reason, index) => <div key={`${reason.label}-${index}`} className="flex items-start justify-between gap-4 rounded-lg border border-[var(--border)] bg-black/10 p-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[var(--muted)]">{reason.axis}</p><p className="mt-1 text-sm">{reason.label}</p><p className="mt-1 text-xs text-[var(--muted)]">{reason.source}</p></div><span className={reason.contribution > 0 ? "text-[var(--accent)]" : "text-[var(--status-red)]"}>{reason.contribution > 0 ? "+" : ""}{reason.contribution}</span></div>)}</div>
      <p className="mt-8 rounded-md border border-[var(--border)] p-3 text-xs leading-5 text-[var(--muted)]">Every value shown here retains its source and confidence. Missing values remain missing and reduce confidence; they are never imputed.</p>
    </section>
  </div>;
}

export function TargetsDashboard({ initialTargets = [], providerMode = "live" }: { initialTargets?: RankedTarget[]; providerMode?: "fixture" | "live" }) {
  const [targets, setTargets] = useState<RankedTarget[]>(initialTargets);
  const [band, setBand] = useState<ScoreBand | "all">("all");
  const [searchText, setSearchText] = useState(initialSearch);
  const [filterText, setFilterText] = useState("");
  const [limit, setLimit] = useState<BusinessResultLimit>(3);
  const [summary, setSummary] = useState<LiveSearchSummary | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<RankedTarget | null>(null);
  const filtered = useMemo(() => targets.filter((target) => (band === "all" || target.scores.band === band) && `${target.companyName} ${target.suburb} ${target.state} ${target.sector.value}`.toLowerCase().includes(filterText.toLowerCase())), [targets, band, filterText]);

  async function runSearch() {
    setSearching(true);
    setError("");
    try {
      const response = await fetch("/api/targets/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchText, limit }),
      });
      const result = await response.json() as SearchResponse;
      if (!response.ok) throw new Error(result.error || "Search failed");
      setTargets((current) => mergeRankedTargets(result.targets, current));
      setSummary(result.summary);
      setBand("all");
      setFilterText("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  return <>
    <header className="border-b border-[var(--border)] px-5 py-6 sm:px-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--accent)]">{providerMode === "fixture" ? "Fixture company discovery" : "Live company discovery"}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Search and enrich targets</h1><p className="mt-2 text-sm text-[var(--muted)]">{providerMode === "fixture" ? "Local fixtures exercise the Google Places and Firmable response pipeline without external requests." : "Google Places discovers businesses; manufacturing searches also use Australian Manufacturing, AMTIL and curated web discovery. Firmable enriches each company identifier."}</p></div><div className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs text-[var(--muted)]"><span className={`mr-2 inline-block size-2 rounded-full ${summary ? "bg-lime-400" : "bg-zinc-500"}`} />{summary ? `${summary.enriched} enriched · ${summary.discovered} discovered` : providerMode === "fixture" ? "Ready for fixture search" : "Ready for a live search"}</div></div></header>
    <div className="p-5 sm:p-8">
      <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5">
        <label htmlFor="target-search" className="text-xs font-bold uppercase tracking-[.15em] text-[var(--muted)]">Describe the businesses you want to find</label>
        <textarea id="target-search" value={searchText} onChange={(event) => setSearchText(event.target.value)} className="mt-3 min-h-24 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--input)] p-3 text-sm leading-6 outline-none focus:border-[var(--accent)]" />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--muted)]">Businesses to process<select value={String(limit)} onChange={(event) => setLimit(event.target.value === "max" ? "max" : Number(event.target.value) as BusinessResultLimit)} className="mt-1 block rounded-md border border-[var(--border)] bg-[var(--panel-raised)] px-3 py-2 text-sm text-[var(--foreground)] outline-none">{resultLimits.map((item) => <option key={String(item.value)} value={String(item.value)}>{item.label}</option>)}</select></label>
          <button disabled={searching || searchText.trim().length < 10} onClick={runSearch} className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-50">{searching ? <LoaderCircle size={16} className="animate-spin" /> : <Search size={16} />}{searching ? "Discovering and enriching…" : "Search & enrich"}</button>
          <p className="max-w-xl text-xs leading-5 text-[var(--muted)]">{providerMode === "fixture" ? "The selected cap exercises the same website filtering and enrichment limits against local fixtures. No Google or Firmable request is made." : "The selected cap controls website-backed results and Firmable calls. One Google request may scan up to 20 candidates to replace listings without websites. Each attempted Firmable enrichment may consume one credit."}</p>
        </div>
        {error && <p role="alert" className="mt-3 rounded-md border border-red-400/20 bg-red-400/5 p-3 text-sm text-[var(--status-red)]">{error}</p>}
        {summary && summary.manufacturingDirectoryDiscovered > 0 && <p className="mt-3 rounded-md border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-[var(--status-amber)]">Manufacturing search used {summary.googlePlacesDiscovered} Google Places candidates and {summary.manufacturingDirectoryDiscovered} directory candidates before deduplication and enrichment.</p>}
        {summary && (summary.withoutWebsite > 0 || summary.enrichmentFailed > 0) && <p className="mt-3 rounded-md border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-[var(--status-amber)]">{summary.withoutWebsite} result(s) without a website or ABN were skipped; {summary.enrichmentFailed} Firmable enrichment(s) failed. Businesses with failed enrichment remain visible with missing fields clearly marked.</p>}
      </section>
      {targets.length > 0 && <div className="mb-5 flex flex-wrap items-center gap-3"><label className="flex min-w-64 flex-1 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2.5 text-sm focus-within:border-[var(--accent)]"><Search size={16} className="text-[var(--muted)]" /><input value={filterText} onChange={(event) => setFilterText(event.target.value)} placeholder="Filter returned companies" className="w-full bg-transparent outline-none placeholder:text-[var(--muted)]" /></label><div className="flex gap-1 rounded-md border border-[var(--border)] bg-[var(--panel)] p-1">{bands.map((item) => <button key={item} onClick={() => setBand(item)} className={`rounded px-3 py-1.5 text-xs capitalize ${band === item ? "bg-[var(--panel-raised)] text-[var(--foreground)]" : "text-[var(--muted)]"}`}>{item}</button>)}</div></div>}
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]"><table className="w-full min-w-[1050px] border-collapse text-left"><thead className="bg-[var(--panel)] text-[10px] uppercase tracking-[.15em] text-[var(--muted)]"><tr><th className="px-4 py-3">Company</th><th className="px-4 py-3">Opportunity</th><th className="px-4 py-3">Fit</th><th className="px-4 py-3">Ripeness</th><th className="px-4 py-3">Finance</th><th className="px-4 py-3">Revenue</th><th className="px-4 py-3">Evidence</th><th /></tr></thead><tbody>{filtered.map((target) => <tr key={target.id} onClick={() => setSelected(target)} className="cursor-pointer border-t border-[var(--border)] bg-black/5 transition hover:bg-[var(--panel)]"><td className="px-4 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded bg-[var(--panel-raised)] text-[var(--muted)]"><Building2 size={16} /></span><div><strong className="block text-sm">{target.companyName}</strong><small className="text-[var(--muted)]">{target.suburb}, {target.state} · {target.sector.value}</small></div></div></td><td className="px-4 py-4"><Qualification value={target.scores.qualification} /></td><td className="px-4 py-4"><Score label="" value={target.scores.fit} /></td><td className="px-4 py-4"><Score label="" value={target.scores.ripeness} /></td><td className="px-4 py-4">{target.scores.financeability === null ? <MissingValue reason="Needs lender evidence" /> : <Score label="" value={target.scores.financeability} />}</td><td className="px-4 py-4 text-sm">{target.revenue.value === null ? <MissingValue reason={target.revenue.missingReason ?? "Unknown"} /> : financial(target.revenue.value)}</td><td className="px-4 py-4 text-sm"><span className="font-medium">{target.signals.length + target.scores.reasons.filter((reason) => reason.axis === "financeability").length}</span><span className="text-[var(--muted)]"> signals</span></td><td className="px-4 py-4"><ChevronRight size={17} className="text-[var(--muted)]" /></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="p-10 text-center text-sm text-[var(--muted)]">{targets.length === 0 ? "Run a live search to discover businesses." : "No targets match those filters."}</div>}</div>
      <div className="mt-4 flex items-center justify-between text-xs text-[var(--muted)]"><span>Showing {filtered.length} of {targets.length} targets</span><a className="flex items-center gap-1 hover:text-[var(--foreground)]" href="/audit">Inspect ranking audit <ArrowUpRight size={13} /></a></div>
    </div>
    {selected && <Details target={selected} close={() => setSelected(null)} />}
  </>;
}
