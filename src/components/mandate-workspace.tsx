"use client";

import { TargetResearchData, TargetEbitdaData } from "./target-research-data";
import { TargetReviewRow } from "./target-review-row";
import { BriefCriteria } from "./brief-criteria";
import { CompanyReviewPanel } from "./company-review-panel";
import { MandateTabs } from "./mandate-tabs";
import { shortlistRequest } from "@/domain/pipeline-board";
import { PipelineBoard } from "./pipeline-board";
import { businessResearchStatus } from "@/domain/business-research";
import { evidenceLabel, type EvidenceCounts } from "@/domain/evidence-status";
import { researchDomain, terminalResearchStates, type SavedResearchFinding, type ResearchConfig } from "@/domain/research";
import { ResearchPanel } from "./research-panel";

import { SidebarRegistration } from "./app-shell";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { AcquisitionBrief, criterionDefinitions, emptyBrief, type CoverageRun, type MandateView, type MembershipView, type ValuationObservation } from "@/domain/acquisition";
import { parseMandate } from "@/domain/mandate";
import { BuyerProfile } from "@/domain/buyer-profile";
import { BuyerProfileEditor } from "./buyer-profile-editor";

export const fieldClass = "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-2 text-sm text-[var(--foreground)]";
export const buttonClass = "rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--panel-raised)] disabled:opacity-40";
export const panelClass = "rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5";
type ContactSummary = { targetId: string; name: string; role: string | null; reachable: boolean };
export type WorkspaceData = { mandate: MandateView; memberships: MembershipView[]; coverage: CoverageRun[]; valuations: ValuationObservation[]; buyerProfile: BuyerProfile | null; contacts: ContactSummary[] };
export async function jsonRequest(url: string, body?: unknown) {
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
export function MandateNavigation({ mandates, selected, tab = "brief" }: { mandates: MandateView[]; selected?: string; tab?: string }) {
  return <SidebarRegistration value={{ mandates: mandates.map(m => ({ id: m.id, name: m.brief.name })), selected, tab }} />;
}

function captureBrief(current: AcquisitionBrief): AcquisitionBrief {
  const parsed = parseMandate(current.naturalLanguage);
  const values: Record<string, string> = {
    subsectors: parsed.sectors.join("; "), geography: parsed.states.join(", "),
    revenue: parsed.unknownFields?.includes("revenue") ? "" : `${parsed.revenue.min}${parsed.revenue.max === null ? "+" : `–${parsed.revenue.max}`}`,
    ebitda: parsed.unknownFields?.includes("ebitda") ? "" : `${parsed.ebitda.min}${parsed.ebitda.max === null ? "+" : `–${parsed.ebitda.max}`}`,
    headcount: parsed.headcount ? `${parsed.headcount.min}–${parsed.headcount.max}` : "",
  };
  // Explicit key:value lines preserve precise fields without guessing from prose.
  for (const [key, label] of criterionDefinitions) {
    const line = current.naturalLanguage.split("\n").find(l => l.toLowerCase().startsWith(`${key.toLowerCase()}:`) || l.toLowerCase().startsWith(`${label.toLowerCase()}:`));
    if (line) values[key] = line.slice(line.indexOf(":") + 1).trim();
  }
  return { ...current, criteria: current.criteria.map(c => values[c.key] ? { ...c, value: values[c.key], state: "specified", origin: "inferred", confirmed: false } : c) };
}
export function BriefEditor({ initial, onSave, busy }: { initial: AcquisitionBrief; onSave: (brief: AcquisitionBrief) => void; busy: boolean }) {
  const [brief, setBrief] = useState(initial);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  async function generateTestMandate() {
    setGenerating(true);
    setGenerationError("");
    try {
      const result = await jsonRequest("/api/mandates/generate", {});
      setBrief(result.brief);
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Could not generate a brief. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  const update = (key: keyof AcquisitionBrief, value: unknown) => setBrief(b => ({ ...b, [key]: value }));
  return <form onSubmit={e => { e.preventDefault(); onSave(brief); }} className="space-y-5"><fieldset disabled={generating} className="min-w-0 space-y-5"><div className={panelClass}><label className="text-sm">Mandate name<input required maxLength={100} className={fieldClass} value={brief.name} onChange={e => update("name", e.target.value)} /></label><label className="mt-4 block text-sm">Describe the acquisition brief<textarea className={`${fieldClass} min-h-28`} value={brief.naturalLanguage} onChange={e => update("naturalLanguage", e.target.value)} /></label><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => setBrief(captureBrief(brief))}>Extract draft criteria</button><button type="button" disabled={busy || generating} className={buttonClass} onClick={generateTestMandate}>{generating ? "Generating…" : "Generate test mandate"}</button></div>{generationError && <p role="alert" className="mt-2 text-sm text-[var(--status-red)]">{generationError}</p>}<p role="status" className="mt-2 text-xs text-[var(--muted)]">{generating ? "Creating a new acquisition brief with AI…" : "Generate a new AI test brief, then review and save it."}</p><p className="mt-2 text-xs text-[var(--muted)]">Review every extracted field. Unrecognised details stay in the original brief; enter them below. Separate alternative sub-sectors with semicolons. Use National or Australian states for geography.</p></div>
    <BriefCriteria criteria={brief.criteria} onChange={criteria => update("criteria", criteria)} />
    <div className={panelClass}><label className="block text-sm">Investment thesis for this mandate<textarea className={fieldClass} value={brief.investmentThesis} onChange={e => update("investmentThesis", e.target.value)} /></label><label className="mt-4 block text-sm">Approved outreach positioning<textarea className={fieldClass} value={brief.outreachPositioning} onChange={e => update("outreachPositioning", e.target.value)} /></label><p className="mt-2 text-xs text-[var(--muted)]">The private brief, financial criteria and investment thesis are not sent to the drafting provider.</p></div><button disabled={busy} className={`${buttonClass} bg-[var(--accent)] text-[var(--on-accent)]`}>{busy ? "Saving…" : "Save reviewed brief"}</button></fieldset></form>;
}
export function NewMandate({ mandates }: { mandates: MandateView[] }) {
  const router = useRouter(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <><MandateNavigation mandates={mandates} /><div className="space-y-5 p-5 sm:p-8"><h1 className="text-3xl font-semibold">Create a mandate</h1>{error && <p role="alert">{error}</p>}<BriefEditor initial={emptyBrief()} busy={busy} onSave={async brief => { setBusy(true); setError(""); try { const { id } = await jsonRequest("/api/mandates", brief); router.push(`/mandates/${id}`); router.refresh(); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }} /></div></>;
}
export function MandateWorkspace({ mandates, initial, tab }: { mandates: MandateView[]; initial: WorkspaceData; tab: string }) {
  const [data, setData] = useState(initial); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [selected, setSelected] = useState<string[]>([]); const [filter, setFilter] = useState(""); const [stage, setStage] = useState("all"); const [certFilter, setCertFilter] = useState("");
  const [reviewQueue, setReviewQueue] = useState<string[]>([]);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const id = data.mandate.id;
  const [research, setResearch] = useState<{findings: SavedResearchFinding[]; jobs: {status: string; seeds: string[]; config: ResearchConfig}[]; evidence?: Record<string, EvidenceCounts>}>({findings:[], jobs:[]});
  useEffect(() => {
    if (tab !== "targets" && tab !== "pipeline") return;
    let current = true;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const [next, evidence] = await Promise.all([jsonRequest(`/api/mandates/${id}`), jsonRequest(`/api/mandates/${id}/research`)]);
        if (current) { setData(next); setResearch(evidence); }
      } catch { /* Keep the last available view during a temporary connection failure. */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => { current = false; clearInterval(timer); };
  }, [id, tab]);
  const researchStatus = (m: MembershipView) => businessResearchStatus(m.target.domain, research.findings.filter(f => f.targetId === m.target.id || researchDomain(f.sourceUrl) === m.target.domain).map(f => f.evidence), research.jobs.some(j => !terminalResearchStates.includes(j.status) && [...j.seeds, ...j.config.seeds].some(url => researchDomain(url) === m.target.domain)));

  const [apolloProgress, setApolloProgress] = useState("");
  async function findKeyPeople() {
    const ids = [...selected];
    if (!ids.length || ids.length > 20 || busy) return;
    setBusy(true); setError(""); setNotice("");
    let saved = 0;
    const notes: string[] = [];
    try {
      for (const [index, targetId] of ids.entries()) {
        const company = data.memberships.find(m => m.target.id === targetId)?.target.companyName || "Company";
        setApolloProgress(`Searching ${index + 1}/${ids.length}: ${company}`);
        const result = await jsonRequest(`/api/mandates/${id}/apollo-people`, { targetId });
        saved += result.saved;
        if (!result.saved) notes.push(`${company}: ${result.message}`);
        notes.push(...(result.warnings || []));
        setData(await jsonRequest(`/api/mandates/${id}`));
      }
    } catch (e) { setError((e as Error).message); }
    finally { setNotice(`${saved} Apollo people saved for review. ${notes.join(" ")}`); setApolloProgress(""); setBusy(false); }
  }
  async function act(body: unknown) { setBusy(true); setError(""); setNotice(""); try { const result = await jsonRequest(`/api/mandates/${id}`, body); setData(await jsonRequest(`/api/mandates/${id}`)); setNotice(result.warnings?.join(" ") || "Saved."); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } }
  const filtered = data.memberships.filter(m => `${m.target.companyName} ${m.target.sector.value || ""}`.toLowerCase().includes(filter.toLowerCase()) && (stage === "all" || m.assessment.stage === stage) && (!certFilter || m.accreditations.some(a => `${a.issuer} ${a.scope}`.toLowerCase().includes(certFilter.toLowerCase()))));
  const openReview = (targetId: string) => { setReviewQueue(filtered.map(m => m.target.id)); setReviewId(targetId); };
  return <><MandateNavigation mandates={mandates.map(m => m.id === id ? data.mandate : m)} selected={id} tab={tab} /><div className="space-y-5 p-5 sm:p-8"><header><p className="text-xs uppercase tracking-widest text-[var(--accent)]">Acquisition workspace</p><h1 className="mt-2 text-3xl font-semibold">{data.mandate.brief.name}</h1><p className="mt-2 text-sm text-[var(--muted)]">{data.memberships.length} companies · {data.memberships.filter(m => m.assessment.stage === "shortlisted").length} shortlisted · {data.mandate.brief.criteria.filter(c => c.state === "unknown").length} unanswered brief criteria</p></header><MandateTabs mandateId={id} activeTab={tab} />{error && <p role="alert" className="rounded border border-red-400 p-3 text-[var(--status-red)]">{error}</p>}{notice && <p role="status" className="text-sm text-[var(--accent)]">{notice}</p>}
    {tab === "brief" && <><BriefEditor key={data.mandate.createdAt} initial={data.mandate.brief} busy={busy} onSave={brief => act({ action: "brief", brief })} /><BuyerProfileEditor initial={data.buyerProfile} onSaved={buyerProfile => setData(current => ({ ...current, buyerProfile }))} /></>}

    {tab === "pipeline" && <PipelineBoard mandateId={id} memberships={data.memberships} onReview={openReview} busy={busy} onShortlist={member => { const request = shortlistRequest(member); if (request) void act(request); }} />}
    {tab === "targets" && <><ResearchPanel mandateId={id} brief={data.mandate.brief} onResultsChanged={() => { void jsonRequest(`/api/mandates/${id}`).then(setData).catch(() => {}); }} /><div><h2 className="text-xl font-semibold">Targets</h2><button disabled={!filtered.length} className={`${buttonClass} mt-3 min-h-12`} onClick={() => openReview(filtered[0].target.id)}>Start review queue</button><p className="mt-2 text-sm text-[var(--muted)]">Screen and enrich the full company list. Open a company to review evidence, make a decision and find contacts in one place.</p></div><div className="flex flex-wrap items-end gap-3"><label className="flex-1 text-xs">Find company<input className={fieldClass} value={filter} onChange={e => setFilter(e.target.value)} /></label><label className="text-xs">Stage<select className={fieldClass} value={stage} onChange={e => setStage(e.target.value)}>{["all", "identified", "reviewing", "shortlisted", "outreach-approved", "contacted", "in-conversation", "qualified", "parked", "excluded"].map(s => <option key={s}>{s}</option>)}</select></label><label className="text-xs">Accreditation<input className={fieldClass} value={certFilter} onChange={e => setCertFilter(e.target.value)} /></label><div className="flex max-w-sm flex-col gap-2"><button className={buttonClass} disabled={busy || !selected.length || selected.length > 20} onClick={() => act({ action: "enrich", targetIds: selected })}>Update company data via Firmable ({selected.length}/20)</button><button className={`${buttonClass} min-h-12`} disabled={busy || !selected.length || selected.length > 20} onClick={findKeyPeople}>{apolloProgress ? "Finding key people…" : `Find key people via Apollo (${selected.length}/20)`}</button><p className="text-xs text-[var(--muted)]">Up to 5 people per company. Apollo enrichment may use credits. Roles and sale authority remain unconfirmed.</p>{apolloProgress && <p role="status" className="text-xs">{apolloProgress}</p>}</div></div><p className="text-xs text-[var(--muted)]">Each selected company may consume one enrichment credit. Unknowns stay on the list. Scores are provisional; use the worksheet to qualify.</p><div className="overflow-x-auto rounded-lg border border-[var(--border)]"><table className="w-full min-w-[1200px] text-left text-sm [&_td]:align-top"><thead className="bg-[var(--panel)]"><tr>{["Select", "Company", "Stage", "Fit", "Headcount", "Revenue (source currency)", "Estimated EBITDA (AUD)", "Key decision-makers", "Evidence"].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{filtered.map(m => <TargetReviewRow key={m.target.id} companyName={m.target.companyName} onReview={() => openReview(m.target.id)}><td className="p-3"><input aria-label={`Select ${m.target.companyName}`} type="checkbox" checked={selected.includes(m.target.id)} onChange={e => setSelected(s => e.target.checked ? [...s,m.target.id] : s.filter(id => id !== m.target.id))} /></td><td className="w-64 min-w-56 p-3"><button className="min-h-12 text-left font-semibold underline decoration-[var(--border)]" onClick={() => openReview(m.target.id)}>{m.target.companyName}</button><p className="mt-1 text-xs text-[var(--muted)]">{m.target.state} · {m.target.sector.value || "Classification unresolved"}</p><p className="mt-1 text-xs text-[var(--accent)]">{researchStatus(m)}</p><div className="mt-1 max-w-56 truncate text-xs"><CompanyWebsite domain={m.target.domain} /></div><details className="mt-1 text-xs"><summary className="min-h-12 cursor-pointer content-center underline decoration-[var(--border)]">Company details</summary><p>ABN: {m.target.abn || "Unknown"}</p><EvidenceChips summary={research.evidence?.[m.target.id]} /></details></td><td className="p-3">{m.assessment.stage}</td><td className="p-3">{m.target.scores.fit}</td><td className="p-3"><TargetResearchData findings={m.researchFindings} kind="headcount" fallback={m.target.headcount.value?.toLocaleString() ?? "Unknown"} /></td><td className="p-3"><TargetResearchData findings={m.researchFindings} kind="revenue" fallback={m.target.revenue.value == null ? "Unknown" : `${financialValue(m.target.revenue.value)} AUD`} /></td><td className="p-3"><TargetEbitdaData findings={m.researchFindings} /></td><td className="p-3"><TargetResearchData findings={m.researchFindings} kind="person" fallback={data.contacts.filter(c => c.targetId === m.target.id && c.name?.trim()).map(c => c.name).join(", ") || "Unknown"} /></td><td className="p-3">{m.assessment.evidence.filter(e => e.assessment !== "unknown").length}/{criterionDefinitions.length} tested</td></TargetReviewRow>)}</tbody></table>{!filtered.length && <p className="p-8 text-[var(--muted)]">No companies in this view. Use Find & research businesses above, or import sourced records.</p>}</div><ImportPanel busy={busy} onImport={records => act({ action: "import", records })} /></>}
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
function ImportPanel({ busy, onImport }: { busy: boolean; onImport: (records: unknown[]) => void }) {
  const [value, setValue] = useState(""); const [error, setError] = useState("");
  return <details className={panelClass}><summary className="cursor-pointer font-semibold">Import sourced register, web or provider records</summary><p className="mt-3 text-sm text-[var(--muted)]">Paste a JSON array. Each record needs name, website (or empty), abn (or empty), state, description, source, sourceUrl and sourceId. Keep records with missing size or identifiers for research.</p><textarea aria-label="Sourced records JSON" className={`${fieldClass} min-h-32 font-mono`} value={value} onChange={e => setValue(e.target.value)} />{error && <p role="alert">{error}</p>}<button className={`${buttonClass} mt-3`} disabled={busy || !value} onClick={() => { try { const records = JSON.parse(value); if (!Array.isArray(records)) throw new Error("Use a JSON array"); setError(""); onImport(records); } catch(e) { setError((e as Error).message); } }}>Import and retain candidates</button></details>;
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
