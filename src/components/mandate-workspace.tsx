"use client";

import { TargetResearchData, TargetEbitdaData } from "./target-research-data";
import { CandidateResearchCells } from "./candidate-research-cells";
import { MandateFitCells } from "./mandate-fit-cells";
import { TargetReviewRow } from "./target-review-row";
import { CompanyReviewPanel } from "./company-review-panel";
import Link from "next/link";
import { mandateTabHref } from "@/domain/mandate-navigation";
import { businessResearchStatus } from "@/domain/business-research";
import { evidenceLabel, type EvidenceCounts } from "@/domain/evidence-status";
import { researchDomain, terminalResearchStates, type SavedResearchFinding } from "@/domain/research";
import { ResearchPanel, type ResearchJob, type ResearchPanelData } from "./research-panel";
import { MandateBriefForm } from "./mandate-brief-form";
import { candidateWebsites, orderCompanyRows, toggleMatchingTargets } from "@/domain/target-candidates";

import { SidebarRegistration } from "./app-shell";
import { useCallback, useState, useRef } from "react";
import { useActivePolling } from "./use-active-polling";
import { criterionDefinitions, type CoverageRun, type MandateView, type MembershipView, type ValuationObservation } from "@/domain/acquisition";
import { BuyerProfile } from "@/domain/buyer-profile";
import { COMPANY_DATA_SOURCE, isCompanyDataSource, providerNeutralText } from "@/domain/provider-display";

export const fieldClass = "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-2 text-sm text-[var(--foreground)]";
export const buttonClass = "rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--panel-raised)] disabled:opacity-40";
export const panelClass = "rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5";
type ContactSummary = { targetId: string; name: string; role: string | null; reachable: boolean };
type FirmableRefreshSummary = { id: string; targetId: string; status: string; profilesFound: number; profilesSaved: number; profilesFailed: number; message: string };
export type WorkspaceData = { mandate: MandateView; memberships: MembershipView[]; coverage: CoverageRun[]; valuations: ValuationObservation[]; buyerProfile: BuyerProfile | null; contacts: ContactSummary[]; firmableRefreshes: FirmableRefreshSummary[] };
export function CompanyDataAction({ selectedCount, busy, onClick }: { selectedCount: number; busy: boolean; onClick: () => void }) {
  return <div className="flex max-w-sm flex-col gap-2"><button className={buttonClass} disabled={busy || selectedCount === 0 || selectedCount > 20} onClick={onClick}>{selectedCount === 0 ? "Please select a company(s) first" : selectedCount > 20 ? `Select 20 or fewer businesses (${selectedCount} selected)` : `Find more company data (${selectedCount}/20)`}</button></div>;
}
export async function jsonRequest(url: string, body?: unknown) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await response.json();
  if (!response.ok) throw new Error(providerNeutralText(data.error || "Request failed"));
  return data;
}
export function MandateNavigation({ mandates, selected, tab = "brief" }: { mandates: MandateView[]; selected?: string; tab?: string }) {
  return <SidebarRegistration value={{ mandates: mandates.map(m => ({ id: m.id, name: m.brief.name })), selected, tab }} />;
}

export function MandateWorkspace({ mandates, initial, tab }: { mandates: MandateView[]; initial: WorkspaceData; tab: string }) {
  const [data, setData] = useState(initial); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [selected, setSelected] = useState<string[]>([]); const [filter, setFilter] = useState(""); const [stage, setStage] = useState("all"); const [certFilter, setCertFilter] = useState(""); const [researchFilter, setResearchFilter] = useState("all"); const [dataFilter, setDataFilter] = useState("all");
  const [reviewQueue, setReviewQueue] = useState<string[]>([]);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const id = data.mandate.id;
  const [research, setResearch] = useState<{findings: SavedResearchFinding[]; jobs: ResearchJob[]; evidence?: Record<string, EvidenceCounts>; active?: boolean}>({findings:[], jobs:[]});
  const refreshSequence = useRef(0);
  const activeFirmable = data.firmableRefreshes.filter(run => run.status === "queued" || run.status === "running");
  const visibleFirmable = data.firmableRefreshes.filter(run => activeFirmable.includes(run) || selected.includes(run.targetId));
  const polling = tab === "targets";
  const refresh = useCallback(async () => {
    if (!polling) return;
    const sequence = ++refreshSequence.current;
    try {
      const workspace = await jsonRequest(`/api/mandates/${id}`);
      if (sequence !== refreshSequence.current) return;
      setData(workspace);
    } catch { /* Keep the last usable workspace until the next refresh. */ }
  }, [id, polling]);
  // ResearchPanel owns research polling; refresh workspace data while company data is running.
  useActivePolling(refresh, { active: polling && activeFirmable.length > 0, intervalMs: 5000, key: `${id}:${tab}`, initial: false });
  const onResearchResults = useCallback((next: ResearchPanelData, changed: boolean) => {
    setResearch({ findings: next.findings, jobs: next.jobs, evidence: next.evidence, active: next.active });
    if (changed) void refresh();
  }, [refresh]);
  const researchStatus = (m: MembershipView) => businessResearchStatus(m.target.domain, research.findings.filter(f => f.targetId === m.target.id || researchDomain(f.sourceUrl) === m.target.domain).map(f => f.evidence), research.jobs.some(j => !terminalResearchStates.includes(j.status) && [...j.seeds, ...j.config.seeds].some(url => researchDomain(url) === m.target.domain)));

  async function act(body: unknown) { setBusy(true); setError(""); setNotice(""); try { const result = await jsonRequest(`/api/mandates/${id}`, body); setData(await jsonRequest(`/api/mandates/${id}`)); setNotice([...(result.messages || []), ...(result.warnings || [])].filter(Boolean).join(" ") || "Saved."); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }
  const search = filter.trim().toLowerCase();
  const hasData = (findings: SavedResearchFinding[] | undefined, kind: "headcount" | "revenue" | "person") => Boolean(findings?.some(finding => finding.evidence.kind === kind));
  const filtered = data.memberships.filter(m => {
    const status = researchStatus(m);
    return `${m.target.companyName} ${m.target.domain} ${m.target.sector.value || ""}`.toLowerCase().includes(search)
      && (stage === "all" || m.assessment.stage === stage)
      && (!certFilter || m.accreditations.some(a => `${a.issuer} ${a.scope}`.toLowerCase().includes(certFilter.toLowerCase())))
      && (researchFilter === "all" || researchFilter === "ready" && status === "Ready to review" || researchFilter === "researching" && status === "Researching" || researchFilter === "needs-evidence" && status === "Needs more evidence")
      && (dataFilter === "all" || dataFilter === "headcount" && (m.target.headcount.value !== null || hasData(m.researchFindings, "headcount")) || dataFilter === "revenue" && (m.target.revenue.value !== null || hasData(m.researchFindings, "revenue")) || dataFilter === "person" && (hasData(m.researchFindings, "person") || data.contacts.some(c => c.targetId === m.target.id && c.name?.trim())));
  });
  const candidates = candidateWebsites(research.jobs, research.findings, data.memberships).filter(candidate =>
    `${candidate.name} ${candidate.domain}`.toLowerCase().includes(search)
    && (stage === "all" || stage === "candidate")
    && !certFilter
    && (researchFilter === "all" || researchFilter === "queued" && candidate.status === "Queued" || researchFilter === "researching" && ["Reading website", "Extracting data", "Checking website", "Finding website"].includes(candidate.status) || researchFilter === "needs-evidence" && ["Checked", "Needs retry", "Stopped"].includes(candidate.status))
    && (dataFilter === "all" || hasData(candidate.findings, dataFilter === "person" ? "person" : dataFilter as "headcount" | "revenue"))
  );
  const companyRows = orderCompanyRows(candidates, filtered, data.contacts);
  const reviewIds = companyRows.flatMap(row => row.kind === "saved" ? [row.membership.target.id] : []);
  const matchingIds = filtered.map(m => m.target.id);
  const allMatchingSelected = matchingIds.length > 0 && matchingIds.every(targetId => selected.includes(targetId));
  const openReview = (targetId: string) => { setReviewQueue(reviewIds); setReviewId(targetId); };
  return <><MandateNavigation mandates={mandates.map(m => m.id === id ? data.mandate : m)} selected={id} tab={tab} /><div className="space-y-5 p-5 sm:p-8">{tab !== "brief" && <header><p className="text-xs uppercase tracking-widest text-[var(--accent)]">Acquisition workspace</p><h1 className="mt-2 text-3xl font-semibold">{data.mandate.brief.name}</h1></header>}{error && <p role="alert" className="rounded border border-red-400 p-3 text-[var(--status-red)]">{error}</p>}{notice && <p role="status" className="text-sm text-[var(--accent)]">{notice}</p>}
    {tab === "brief" && <MandateBriefForm mandateId={id} brief={data.mandate.brief} />}
    {tab === "targets" && <>
      <ResearchPanel mandateId={id} brief={data.mandate.brief} showStartAction={false} onResultsChanged={onResearchResults} />
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Companies</h2><Link className={buttonClass} href={mandateTabHref(id, "brief")}>Find businesses</Link></div>
        <p className="text-sm text-[var(--muted)]">Candidate websites appear here as they are found. Researched details fill in as businesses are saved.</p>
        <div className="flex flex-wrap items-center gap-3"><button disabled={!reviewIds.length} className={`${buttonClass} min-h-12`} onClick={() => openReview(reviewIds[0])}>Start review queue</button><p className="text-xs text-[var(--muted)]">{candidates.length} candidate websites · {filtered.length} saved businesses matching filters · {selected.length} selected</p></div>
      </section>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,2fr)_repeat(4,minmax(8rem,1fr))] xl:items-end">
        <label className="text-xs">Find company or website<input className={fieldClass} value={filter} onChange={e => setFilter(e.target.value)} placeholder="Name or domain" /></label>
        <label className="text-xs">Stage<select className={fieldClass} value={stage} onChange={e => setStage(e.target.value)}>{["all", "candidate", "identified", "reviewing", "shortlisted", "outreach-approved", "contacted", "in-conversation", "qualified", "parked", "excluded"].map(value => <option key={value} value={value}>{value === "all" ? "All stages" : value === "candidate" ? "Candidate websites" : value}</option>)}</select></label>
        <label className="text-xs">Research<select className={fieldClass} value={researchFilter} onChange={e => setResearchFilter(e.target.value)}><option value="all">All research states</option><option value="queued">Queued</option><option value="researching">Researching</option><option value="ready">Ready to review</option><option value="needs-evidence">Needs evidence</option></select></label>
        <label className="text-xs">Data found<select className={fieldClass} value={dataFilter} onChange={e => setDataFilter(e.target.value)}><option value="all">Any data</option><option value="headcount">Headcount</option><option value="revenue">Revenue</option><option value="person">Decision-maker</option></select></label>
        <label className="text-xs">Accreditation<input className={fieldClass} value={certFilter} onChange={e => setCertFilter(e.target.value)} placeholder="Issuer or scope" /></label>
      </div>
      <div className="flex flex-wrap items-center gap-3"><CompanyDataAction selectedCount={selected.length} busy={busy} onClick={() => act({ action: "enrich", targetIds: selected, requestId: crypto.randomUUID() })} />{selected.length > 0 && <button type="button" className="text-xs underline" onClick={() => setSelected([])}>Clear selection</button>}</div>
      {selected.length > 0 && <p className="text-xs text-[var(--muted)]">Company enrichment loads company data and every available person profile. Select up to 20 saved businesses; each may consume multiple credits.</p>}
      {visibleFirmable.length > 0 && <p role="status" className="text-sm text-[var(--accent)]">{visibleFirmable.map(run => `${data.memberships.find(item => item.target.id === run.targetId)?.target.companyName || "Company"}: ${providerNeutralText(run.message)}${run.profilesFound ? ` (${run.profilesSaved}/${run.profilesFound} profiles saved${run.profilesFailed ? `, ${run.profilesFailed} failed` : ""})` : ""}`).join(" · ")}</p>}
      <div className="overflow-x-auto rounded-lg border border-[var(--border)]"><table className="w-full min-w-[1520px] text-left text-sm [&_td]:align-top"><thead className="bg-[var(--panel)]"><tr>
        <th className="p-3"><label className="flex items-center gap-2"><input type="checkbox" aria-label="Select all matching businesses" disabled={!matchingIds.length} checked={allMatchingSelected} onChange={e => setSelected(current => toggleMatchingTargets(current, matchingIds, e.target.checked))} />Select</label></th>
        {["Company", "Stage", "Fit", "Reason for fit", "Headcount", "Revenue (source currency)", "Estimated EBITDA (AUD)", "Key decision-makers", "Evidence"].map(label => <th className="p-3" key={label}>{label}</th>)}
      </tr></thead><tbody>
        {companyRows.map(row => { if (row.kind === "candidate") return <tr key={`candidate:${row.candidate.domain}`} className="border-t border-[var(--border)] bg-[var(--panel-raised)]/40">
          <td className="p-3 text-xs text-[var(--muted)]">—</td>
          <td className="w-64 min-w-56 p-3"><p className="font-semibold">{row.candidate.name}</p><a className="mt-1 block break-all text-xs underline" href={row.candidate.url} target="_blank" rel="noreferrer">{row.candidate.domain}</a>{row.candidate.targetId && <Link className="mt-2 block text-xs underline" href={`/mandates/${id}/targets/${row.candidate.targetId}`}>View business</Link>}</td>
          <td className="p-3"><p>Candidate</p><p className="mt-1 text-xs text-[var(--muted)]">{row.candidate.status}</p></td>
          <td className="p-3 text-[var(--muted)]">Pending</td><td className="min-w-64 p-3 text-xs text-[var(--muted)]">Fit is assessed when the business is saved.</td>
          <CandidateResearchCells candidate={row.candidate} />
        </tr>;
        const m = row.membership;
        return <TargetReviewRow key={m.target.id} companyName={m.target.companyName} onReview={() => openReview(m.target.id)}>
          <td className="p-3"><input aria-label={`Select ${m.target.companyName}`} type="checkbox" checked={selected.includes(m.target.id)} onChange={e => setSelected(current => e.target.checked ? [...new Set([...current, m.target.id])] : current.filter(targetId => targetId !== m.target.id))} /></td>
          <td className="w-64 min-w-56 p-3"><button className="min-h-12 text-left font-semibold underline decoration-[var(--border)]" onClick={() => openReview(m.target.id)}>{m.target.companyName}</button><p className="mt-1 text-xs text-[var(--muted)]">{m.target.state} · {m.target.sector.value || "Classification unresolved"}</p><p className="mt-1 text-xs text-[var(--accent)]">{researchStatus(m)}</p><div className="mt-1 max-w-56 truncate text-xs"><CompanyWebsite domain={m.target.domain} /></div><details className="mt-1 text-xs"><summary className="min-h-12 cursor-pointer content-center underline decoration-[var(--border)]">Company details</summary><p>ABN: {m.target.abn || "Unknown"}</p><EvidenceChips summary={research.evidence?.[m.target.id]} /></details></td>
          <td className="p-3">{m.assessment.stage}</td>
          <MandateFitCells brief={data.mandate.brief} member={m} />
          <td className="p-3"><TargetResearchData findings={m.researchFindings} kind="headcount" fallback={m.target.headcount.value?.toLocaleString() ?? "Unknown"} confirmedMissing={m.target.headcount.value === null && isCompanyDataSource(m.target.headcount.provenance.source) ? { label: "No data available", source: COMPANY_DATA_SOURCE } : undefined} preferred={m.target.headcount.value !== null && isCompanyDataSource(m.target.headcount.provenance.source) ? { value: m.target.headcount.value.toLocaleString("en-AU"), source: COMPANY_DATA_SOURCE, sourceUrl: m.target.headcount.provenance.sourceUrl } : undefined} /></td>
          <td className="p-3"><TargetResearchData findings={m.researchFindings} kind="revenue" fallback={m.target.revenue.value == null ? "Unknown" : `${financialValue(m.target.revenue.value)} AUD`} preferred={m.target.revenue.value !== null && isCompanyDataSource(m.target.revenue.provenance.source) ? { value: financialValue(m.target.revenue.value), source: COMPANY_DATA_SOURCE, sourceUrl: m.target.revenue.provenance.sourceUrl } : undefined} /></td>
          <td className="p-3"><TargetEbitdaData findings={m.researchFindings} preferredHeadcount={m.target.headcount.value !== null && isCompanyDataSource(m.target.headcount.provenance.source) ? m.target.headcount.value : undefined} /></td>
          <td className="p-3"><TargetResearchData findings={m.researchFindings} kind="person" fallback={data.contacts.filter(c => c.targetId === m.target.id && c.name?.trim()).map(c => c.name).join(", ") || "Unknown"} /></td>
          <td className="p-3">{m.assessment.evidence.filter(e => e.assessment !== "unknown").length}/{criterionDefinitions.length} tested</td>
        </TargetReviewRow>; })}
        {!candidates.length && !filtered.length && <tr><td colSpan={10} className="p-8 text-[var(--muted)]">{data.memberships.length || research.jobs.length ? "No businesses match these filters. Try a different name or filter." : <>No companies yet. <Link className="underline" href={mandateTabHref(id, "brief")}>Find businesses or import sourced records in Brief</Link> to start your review.</>}</td></tr>}
      </tbody></table></div>
    </>}
  </div>{reviewId && data.memberships.find(m => m.target.id === reviewId) && <CompanyReviewPanel key={reviewId} mandate={data.mandate} initial={data.memberships.find(m => m.target.id === reviewId)!} position={`Company ${reviewQueue.indexOf(reviewId) + 1} of ${reviewQueue.length}`} onClose={() => setReviewId(null)} onChanged={async () => setData(await jsonRequest(`/api/mandates/${id}`))} onNext={reviewQueue.indexOf(reviewId) < reviewQueue.length - 1 ? () => setReviewId(reviewQueue[reviewQueue.indexOf(reviewId) + 1]) : undefined} />}</>;
}
function EvidenceChips({ summary }: { summary?: EvidenceCounts }) {
  const state = summary || { searches: 0, researching: false, snippetEstimates: 0 };
  return <p className="mt-1 text-xs text-[var(--muted)]">Size: {evidenceLabel(summary?.headcount || 0, state, summary?.conflicts.includes("headcount"))} · Decision-maker: {evidenceLabel(summary?.person || 0, state)}</p>;
}
export function CoveragePanel({ data }: { data: WorkspaceData }) {
  const all = data.memberships;
  const classified = all.filter(m => m.assessment.evidence.some(e => e.criterionKey === "subsectors" && e.assessment === "supported"));
  const sized = classified.filter(m => m.target.revenue.value !== null || m.target.headcount.value !== null);
  const named = sized.filter(m => data.contacts.some(c => c.targetId === m.target.id && /owner|founder|director|principal/i.test(c.role || "") && c.name));
  const reachable = named.filter(m => data.contacts.some(c => c.targetId === m.target.id && /owner|founder|director|principal/i.test(c.role || "") && c.reachable));
  return <><div className="grid gap-3 md:grid-cols-5">{[["Entities", all.length], ["Sub-sector confirmed", classified.length], ["Size populated", sized.length], ["Named owner / principal", named.length], ["Reachable contact", reachable.length]].map(([label,count]) => <div className={panelClass} key={label}><p className="text-2xl font-semibold">{count}</p><p className="mt-2 text-xs text-[var(--muted)]">{label}</p></div>)}</div><p className="text-xs text-[var(--muted)]">Sequential funnel for this mandate. Contact roles require review; size may be modelled. No national coverage percentage is claimed.</p><div className={panelClass}><h2 className="text-xl font-semibold">Source coverage history</h2>{!data.coverage.length && <p className="mt-3 text-sm text-[var(--muted)]">No sources searched yet.</p>}{data.coverage.map(run => <div key={run.id} className="mt-5 overflow-x-auto"><p className="mb-2 text-xs text-[var(--muted)]">{`${run.createdAt.slice(0, 16).replace("T", " ")} UTC`}</p><table className="w-full min-w-[700px] text-left text-sm"><thead><tr>{["Source", "Status", "Records", "Unique additions", "Overlap", "Scope / gaps"].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{run.sources.map(s => <tr key={s.name} className="border-t border-[var(--border)]"><td className="p-2">{s.name}</td><td className="p-2">{s.status}</td><td className="p-2">{s.discovered}</td><td className="p-2">{s.unique}</td><td className="p-2">{s.overlap}</td><td className="max-w-md p-2 text-xs text-[var(--muted)]">{s.note}</td></tr>)}</tbody></table></div>)}</div></>;
}
function CompanyWebsite({ domain }: { domain?: string }) {
  let url: URL | null = null;
  try { if (domain) url = new URL(domain.includes(":") ? domain : `https://${domain}`); } catch { /* Unknown website. */ }
  if (!url || !["https:", "http:"].includes(url.protocol) || !url.hostname.includes(".") || url.username || url.password) return <>Unknown</>;
  return <a href={url.href} target="_blank" rel="noreferrer" className="underline">{url.hostname}</a>;
}
function financialValue(value: NonNullable<MembershipView["target"]["revenue"]["value"]>) {
  const money = (amount: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
  return typeof value === "number" ? money(value) : value.kind === "range" ? `${money(value.min)}–${money(value.max)}` : value.label;
}
