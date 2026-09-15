"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { MandateView, MembershipView, Assessment } from "@/domain/acquisition";
import type { BuyerProfile } from "@/domain/buyer-profile";
import { PeopleSearch } from "./people-search";
import { CompanyFactsPanel } from "./company-facts-panel";
import { TargetWorksheet } from "./target-worksheet";
import { OutreachQueue, type OutreachTargetView } from "./outreach-queue";
import { TargetResearchEvidence } from "./research-panel";
import { buttonClass, fieldClass, jsonRequest, panelClass } from "./mandate-workspace";

type OutreachData = { canCompose?: boolean; views: OutreachTargetView[]; buyerProfile: BuyerProfile | null };
export function CompanyReviewPanel({ mandate, initial, onClose, onChanged, onNext, position }: { mandate: MandateView; initial: MembershipView; onClose: () => void; onChanged: () => Promise<void>; onNext?: () => void; position: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [member, setMember] = useState(initial);
  const [tab, setTab] = useState("review");
  const [reason, setReason] = useState(initial.assessment.reason);
  const [nextAction, setNextAction] = useState(initial.assessment.nextAction);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [outreachDirty, setOutreachDirty] = useState(false);
  const [worksheetDirty, setWorksheetDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [outreach, setOutreach] = useState<OutreachData>();
  const [worksheetOpened, setWorksheetOpened] = useState(false);
  useEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close(); }, []);
  async function refresh() {
    const [workspace, messages] = await Promise.all([jsonRequest(`/api/mandates/${mandate.id}`), jsonRequest(`/api/mandates/${mandate.id}/outreach`)]);
    setMember(workspace.memberships.find((m: MembershipView) => m.target.id === initial.target.id)); setOutreach(messages); await onChanged();
  }
  useEffect(() => { let live = true; void jsonRequest(`/api/mandates/${mandate.id}/outreach`).then(d => { if (live) setOutreach(d); }).catch(() => { if (live) setError("Could not load contact readiness. Try opening Contacts & drafts again."); }); return () => { live = false; }; }, [mandate.id]);
  function close() { if ((dirty || worksheetDirty || outreachDirty) && !window.confirm("Discard unsaved company review edits?")) return; onClose(); }
  function openTab(value: string) { setTab(value); dialog.current?.scrollTo({ top: 0 }); if (value === "details") setWorksheetOpened(true); if (value === "outreach") void jsonRequest(`/api/mandates/${mandate.id}/outreach`).then(setOutreach).catch(e => setError(e.message)); }
  async function decide(stage: Assessment["stage"], advance = false) {
    if (worksheetDirty) { setError("Save your worksheet changes first."); return; }
    if (["parked", "excluded"].includes(stage) && !reason.trim()) { setError("Add a reason before parking or excluding this company."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      await jsonRequest(`/api/mandates/${mandate.id}`, { action: "assessment", targetId: member.target.id, version: member.version, assessment: { ...member.assessment, stage, reason, nextAction } });
      setDirty(false); await refresh(); setNotice(stage === "shortlisted" ? "Shortlisted. This company is now in Pipeline." : "Decision saved."); if (advance) { if (outreachDirty && !window.confirm("Decision saved. Discard unsaved outreach edits and move to the next company?")) return; onNext?.(); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const targetOutreach = outreach?.views.find(t => t.id === member.target.id);
  const hasContact = targetOutreach?.contacts.some(c => !c.doNotContact && !c.fictionalised);
  const hasDrafts = Boolean(targetOutreach?.drafts.length);
  const early = ["identified", "reviewing", "parked", "excluded"].includes(member.assessment.stage);
  const conversation = ["contacted", "in-conversation", "qualified"].includes(member.assessment.stage);
  const primary = conversation ? (member.assessment.stage === "contacted" ? "Record conversation" : "Review qualification") : early ? "Review missing details" : !hasContact ? "Find decision-maker" : hasDrafts ? "Review drafts" : "Generate draft";
  return <dialog ref={dialog} onCancel={e => { e.preventDefault(); close(); }} aria-labelledby="company-review-heading" className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-4xl overflow-y-auto border-l border-[var(--border)] bg-black p-0 text-white backdrop:bg-black/60">
    <header className="sticky top-0 z-10 space-y-3 border-b border-[var(--border)] bg-black p-5">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs text-[var(--muted)]">{position} · {member.assessment.stage}</p><h2 id="company-review-heading" className="mt-1 text-2xl font-semibold">{member.target.companyName}</h2><p className="mt-1 text-xs text-[var(--muted)]">{member.target.domain || "Website unknown"} · {member.target.state}</p></div><button className={`${buttonClass} min-h-12`} onClick={close}>Close</button></div>
      <nav aria-label="Company review" className="flex flex-wrap gap-2">{[["review", "Review & decision"], ["details", "Worksheet"], ["outreach", "Contacts & drafts"]].map(([value, label]) => <button key={value} aria-current={tab === value ? "page" : undefined} style={tab === value ? { backgroundColor: "white", color: "black" } : undefined} className={`${buttonClass} min-h-12 ${tab === value ? "bg-white text-black" : ""}`} onClick={() => openTab(value)}>{label}</button>)}</nav>
    </header>
    <div className="space-y-5 p-5">
      {error && <p role="alert" className="text-sm text-red-200">{error}</p>}{notice && <p role="status" className="text-sm text-[var(--accent)]">{notice}</p>}
      <div hidden={tab !== "review"} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2"><section className={panelClass}><h3 className="font-semibold">Company suitability</h3><p className="mt-2 text-sm">Fit {member.target.scores.fit} · {member.assessment.evidence.filter(e => e.assessment !== "unknown").length} criteria assessed</p><p className="mt-2 text-xs text-[var(--muted)]">Shortlisting means worth approaching. Financial and management unknowns stay visible.</p></section><section className={panelClass}><h3 className="font-semibold">Contact readiness</h3><p className="mt-2 text-sm">{!outreach ? "Loading…" : hasContact ? "Named contact saved" : "Find a decision-maker"}</p><p className="mt-2 text-xs text-[var(--muted)]">{hasDrafts ? "Drafts ready to review" : "No drafts yet"} · {targetOutreach?.contacts.some(c => c.email) ? "Work email available; review source" : "Work email still unknown"}</p></section></div>
        <button style={{ backgroundColor: "var(--accent)", color: "black" }} className={`${buttonClass} min-h-12`} onClick={() => openTab(early || conversation ? "details" : "outreach")}>{primary}</button>
        <section className={`${panelClass} space-y-3`}><h3 className="font-semibold">Your decision</h3>{worksheetDirty && <p className="text-sm text-amber-200">Save the worksheet before changing your decision.</p>}<label className="block text-sm">Decision reason / notes<textarea className={fieldClass} maxLength={2000} value={reason} onChange={e => { setReason(e.target.value); setDirty(true); }} /></label><label className="block text-sm">Next action<input className={fieldClass} maxLength={1000} value={nextAction} onChange={e => { setNextAction(e.target.value); setDirty(true); }} /></label><div className="flex flex-wrap gap-2">{([['shortlisted','Shortlist'],['parked','Park'],['excluded','Exclude']] as const).map(([stage,label]) => <button className={`${buttonClass} min-h-12`} disabled={busy || worksheetDirty || (stage === "shortlisted" && !early && member.assessment.stage !== "shortlisted")} key={stage} onClick={() => decide(stage)}>{label}</button>)}<button className={`${buttonClass} min-h-12`} disabled={busy || worksheetDirty} onClick={() => decide(member.assessment.stage)}>Save notes</button>{onNext && <button className={`${buttonClass} min-h-12`} disabled={busy || worksheetDirty} onClick={() => decide(member.assessment.stage, true)}>Save & next company</button>}</div><p className="text-xs text-[var(--muted)]">Park and Exclude require a reason. Shortlist adds the company to Pipeline without marking it qualified.</p></section>
        {tab === "review" && <PeopleSearch mandateId={mandate.id} targetId={member.target.id} onSaved={() => { void refresh().catch(e => setError(e.message)); }} />}
        <CompanyFactsPanel mandateId={mandate.id} targetId={member.target.id} />
        <TargetResearchEvidence mandateId={mandate.id} targetId={member.target.id} domain={member.target.domain || ""} />
        <Link className="text-sm underline" href={`/mandates/${mandate.id}/targets/${member.target.id}`} onClick={e => { if ((dirty || worksheetDirty || outreachDirty) && !window.confirm("Discard unsaved edits and open the full worksheet?")) e.preventDefault(); }}>Open full worksheet</Link>
      </div>
      {worksheetOpened && <div hidden={tab !== "details"}><TargetWorksheet key={member.version} embedded mandates={[]} mandate={mandate} initial={member} onDirty={() => setWorksheetDirty(true)} onSaved={async () => { setWorksheetDirty(false); await refresh(); const d = await jsonRequest(`/api/mandates/${mandate.id}`); const m = d.memberships.find((m: MembershipView) => m.target.id === member.target.id); if (!dirty) { setReason(m.assessment.reason); setNextAction(m.assessment.nextAction); } }} /></div>}
      <div hidden={tab !== "outreach"}>{outreach ? <OutreachQueue canCompose={outreach.canCompose} showPeopleSearch={tab === "outreach"} onDirtyChange={setOutreachDirty} embedded key={member.target.id} mandateId={mandate.id} initialTargetId={member.target.id} initialTargets={outreach.views.filter(t => t.id === member.target.id)} initialBuyerProfile={outreach.buyerProfile} onRefresh={() => { void refresh().catch(e => setError(e.message)); }} /> : <p role="status">Loading contacts and drafts…</p>}</div>
    </div>
  </dialog>;
}
