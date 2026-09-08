"use client";
import { useCallback, useEffect, useState } from "react";
import { terminalResearchStates, type SavedResearchFinding } from "@/domain/research";
import { ebitdaBenchmarks, estimateEbitda } from "@/domain/estimated-ebitda";
type Data = { enabled: boolean; jobs: { id: string; status: string; message: string }[]; findings: SavedResearchFinding[] };
const button = "min-h-12 rounded-md border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-40";
export function CompanyFactsPanel({ targetId, mandateId }: { targetId: string; mandateId: string }) {
  const [data, setData] = useState<Data>(), [error, setError] = useState(""), [busy, setBusy] = useState(false), [benchmark, setBenchmark] = useState("");
  const url = `/api/targets/${targetId}/company-research`;
  const refresh = useCallback(async () => {
    const response = await fetch(`${url}?mandateId=${mandateId}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load company details");
    setData(result);
  }, [url, mandateId]);
  useEffect(() => {
    const load = () => { void refresh().catch(e => setError(e.message)); };
    const first = setTimeout(load, 0), timer = setInterval(() => { if (!document.hidden) load(); }, 5000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [refresh]);
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
  const estimate = estimateEbitda(findings, benchmark || undefined);
  const money = (n: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
  return <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
    <h3 className="font-semibold">Company details &amp; estimated EBITDA</h3>
    {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
    {!data ? <p role="status">Loading company details…</p> : <>
      {data.enabled && <div className="space-y-2">
        {active ? <><p role="status" className="text-sm">{active.message}</p><button className={button} disabled={busy} onClick={() => act("cancel")}>Stop company research</button>{active.status === "queued" && <button className={button} disabled={busy} onClick={() => act("retry-dispatch")}>Reconnect job</button>}</> : <><button className={button} disabled={busy} onClick={() => act("start")}>Research company details</button><p className="text-xs text-[var(--muted)]">Cloudflare reads public websites and profiles: up to 5 page attempts, 5 AI calls and one web search over 10 minutes. Company name, website and page content are shared with research providers; usage may incur charges.</p>{data.jobs[0] && <p className="text-sm">{data.jobs[0].message}</p>}</>}
      </div>}
      {!findings.length ? <p className="text-sm">No supported company details found yet.</p> : <ul className="space-y-3">{findings.map(f => <li key={f.id} className="text-sm"><strong>{f.evidence.name}:</strong> {f.evidence.value}<blockquote className="mt-1 text-[var(--muted)]">{f.evidence.quote}</blockquote><a className="underline" href={f.sourceUrl} target="_blank" rel="noreferrer">Source</a><span className="text-xs text-[var(--muted)]"> · Retrieved {new Date(f.observedAt).toLocaleDateString()} · Source date and legal-entity scope unverified</span></li>)}</ul>}
      <label className="block text-sm">Comparable industry for EBITDA scenario<select className="mt-1 min-h-12 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-2" value={benchmark} onChange={e => setBenchmark(e.target.value)}><option value="">Use an exact sourced industry match</option>{ebitdaBenchmarks.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select></label>
      {estimate.status === "estimated" ? <div className="space-y-2 text-sm"><p><strong>Estimated EBITDA scenario: {money(estimate.low!)}{estimate.high !== estimate.low ? ` – ${money(estimate.high!)}` : ""} AUD</strong></p><p>Published headcount × {money(estimate.benchmark!.perPerson)} EBITDA per person. <a className="underline" href={estimate.benchmark!.sourceUrl} target="_blank" rel="noreferrer">ABS {estimate.benchmark!.period}</a>, {estimate.benchmark!.label}, {estimate.benchmark!.sheet} ({estimate.benchmark!.cells}).</p>{estimate.limitations.map(text => <p className="text-xs text-[var(--muted)]" key={text}>{text}</p>)}</div> : <p className="text-sm">EBITDA estimate unavailable: {estimate.reason}</p>}
    </>}
  </section>;
}
