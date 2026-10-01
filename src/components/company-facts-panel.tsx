"use client";
import { resolveCompanyField } from "@/domain/research-resolution";
import { evidenceLabel, summariseEvidence } from "@/domain/evidence-status";
import { useCallback, useState } from "react";
import { useActivePolling } from "./use-active-polling";
import { terminalResearchStates, type SavedResearchFinding } from "@/domain/research";
import { EbitdaEstimatePanel } from "./ebitda-estimate-panel";
type Data = { enabled: boolean; active?: boolean; jobs: { id: string; status: string; message: string; config?: { targetedSearches?: string[] } }[]; findings: SavedResearchFinding[] };
const button = "min-h-12 rounded-md border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-40";
export function CompanyFactsPanel({ targetId, mandateId, preferredHeadcount }: { targetId: string; mandateId: string; preferredHeadcount?: number }) {
  const [data, setData] = useState<Data>(), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const url = `/api/targets/${targetId}/company-research`;
  const refresh = useCallback(async () => {
    const response = await fetch(`${url}?mandateId=${mandateId}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load company details");
    setData(result);
  }, [url, mandateId]);
  const load = useCallback(() => refresh().catch(e => setError(e.message)), [refresh]);
  useActivePolling(load, { active: Boolean(data?.active), intervalMs: 5000 });
  const active = data?.jobs.find(j => !terminalResearchStates.includes(j.status));
  async function act(action: "start" | "cancel" | "retry-dispatch") {
    setBusy(true); setError("");
    try {
      const response = await fetch(action === "start" ? url : `/api/research/${active!.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "start" ? { action, mandateId, requestId: crypto.randomUUID(), approved: true } : { action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Research request failed");
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const findings = [...new Map((data?.findings || []).map(f => [JSON.stringify([f.sourceUrl, f.evidence.kind, f.evidence.value, f.evidence.quote]), f])).values()];
  return <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
    <h3 className="font-semibold">Company details &amp; estimated EBITDA</h3>
    {error && <p role="alert" className="text-sm text-[var(--status-red)]">{error}</p>}
    {!data ? <p role="status">Loading company details…</p> : <>
      {data.enabled && <div className="space-y-2">
        {active ? <><p role="status" className="text-sm">{active.message}</p><button className={button} disabled={busy} onClick={() => act("cancel")}>Stop company research</button>{active.status === "queued" && <button className={button} disabled={busy} onClick={() => act("retry-dispatch")}>Reconnect job</button>}</> : <><button className={button} disabled={busy} onClick={() => act("start")}>Research company details</button><p className="text-xs text-[var(--muted)]">Research public websites and profiles: up to 8 page attempts and 4 targeted web searches over 10 minutes; searching continues until a sourced headcount is found or the searches run out. Company name, website and page content are shared with research providers; usage may incur charges.</p>{data.jobs[0] && <p className="text-sm">{data.jobs[0].message}</p>}</>}
      </div>}
      <CompanyEvidenceSummary findings={findings} searches={(data?.jobs || []).reduce((sum, j) => sum + (j.config?.targetedSearches?.length || 0), 0)} researching={Boolean(active)} />
      {findings.some(f => f.evidence.kind === "company_relationship") && <p className="text-sm">A group or brand relationship was found. Check whether these figures cover the target business or a wider group.</p>}
      {!findings.length ? <p className="text-sm">No supported company details found yet.</p> : <ul className="space-y-3">{findings.map(f => <li key={f.id} className="text-sm"><strong>{f.evidence.name}:</strong> {f.evidence.value}<blockquote className="mt-1 text-[var(--muted)]">{f.evidence.quote}</blockquote><a className="underline" href={f.sourceUrl} target="_blank" rel="noreferrer">Source</a><span className="text-xs text-[var(--muted)]"> · Retrieved {new Date(f.observedAt).toLocaleDateString()} · {f.evidence.factMetadata?.basis === "search_snippet" ? "Search-result estimate (unverified)" : f.evidence.factMetadata?.basis === "third_party_estimate" ? "Third-party estimate" : "Published statement"}{f.evidence.factMetadata?.identityNote ? ` · ${f.evidence.factMetadata.identityNote}` : ""} · Scope: {f.evidence.factMetadata?.scope || "unspecified"} · Reporting period: {f.evidence.factMetadata?.period || "unknown"}{f.evidence.kind === "revenue" && ` · Currency: ${f.evidence.factMetadata?.currency || "unspecified"}`}</span></li>)}</ul>}
      <EbitdaEstimatePanel key={targetId} findings={findings} preferredHeadcount={preferredHeadcount} />
    </>}
  </section>;
}

export function CompanyEvidenceSummary({ findings, searches, researching = false }: { findings: SavedResearchFinding[]; searches: number; researching?: boolean }) {
  const summary = summariseEvidence(findings, { searches, researching });
  const headcount = resolveCompanyField("size", findings.map(f => f.evidence));
  const revenue = resolveCompanyField("revenue", findings.map(f => f.evidence));
  return <>
    <dl className="grid gap-1 text-sm sm:grid-cols-2"><div><dt className="text-xs text-[var(--muted)]">Headcount</dt><dd>{headcount.status === "observed" && <span>{headcount.selected?.value} · </span>}{evidenceLabel(summary.headcount, { ...summary, researchState: summary.headcountState })}</dd></div><div><dt className="text-xs text-[var(--muted)]">Revenue</dt><dd>{revenue.status === "observed" && <span>{revenue.selected?.value} · </span>}{evidenceLabel(summary.revenue, { ...summary, researchState: summary.revenueState })}</dd></div></dl>
    {summary.conflicts.length > 0 && <p role="status" className="text-sm">Sources disagree on {summary.conflicts.join(" and ")}. Review the separate observations before screening this business.</p>}
  </>;
}
