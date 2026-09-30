"use client";
import { useCallback, useState } from "react";
import { useActivePolling } from "./use-active-polling";
import { outreachEmail } from "@/domain/outreach-contact";
import { peopleRoleConflicts } from "@/domain/people-research";
import { evidenceLabel } from "@/domain/evidence-status";
import type { ResearchFinding } from "@/domain/research";
import { terminalResearchStates } from "@/domain/research";
import { buttonClass, jsonRequest } from "./mandate-workspace";
type Result = { active?: boolean; searchLeads?: import("@/domain/people-search-results").PeopleSearchLead[]; enabled: boolean; webSearchEnabled: boolean; jobs: { id: string; status: string; message: string; pages: number; config?: { targetedSearches?: string[]; runtime?: { remaining?: string[]; attempts?: { status: string; url: string; reason: string }[] } } }[]; findings: { id: string; sourceUrl: string; observedAt: string; confidence: number; evidence: ResearchFinding }[] };
export function PeopleSearch({ mandateId, targetId, onSaved }: { mandateId: string; targetId: string; onSaved: () => void }) {
  const [data, setData] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const url = `/api/targets/${targetId}/people-research`;
  const load = () => jsonRequest(`${url}?mandateId=${mandateId}`).then(setData);
  const refresh = useCallback(() => jsonRequest(`${url}?mandateId=${mandateId}`).then(setData).catch(() => setError("Could not refresh public web research. Reopen this company to retry.")), [url, mandateId]);
  useActivePolling(refresh, { active: Boolean(data?.active), intervalMs: 8000, key: `${url}:${mandateId}` });
  async function act(endpoint: string, body: unknown, saved = false) {
    setBusy(true); setError(""); setNotice("");
    try { const result = await jsonRequest(endpoint, body); await load(); if (saved) { onSaved(); setNotice(result.message || "Contact saved. Published details still need verification."); } }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const conflicts = peopleRoleConflicts(data?.findings.map(f => f.evidence) || []);
  const active = data?.jobs.find(j => !terminalResearchStates.includes(j.status));
  return <section className="space-y-3 rounded-lg border border-[var(--border)] p-4">
    <h3 className="font-semibold">Search public web · Cloudflare</h3>
    <p className="text-sm">Named decision-maker: {evidenceLabel(new Set((data?.findings || []).map(f => f.evidence.name.toLowerCase())).size, { searches: (data?.jobs || []).reduce((sum, j) => sum + (j.config?.targetedSearches?.length || 0), 0), researching: Boolean(active) })}</p>
    <p className="text-xs text-[var(--muted)]">Read company pages first, then use a targeted follow-up if a named owner or director is still missing. Review sources before saving a contact. Published emails are not delivery-verified.</p>
    <p className="text-xs text-[var(--muted)]">Up to 2 web searches, 5 pages and 5 AI calls. Runs in the background for up to 10 minutes; provider usage may incur charges.</p>
    {data && !data.webSearchEnabled && <p className="text-xs text-[var(--status-amber)]">Web search is unavailable. The agent can still follow the company website’s team and contact links.</p>}
    <button className={`${buttonClass} min-h-12`} disabled={busy || !data?.enabled || Boolean(active)} onClick={() => act(url, { action: "start", mandateId, requestId: crypto.randomUUID(), approved: true })}>{busy ? "Working…" : active ? "Research running…" : "Search public web"}</button>
    {!active && data?.jobs[0] && (data.jobs[0].config?.runtime?.remaining?.length || data.jobs[0].config?.runtime?.attempts?.some(a => a.status !== "read")) ? <button className={`${buttonClass} min-h-12`} disabled={busy || !data.enabled} onClick={() => act(url, { action: "start", mandateId, requestId: crypto.randomUUID(), continueFrom: data.jobs[0].id, approved: true })}>Continue / retry unread pages</button> : null}
    {data && !data.enabled && <p className="text-xs">Cloudflare research is not configured for this environment.</p>}
    {data?.jobs[0] && <div role="status" className="text-xs"><strong>{data.jobs[0].status}</strong> · {data.jobs[0].pages} pages read<p className="mt-1 text-[var(--muted)]">{data.jobs[0].message}</p></div>}
    {active && <div className="flex gap-3">{active.status === "queued" && <button className={buttonClass} disabled={busy} onClick={() => act(`/api/research/${active.id}`, { action: "retry-dispatch" })}>Reconnect</button>}<button className={buttonClass} disabled={busy} onClick={() => act(`/api/research/${active.id}`, { action: "cancel" })}>Cancel research</button></div>}
    {Boolean(data?.jobs[0]?.config?.runtime?.attempts?.length) && <details className="text-xs"><summary className="cursor-pointer">Pages checked</summary><ul className="mt-2 space-y-3">{data!.jobs[0].config!.runtime!.attempts!.map((attempt, index) => <li key={index}><a href={attempt.url} target="_blank" rel="noreferrer" className="break-all underline">{attempt.url}</a><p>{attempt.status} · {attempt.reason}</p></li>)}</ul></details>}
    {Boolean(conflicts.length) && <p role="status" className="text-sm text-[var(--status-amber)]">Sources name different people for {conflicts.join(", ")}. Check the source dates and current role before using a contact; none of these roles is confirmed current.</p>}
    {data?.findings.map(f => <article key={f.id} className="space-y-2 border-t border-[var(--border)] pt-3"><p className="font-semibold">{f.evidence.name}</p><p className="text-sm">{f.evidence.value}</p><blockquote className="text-xs text-[var(--muted)]">{f.evidence.quote}</blockquote><a className="block text-xs underline" href={f.sourceUrl} target="_blank" rel="noreferrer">View source · Retrieved {new Date(f.observedAt).toLocaleDateString("en-AU")}</a><p className="text-xs">Unverified lead · {Math.round(f.confidence * 100)}% confidence · {f.evidence.email ? `Published email: ${f.evidence.email}` : "No published direct work email"}</p><button disabled={busy || !outreachEmail(f.evidence.email)} className={`${buttonClass} min-h-12`} onClick={() => act(url, { action: "save", mandateId, findingId: f.id }, true)}>Add to People</button>{!outreachEmail(f.evidence.email) && <p className="text-xs text-[var(--muted)]">Enrich this person with Firmable to find an email before adding them to People.</p>}</article>)}
    {Boolean(data?.searchLeads?.length) && <div className="space-y-3 border-t border-[var(--border)] pt-3"><h4 className="font-semibold">Search leads · Needs verification</h4><p className="text-xs text-[var(--muted)]">Search results suggest these business connections. The linked pages and current roles still need verification before using them as contacts.</p>{data!.searchLeads!.map(lead => <article key={lead.url} className="space-y-2"><a href={lead.url} target="_blank" rel="noreferrer" className="text-sm underline">{lead.title}</a><p className="text-xs text-[var(--muted)]">{lead.snippet}</p><p className="text-xs">Search result observed {new Date(lead.observedAt).toLocaleDateString("en-AU")}</p></article>)}</div>}
    {data?.jobs.length && !active && !data.findings.length && !data.searchLeads?.length ? <p className="text-sm">No supported decision-maker found yet. Refresh the company data or add a sourced contact after speaking with the company.</p> : null}
    {notice && <p role="status" className="text-sm text-[var(--accent)]">{notice}</p>}{error && <p role="alert" className="text-sm text-[var(--status-red)]">{error}</p>}
  </section>;
}
