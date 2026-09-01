"use client";

import { useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Signal } from "@/domain/models";
import type { BuyerProfile } from "@/domain/buyer-profile";

export type OutreachContactView = { id: string; displayName: string; role?: string; email?: string; fictionalised: boolean; doNotContact: boolean };
type ContactCandidate = { id: string; position?: string; seniority?: string; department?: string; emailAvailable: boolean; phoneAvailable: boolean };
export type OutreachDraftView = { id: string; step: number; subject: string; body: string; signalIds: string[]; scheduledFor?: string; state: string; gmailDraftSaved: boolean };
export type OutreachTargetView = {
  id: string; companyName: string; domain?: string; status: string; sector?: string; description?: string;
  establishedYear?: number; firmableId?: string; contacts: OutreachContactView[]; signals: Signal[]; drafts: OutreachDraftView[];
};

const emptyProfile: BuyerProfile = { senderName: "", background: "", investmentThesis: "", operatingIntent: "", callToAction: "", signature: "" };

export function OutreachQueue({ initialTargets, initialBuyerProfile }: { initialTargets: OutreachTargetView[]; initialBuyerProfile: BuyerProfile | null }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(initialTargets[0]?.id || "");
  const [busy, setBusy] = useState<"candidates" | "contact" | "drafts" | null>(null);
  const [messageBusy, setMessageBusy] = useState<string | null>(null);
  const [draftEdits, setDraftEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [candidates, setCandidates] = useState<ContactCandidate[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [buyerProfile, setBuyerProfile] = useState<BuyerProfile>(initialBuyerProfile || emptyProfile);
  const [profileSaved, setProfileSaved] = useState(Boolean(initialBuyerProfile));
  const [savingProfile, setSavingProfile] = useState(false);
  const selected = useMemo(() => initialTargets.find((target) => target.id === selectedId) || initialTargets[0], [initialTargets, selectedId]);
  const contact = selected?.contacts.find((item) => item.id === selectedContacts[selected.id]) || selected?.contacts[0];
  const readyToDraft = Boolean(selected && contact?.email && !contact.doNotContact && selected.signals.length && profileSaved);
  const contactNeedsLiveEnrichment = !contact || !contact.email || contact.fictionalised;
  const hasApprovedDraft = Boolean(selected?.drafts.some((draft) => draft.state === "approved"));

  async function perform(kind: "contact" | "drafts", url: string, body?: Record<string, unknown>) {
    setBusy(kind); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Request failed");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Request failed"); }
    finally { setBusy(null); }
  }

  function regenerateDrafts() {
    if (!window.confirm("Replace all seven saved drafts with a newly generated sequence? Existing draft edits and approvals will be overwritten.")) return;
    void perform("drafts", "/api/outreach/drafts", { targetId: selected.id, contactId: contact?.id });
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

  async function saveBuyerProfile() {
    setSavingProfile(true); setError("");
    try {
      const response = await fetch("/api/outreach/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buyerProfile) });
      const result = await response.json() as { profile?: BuyerProfile; error?: string };
      if (!response.ok || !result.profile) throw new Error(result.error || "Buyer profile could not be saved");
      setBuyerProfile(result.profile); setProfileSaved(true); router.refresh();
    } catch (caught) { setProfileSaved(false); setError(caught instanceof Error ? caught.message : "Buyer profile could not be saved"); }
    finally { setSavingProfile(false); }
  }

  function updateProfile(field: keyof BuyerProfile, value: string) {
    setBuyerProfile((current) => ({ ...current, [field]: value }));
    setProfileSaved(false);
  }

  function editFor(draft: OutreachDraftView) { return draftEdits[draft.id] || { subject: draft.subject, body: draft.body }; }

  async function saveDraft(draft: OutreachDraftView) {
    setMessageBusy(draft.id); setError("");
    try {
      const response = await fetch(`/api/outreach/messages/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editFor(draft)) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Draft could not be saved");
      setDraftEdits((current) => { const next = { ...current }; delete next[draft.id]; return next; });
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Draft could not be saved"); }
    finally { setMessageBusy(null); }
  }

  async function setApproval(draft: OutreachDraftView, approved: boolean) {
    setMessageBusy(draft.id); setError("");
    try {
      const response = await fetch(`/api/outreach/messages/${draft.id}/approval`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approved }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Approval could not be saved");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Approval could not be saved"); }
    finally { setMessageBusy(null); }
  }
  if (!selected) return <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-8 text-sm text-[var(--muted)]">No enriched businesses have been saved yet. Run a target search first.</div>;

  return <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
    <aside className="space-y-4">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Buyer profile</h2><span className={`text-[10px] uppercase tracking-[.14em] ${profileSaved ? "text-emerald-300" : "text-amber-300"}`}>{profileSaved ? "Saved" : "Required"}</span></div><div className="mt-4 space-y-3">{([
        ["senderName", "Sender name", "Alex Buyer"], ["background", "Background", "Your relevant operating and professional background"],
        ["investmentThesis", "Investment thesis", "The kind of company you want to acquire"], ["operatingIntent", "Operating intent", "How you intend to own and operate the business"],
        ["callToAction", "Call to action", "The specific next step you want to request"], ["signature", "Signature", "Name and sign-off"],
      ] as Array<[keyof BuyerProfile, string, string]>).map(([field, label, placeholder]) => <label key={field} className="block text-[11px] text-[var(--muted)]">{label}{field === "senderName" || field === "signature" ? <input value={buyerProfile[field]} onChange={(event) => updateProfile(field, event.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-md border border-[var(--border)] bg-black/20 px-3 py-2 text-xs text-white" /> : <textarea value={buyerProfile[field]} onChange={(event) => updateProfile(field, event.target.value)} placeholder={placeholder} className="mt-1 min-h-16 w-full resize-y rounded-md border border-[var(--border)] bg-black/20 px-3 py-2 text-xs text-white" />}</label>)}</div><button disabled={savingProfile || profileSaved} onClick={saveBuyerProfile} className="mt-4 rounded-md border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-40">{savingProfile ? "Saving…" : profileSaved ? "Profile saved" : "Save buyer profile"}</button></section>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <label className="text-xs uppercase tracking-[.16em] text-[var(--muted)]">Saved business<select value={selected.id} onChange={(event) => { setSelectedId(event.target.value); setCandidates([]); setError(""); }} className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] px-3 py-2.5 text-sm text-white">{initialTargets.map((target) => <option key={target.id} value={target.id}>{target.companyName}</option>)}</select></label>
        <h2 className="mt-5 text-xl font-semibold">{selected.companyName}</h2><p className="mt-1 text-xs text-[var(--muted)]">{selected.domain || "No domain"}{selected.sector ? ` · ${selected.sector}` : ""}</p>
        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Company record</dt><dd className="text-emerald-300">Stored</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Decision-maker</dt><dd>{contact ? contact.displayName : "Missing"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Verified email</dt><dd className={contact?.email ? "text-emerald-300" : "text-amber-300"}>{contact?.email ? "Available" : "Missing"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Evidence signals</dt><dd>{selected.signals.length}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Saved drafts</dt><dd>{selected.drafts.length}</dd></div>
        </dl>
      </section>
      {contactNeedsLiveEnrichment && <section className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4"><h3 className="text-sm font-semibold text-amber-100">{contact?.fictionalised ? "Live decision-maker required" : contact ? "Verified email required" : "Decision-maker required"}</h3><p className="mt-2 text-xs leading-5 text-amber-100/75">{contact?.fictionalised ? "This saved contact is fictionalised. Search Firmable again and select a real contact before Gmail approval." : contact ? "Re-enrich this contact or choose another candidate with an available email." : "Search within this company, review the returned roles, then choose which candidate to enrich and save."}</p><button disabled={busy !== null || !selected.firmableId} onClick={findCandidates} className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-300/30 px-3 py-2 text-xs font-semibold text-amber-100 disabled:opacity-40">{busy === "candidates" && <LoaderCircle size={14} className="animate-spin" />}{contact?.fictionalised ? "Find real candidates" : contact ? "Find candidates with email" : "Find candidates"}</button>{candidates.length > 0 && <div className="mt-3 space-y-2">{candidates.map((candidate) => <button key={candidate.id} disabled={busy !== null} onClick={() => perform("contact", `/api/targets/${selected.id}/contact`, { personId: candidate.id })} className="block w-full rounded-md border border-amber-200/20 bg-black/10 p-3 text-left text-xs hover:border-amber-200/50"><strong className="block text-amber-50">{candidate.position || "Role not provided"}</strong><span className="mt-1 block text-amber-100/60">{candidate.seniority || "Seniority unknown"}{candidate.department ? ` · ${candidate.department}` : ""} · {candidate.emailAvailable ? "Email available" : "No email shown"}</span></button>)}</div>}<p className="mt-2 text-[10px] leading-4 text-amber-100/60">Local fixture mode makes no external requests. Live mode may consume Firmable credits.</p></section>}
      {contact && <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"><h3 className="text-sm font-semibold">Selected contact</h3>{selected.contacts.length > 1 && <select value={contact.id} onChange={(event) => setSelectedContacts((current) => ({ ...current, [selected.id]: event.target.value }))} className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] px-3 py-2 text-sm">{selected.contacts.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.role || "Unknown role"}</option>)}</select>}<p className="mt-2 text-sm">{contact.displayName}</p><p className="text-xs text-[var(--muted)]">{contact.role || "Role not provided"}</p>{contact.fictionalised && <p className="mt-3 rounded bg-amber-400/5 p-2 text-[10px] leading-4 text-amber-200">Personal data is fictionalised in this environment. Draft preview is safe, but delivery is blocked.</p>}{contact.doNotContact && <p className="mt-3 text-xs text-red-300">Firmable marked this contact as do-not-contact.</p>}</section>}
      {error && <p role="alert" className="rounded-md border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-200">{error}</p>}
    </aside>
    <section className="space-y-3">
      {selected.drafts.length === 0 ? <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-7"><p className="text-xs uppercase tracking-[.16em] text-[var(--accent)]">Outreach readiness</p><h2 className="mt-2 text-xl font-semibold">Generate seven evidence-grounded drafts</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">Drafts use the stored company profile, selected decision-maker, and persisted evidence signals. They remain in draft state and cannot send without human approval.</p><button disabled={!readyToDraft || busy !== null} onClick={() => perform("drafts", "/api/outreach/drafts", { targetId: selected.id, contactId: contact?.id })} className="mt-5 inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40">{busy === "drafts" && <LoaderCircle size={15} className="animate-spin" />}Generate and save drafts</button>{!readyToDraft && <p className="mt-3 text-xs text-amber-200">Requires a saved buyer profile, a contactable decision-maker with an email, and at least one evidence signal.</p>}</div> : <><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"><div><p className="text-xs uppercase tracking-[.16em] text-[var(--accent)]">Saved sequence</p><p className="mt-1 text-xs text-[var(--muted)]">{hasApprovedDraft ? "Revoke approved Gmail drafts before regenerating." : "Regeneration replaces all seven drafts and resets their approvals."}</p></div><button disabled={!readyToDraft || hasApprovedDraft || busy !== null || messageBusy !== null} onClick={regenerateDrafts} className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40">{busy === "drafts" && <LoaderCircle size={14} className="animate-spin" />}Regenerate all drafts</button></div>{selected.drafts.map((draft) => {
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
