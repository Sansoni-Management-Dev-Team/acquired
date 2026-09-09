"use client";

import { PeopleSearch } from "./people-search";
import { BuyerProfileEditor } from "./buyer-profile-editor";
import { useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Signal } from "@/domain/models";
import type { BuyerProfile } from "@/domain/buyer-profile";

export type OutreachContactView = { id: string; displayName: string; role?: string; email?: string; emailStatus?: string; sourceUrl?: string; fictionalised: boolean; doNotContact: boolean };
type ContactCandidate = { id: string; position?: string; seniority?: string; department?: string; emailAvailable: boolean; phoneAvailable: boolean };
export type OutreachDraftView = { id: string; step: number; subject: string; body: string; signalIds: string[]; scheduledFor?: string; state: string; gmailDraftSaved: boolean };
export type OutreachTargetView = {
  id: string; companyName: string; domain?: string; status: string; sector?: string; description?: string;
  establishedYear?: number; firmableId?: string; contacts: OutreachContactView[]; signals: Signal[]; drafts: OutreachDraftView[];
};

export function OutreachQueue({ initialTargets, initialBuyerProfile, mandateId, initialTargetId, embedded = false, showPeopleSearch = true, onRefresh, onDirtyChange }: { showPeopleSearch?: boolean; onDirtyChange?: (dirty: boolean) => void; embedded?: boolean; onRefresh?: () => void; mandateId: string; initialTargetId?: string; initialTargets: OutreachTargetView[]; initialBuyerProfile: BuyerProfile | null }) {
  const router = useRouter();
  const refresh = () => { router.refresh(); onRefresh?.(); };
  const [selectedId, setSelectedId] = useState(initialTargetId || initialTargets[0]?.id || "");
  const [busy, setBusy] = useState<"candidates" | "contact" | "drafts" | null>(null);
  const [messageBusy, setMessageBusy] = useState<string | null>(null);
  const [draftEdits, setDraftEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [preview, setPreview] = useState<Array<{ step: number; subject: string; body: string }>>([]);
  const [candidates, setCandidates] = useState<ContactCandidate[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [buyerProfile, setBuyerProfile] = useState<BuyerProfile | null>(initialBuyerProfile);
  const [profileEdited, setProfileEdited] = useState(false);
  const [profileSaved, setProfileSaved] = useState(Boolean(initialBuyerProfile));
  const selected = useMemo(() => initialTargets.find((target) => target.id === selectedId) || initialTargets[0], [initialTargets, selectedId]);
  const contact = selected?.contacts.find((item) => item.id === selectedContacts[selected.id]) || selected?.contacts[0];
  const readyToPreview = Boolean(selected && !contact?.doNotContact && selected.signals.some(s => s.direction === "positive") && profileSaved && buyerProfile?.publicProfileApproved);
  const readyToDraft = readyToPreview && Boolean(contact?.email);
  const contactNeedsLiveEnrichment = !contact || !contact.email || contact.fictionalised;
  useEffect(() => { onDirtyChange?.(Object.keys(draftEdits).length > 0 || profileEdited); }, [draftEdits, profileEdited, onDirtyChange]);
  const hasApprovedDraft = Boolean(selected?.drafts.some((draft) => draft.state === "approved"));

  async function perform(kind: "contact" | "drafts", url: string, body?: Record<string, unknown>) {
    setBusy(kind); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json() as { error?: string; preview?: Array<{ step: number; subject: string; body: string }> };
      if (!response.ok) throw new Error(result.error || "Request failed");
      if (result.preview) setPreview(result.preview); else { setPreview([]); refresh(); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Request failed"); }
    finally { setBusy(null); }
  }

  function regenerateDrafts() {
    if (!window.confirm("Replace all seven saved drafts with a newly generated sequence? Existing draft edits and approvals will be overwritten.")) return;
    void perform("drafts", "/api/outreach/drafts", { mandateId, targetId: selected.id, contactId: contact?.id });
  }

  async function findCandidates() {
    if (!selected) return;
    setBusy("candidates"); setError("");
    try {
      const response = await fetch(`/api/targets/${selected.id}/contact-candidates`);
      const result = await response.json() as { candidates?: ContactCandidate[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Decision-maker search failed");
      setCandidates(result.candidates || []);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Decision-maker search failed"); }
    finally { setBusy(null); }
  }

  function editFor(draft: OutreachDraftView) { return draftEdits[draft.id] || { subject: draft.subject, body: draft.body }; }

  async function saveDraft(draft: OutreachDraftView) {
    setMessageBusy(draft.id); setError("");
    try {
      const response = await fetch(`/api/outreach/messages/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editFor(draft)) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Draft could not be saved");
      setDraftEdits((current) => { const next = { ...current }; delete next[draft.id]; return next; });
      refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Draft could not be saved"); }
    finally { setMessageBusy(null); }
  }

  async function setApproval(draft: OutreachDraftView, approved: boolean) {
    setMessageBusy(draft.id); setError("");
    try {
      const response = await fetch(`/api/outreach/messages/${draft.id}/approval`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Approval could not be saved");
      refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Approval could not be saved"); }
    finally { setMessageBusy(null); }
  }
  if (!selected) return <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-8 text-sm text-[var(--muted)]">No businesses are attached to this mandate yet. Find businesses in Targets or import sourced records first.</div>;

  return <div className={`grid gap-5 ${embedded ? "" : "xl:grid-cols-[320px_1fr]"}`}>
    <aside className="space-y-4">
      {showPeopleSearch && <PeopleSearch key={selected.id} mandateId={mandateId} targetId={selected.id} onSaved={refresh} />}

      <BuyerProfileEditor initial={initialBuyerProfile} onDirtyChange={dirty => { setProfileEdited(dirty); if (dirty) setProfileSaved(false); }} onSaved={profile => { setBuyerProfile(profile); setProfileSaved(true); onRefresh?.(); }} />
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <label className="text-xs uppercase tracking-[.16em] text-[var(--muted)]">Saved business<select value={selected.id} onChange={(event) => { if (Object.keys(draftEdits).length && !window.confirm("Discard unsaved draft edits and switch company?")) return; setDraftEdits({}); setSelectedId(event.target.value); setCandidates([]); setPreview([]); setError(""); }} className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] px-3 py-2.5 text-sm text-white">{initialTargets.map((target) => <option key={target.id} value={target.id}>{target.companyName}</option>)}</select></label>
        <h2 className="mt-5 text-xl font-semibold">{selected.companyName}</h2><p className="mt-1 text-xs text-[var(--muted)]">{selected.domain || "No domain"}{selected.sector ? ` · ${selected.sector}` : ""}</p>
        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Company record</dt><dd className="text-emerald-300">Stored</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Decision-maker</dt><dd>{contact ? contact.displayName : "Missing"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Work email</dt><dd className={contact?.email ? "text-emerald-300" : "text-amber-300"}>{contact?.email ? "Available" : "Missing"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Evidence signals</dt><dd>{selected.signals.length}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Saved drafts</dt><dd>{selected.drafts.length}</dd></div>
        </dl>
      </section>
      {contactNeedsLiveEnrichment && <section className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4"><h3 className="text-sm font-semibold text-amber-100">{contact?.fictionalised ? "Live decision-maker required" : contact ? "Work email required" : "Decision-maker required"}</h3><p className="mt-2 text-xs leading-5 text-amber-100/75">{contact?.fictionalised ? "This saved contact is fictionalised. Search Firmable again and select a real contact before Gmail approval." : contact ? "Re-enrich this contact or choose another candidate with an available email." : "Search within this company, review the returned roles, then choose which candidate to enrich and save."}</p><button disabled={busy !== null || !selected.firmableId} onClick={findCandidates} className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-300/30 px-3 py-2 text-xs font-semibold text-amber-100 disabled:opacity-40">{busy === "candidates" && <LoaderCircle size={14} className="animate-spin" />}Search Firmable</button>{!selected.firmableId && <p className="mt-2 text-xs">Enrich this company first to use Firmable. Public web search needs only a reviewed website.</p>}{candidates.length > 0 && <div className="mt-3 space-y-2">{candidates.map((candidate) => <button key={candidate.id} disabled={busy !== null} onClick={() => perform("contact", `/api/targets/${selected.id}/contact`, { personId: candidate.id })} className="block w-full rounded-md border border-amber-200/20 bg-black/10 p-3 text-left text-xs hover:border-amber-200/50"><strong className="block text-amber-50">{candidate.position || "Role not provided"}</strong><span className="mt-1 block text-amber-100/60">{candidate.seniority || "Seniority unknown"}{candidate.department ? ` · ${candidate.department}` : ""} · {candidate.emailAvailable ? "Email available" : "No email shown"}</span></button>)}</div>}<p className="mt-2 text-[10px] leading-4 text-amber-100/60">Firmable enrichment may consume credits.</p></section>}
      {contact && <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"><h3 className="text-sm font-semibold">Selected contact</h3>{selected.contacts.length > 1 && <select value={contact.id} onChange={(event) => setSelectedContacts((current) => ({ ...current, [selected.id]: event.target.value }))} className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] px-3 py-2 text-sm">{selected.contacts.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.role || "Unknown role"}</option>)}</select>}<p className="mt-2 text-sm">{contact.displayName}</p><p className="text-xs text-[var(--muted)]">{contact.role || "Role not provided"}</p>{contact.fictionalised && <p className="mt-3 rounded bg-amber-400/5 p-2 text-[10px] leading-4 text-amber-200">Personal data is fictionalised in this environment. Draft preview is safe, but delivery is blocked.</p>}{contact.email && <p className="mt-2 break-all text-xs">{contact.email} · {contact.emailStatus === "published-unverified" ? "Published, not verified" : "Provider supplied"}</p>}{contact.sourceUrl && <a className="mt-2 block text-xs underline" href={contact.sourceUrl} target="_blank" rel="noreferrer">Review contact source</a>}{contact.doNotContact && <p className="mt-3 text-xs text-red-300">This contact is marked do-not-contact.</p>}</section>}
      {error && <p role="alert" className="rounded-md border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-200">{error}</p>}
    </aside>
    <section className="space-y-3">
      {preview.length > 0 && <div className="space-y-3"><p role="status" className="text-sm text-amber-200">Preview only · not saved. Select a recipient and generate the saved sequence when ready.</p>{preview.map(draft => <article key={draft.step} className="rounded-lg border border-[var(--border)] p-5"><h3 className="font-semibold">{draft.step}. {draft.subject}</h3><p className="mt-3 whitespace-pre-wrap text-sm text-[var(--muted)]">{draft.body}</p></article>)}</div>}
      {selected.drafts.length === 0 ? <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-7"><p className="text-xs uppercase tracking-[.16em] text-[var(--accent)]">Outreach readiness</p><h2 className="mt-2 text-xl font-semibold">Generate seven evidence-grounded drafts</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">Drafts use the stored company profile, selected decision-maker, and persisted evidence signals. They remain in draft state and cannot send without human approval.</p><button disabled={!readyToPreview || busy !== null} onClick={() => perform("drafts", "/api/outreach/drafts", { mandateId, targetId: selected.id, contactId: contact?.id, preview: true })} className="mt-5 mr-3 min-h-12 rounded-md border border-[var(--border)] px-4 text-sm disabled:opacity-40">Preview drafts without email</button><button disabled={!readyToDraft || busy !== null} onClick={() => perform("drafts", "/api/outreach/drafts", { mandateId, targetId: selected.id, contactId: contact?.id })} className="mt-5 inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40">{busy === "drafts" && <LoaderCircle size={15} className="animate-spin" />}Generate and save drafts</button>{!readyToDraft && <p className="mt-3 text-xs text-amber-200">{!buyerProfile?.publicProfileApproved ? "Approve and save the public profile in Buyer profile." : !profileSaved ? "Save the buyer profile above." : !selected.signals.some(s => s.direction === "positive") ? <a className="underline" href={`/mandates/${mandateId}/targets/${selected.id}`}>Review public sub-sector evidence in the worksheet.</a> : "Preview now; select a contact with a work email to save the sequence."}</p>}</div> : <><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"><div><p className="text-xs uppercase tracking-[.16em] text-[var(--accent)]">Saved sequence</p><p className="mt-1 text-xs text-[var(--muted)]">{hasApprovedDraft ? "Revoke approved Gmail drafts before regenerating." : "Regeneration replaces all seven drafts and resets their approvals."}</p></div><button disabled={!readyToDraft || hasApprovedDraft || busy !== null || messageBusy !== null} onClick={regenerateDrafts} className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40">{busy === "drafts" && <LoaderCircle size={14} className="animate-spin" />}Regenerate all drafts</button></div>{selected.drafts.map((draft) => {
        const edit = editFor(draft); const approved = draft.state === "approved";
        return <article key={draft.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs uppercase tracking-[.16em] text-[var(--accent)]">Step {draft.step}</span><button disabled={messageBusy !== null || (!approved && Boolean(contact?.fictionalised || !contact?.email || contact.doNotContact))} onClick={() => setApproval(draft, !approved)} className={`rounded-md border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${approved ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--muted)]"}`}>{messageBusy === draft.id ? "Syncing Gmail…" : approved ? "Revoke approval" : contact?.fictionalised ? "Real contact required" : "Approve & save to Gmail"}</button></div>
          <input disabled={approved} value={edit.subject} onChange={(event) => setDraftEdits((current) => ({ ...current, [draft.id]: { ...edit, subject: event.target.value } }))} className="mt-3 w-full rounded-md border border-[var(--border)] bg-black/15 px-3 py-2 font-semibold disabled:opacity-70" />
          <textarea disabled={approved} value={edit.body} onChange={(event) => setDraftEdits((current) => ({ ...current, [draft.id]: { ...edit, body: event.target.value } }))} className="mt-3 min-h-40 w-full resize-y rounded-md border border-[var(--border)] bg-black/15 p-3 text-sm leading-6 text-[var(--muted)] disabled:opacity-70" />
          <div className="mt-3 flex flex-wrap items-center gap-3"><button disabled={approved || messageBusy !== null || !draftEdits[draft.id]} onClick={() => saveDraft(draft)} className="rounded-md border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-40">Save edits</button><span className="text-xs text-[var(--muted)]">{draft.scheduledFor ? new Date(draft.scheduledFor).toLocaleDateString("en-AU", { dateStyle: "medium" }) : "Unscheduled"}</span><span className="text-xs text-[var(--muted)]">Evidence: {draft.signalIds.length ? draft.signalIds.join(", ") : "No company claim"}</span><span className="text-xs text-[var(--muted)]">DB state: {draft.state}</span>{draft.gmailDraftSaved && <span className="text-xs text-emerald-300">Gmail draft saved</span>}</div>
        </article>;
      })}</>}
    </section>
  </div>;
}
