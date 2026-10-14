"use client";

import { PeopleSearch } from "./people-search";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Signal } from "@/domain/models";
import type { BuyerProfile } from "@/domain/buyer-profile";
import { OUTREACH_CHANNELS, type OutreachChannel, type OutreachChannelCopy } from "@/domain/outreach";
import type { ContactCompleteness } from "@/domain/contact-completeness";

export type OutreachContactView = { id: string; displayName: string; role?: string; email?: string; phone?: string; emailStatus?: string; completeness?: ContactCompleteness; sourceUrl?: string; fictionalised: boolean; doNotContact: boolean };
type ContactCandidate = { id: string; position?: string; seniority?: string; department?: string; emailAvailable: boolean; phoneAvailable: boolean };
export type OutreachDraftView = { id: string; contactId?: string; step: number; subject: string; body: string; channels?: Partial<Record<OutreachChannel, OutreachChannelCopy>>; signalIds: string[]; scheduledFor?: string; state: string; gmailDraftSaved: boolean };
type PreviewDraft = { step: number; subject: string; body: string; channels?: Partial<Record<OutreachChannel, OutreachChannelCopy>> };
const channelLabels: Record<OutreachChannel, string> = { email: "Email", linkedin: "LinkedIn", whatsapp: "WhatsApp" };
export type OutreachTargetView = {
  id: string; companyName: string; domain?: string; status: string; stage?: string; sector?: string; description?: string;
  establishedYear?: number; availablePeopleCount?: number; firmableId?: string; contacts: OutreachContactView[]; signals: Signal[]; drafts: OutreachDraftView[];
};

export function OutreachQueue({ initialTargets, initialBuyerProfile, mandateId, initialTargetId, embedded = false, canCompose = true, showPeopleSearch = true, onRefresh, onDirtyChange,initialDeliveryAvailable=false }: { initialDeliveryAvailable?:boolean;canCompose?: boolean; showPeopleSearch?: boolean; onDirtyChange?: (dirty: boolean) => void; embedded?: boolean; onRefresh?: () => void; mandateId: string; initialTargetId?: string; initialTargets: OutreachTargetView[]; initialBuyerProfile: BuyerProfile | null }) {
  const router = useRouter();
  const refresh = () => { router.refresh(); onRefresh?.(); };
  const [selectedId, setSelectedId] = useState(initialTargetId || initialTargets.find(target => target.stage && !["parked", "excluded"].includes(target.stage))?.id || initialTargets[0]?.id || "");
  const [busy, setBusy] = useState<"candidates" | "contact" | "preview" | "drafts" | null>(null);
  const [messageBusy, setMessageBusy] = useState<string | null>(null);
  const [deliveryAvailable,setDeliveryAvailable]=useState(initialDeliveryAvailable);
  const [uncertainSends,setUncertainSends]=useState<Record<string,boolean>>({});
  const sending=useRef(false);
  useEffect(()=>{let cancelled=false;void fetch('/api/channels/connections',{cache:'no-store'}).then(async response=>{const result=await response.json();if(!cancelled)setDeliveryAvailable(response.ok&&result.available===true&&Array.isArray(result.connections)&&result.connections.some((c:{binding?:{channel?:string};status?:string})=>c.binding?.channel==='email'&&c.status==='connected'));}).catch(()=>{if(!cancelled)setDeliveryAvailable(false);});return()=>{cancelled=true;};},[]);
  const [activeChannel, setActiveChannel] = useState<OutreachChannel>("email");
  const [draftEdits, setDraftEdits] = useState<Record<string, OutreachChannelCopy>>({});
  const [preview, setPreview] = useState<PreviewDraft[]>([]);
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (preview.length) previewRef.current?.focus(); }, [preview]);
  const [candidates, setCandidates] = useState<ContactCandidate[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const buyerProfile = initialBuyerProfile;
  const profileSaved = Boolean(buyerProfile);
  const selected = useMemo(() => initialTargets.find((target) => target.id === selectedId) || initialTargets[0], [initialTargets, selectedId]);
  const contact = selected?.contacts.find((item) => item.id === selectedContacts[selected.id]) || selected?.contacts[0];
  const inactiveTarget = Boolean(selected?.stage && ["parked", "excluded"].includes(selected.stage));
  const previewBlocker = inactiveTarget ? "This company is parked or excluded. Return it to the active pipeline in its worksheet, or select another company."
    : contact?.doNotContact ? "This contact is marked do-not-contact. Select an eligible contact before drafting."
    : !profileSaved ? "Complete the outreach profile in Settings before drafting."
    : "";
  const readyToPreview = Boolean(selected && !previewBlocker);
  const readyToDraft = readyToPreview && Boolean(contact?.email) && !contact?.fictionalised;
  const contactNeedsLiveEnrichment = !contact || !contact.email || contact.fictionalised;
  useEffect(() => { onDirtyChange?.(Object.keys(draftEdits).length > 0); }, [draftEdits, onDirtyChange]);
  const contactDrafts = selected?.drafts.filter(draft => draft.contactId === contact?.id) || [];
  const regenerationBlocked = contactDrafts.some((draft) => draft.state !== "draft" || draft.gmailDraftSaved);

  async function perform(kind: "contact" | "preview" | "drafts", url: string, body?: Record<string, unknown>) {
    setBusy(kind); setError("");
    if (kind === "preview") setPreview([]);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json().catch(() => null) as { error?: string; preview?: PreviewDraft[] } | null;
      if (!response.ok || !result) throw new Error(result?.error || `The request could not be completed (${response.status}). Please try again.`);
      if (kind === "preview" && !result.preview?.length) throw new Error("No preview drafts were returned. Please try again.");
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

  function editKey(draft: OutreachDraftView, channel = activeChannel) { return `${draft.id}:${channel}`; }
  function copyFor(draft: Pick<OutreachDraftView, "subject" | "body" | "channels">, channel = activeChannel): OutreachChannelCopy | undefined {
    if (channel === "email") return draft.channels?.email || { subject: draft.subject, body: draft.body };
    return draft.channels?.[channel];
  }
  function editFor(draft: OutreachDraftView) { return draftEdits[editKey(draft)] || copyFor(draft); }

  async function saveDraft(draft: OutreachDraftView) {
    const key = editKey(draft);
    const edit = draftEdits[key];
    if (!edit) return;
    setMessageBusy(key); setError("");
    try {
      const response = await fetch(`/api/outreach/messages/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel: activeChannel, ...edit }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Draft could not be saved");
      setDraftEdits((current) => { const next = { ...current }; delete next[key]; return next; });
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
  async function sendDraft(draft:OutreachDraftView){
    if(sending.current||messageBusy||!deliveryAvailable||draft.state!=='approved'||draft.gmailDraftSaved)return;
    if(!uncertainSends[draft.id]&&!window.confirm(`Send the approved email to ${contact?.email}?`))return;
    sending.current=true;setMessageBusy(draft.id);setError('');
    try{const response=await fetch(`/api/outreach/messages/${draft.id}/send`,{method:'POST'}),result=await response.json() as {status?:string;error?:string};
      if(!response.ok)throw Error(result.error||'Review the connection and reply checks before sending.');
      if(result.status==='submitted'){setUncertainSends(current=>({...current,[draft.id]:false}));refresh();}
      else if(result.status==='unknown'){setUncertainSends(current=>({...current,[draft.id]:true}));setError('The send is not yet confirmed. Check its status before taking another action.');}
      else throw Error('The draft is waiting for its connection or reply checks.');
    }catch(caught){setError(caught instanceof Error?caught.message:'Draft send could not be confirmed');}finally{sending.current=false;setMessageBusy(null);}
  }
  if (!selected) return <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-8 text-sm text-[var(--muted)]">No businesses are attached to this mandate yet. Find businesses in Companies or import sourced records first.</div>;

  return <div className={`grid gap-5 ${embedded ? "" : "xl:grid-cols-[320px_1fr]"}`}>
    <aside className="min-w-0 space-y-4">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <label className="text-xs uppercase tracking-[.16em] text-[var(--muted)]">Saved business<select disabled={busy !== null} value={selected.id} onChange={(event) => { if (Object.keys(draftEdits).length && !window.confirm("Discard unsaved draft edits and switch company?")) return; setDraftEdits({}); setSelectedId(event.target.value); setCandidates([]); setPreview([]); setError(""); }} className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] px-3 py-2.5 text-sm text-[var(--foreground)]">{initialTargets.map((target) => <option key={target.id} value={target.id}>{target.companyName}{target.stage === "parked" || target.stage === "excluded" ? ` · ${target.stage}` : ""}</option>)}</select></label>
        <h2 className="mt-5 text-xl font-semibold">{selected.companyName}</h2><p className="mt-1 text-xs text-[var(--muted)]">{selected.domain || "No domain"}{selected.sector ? ` · ${selected.sector}` : ""}</p>
        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Pipeline stage</dt><dd className={inactiveTarget ? "text-[var(--status-amber)]" : "text-[var(--status-emerald)]"}>{selected.stage || "Unknown"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Decision-maker</dt><dd>{contact ? contact.displayName : "Missing"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Work email</dt><dd className={contact?.email ? "text-[var(--status-emerald)]" : "text-[var(--status-amber)]"}>{contact?.email ? "Available" : "Missing"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Evidence signals</dt><dd>{selected.signals.length}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-[var(--muted)]">Saved drafts</dt><dd>{contactDrafts.length}</dd></div>
        </dl>
      </section>
      {!profileSaved && <Link href="/settings" className="flex min-h-12 items-center text-sm text-[var(--accent)] underline">Complete the outreach profile in Settings</Link>}
      {showPeopleSearch && <details className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"><summary className="min-h-12 cursor-pointer py-3 text-sm font-semibold">Find a decision-maker</summary><p className="mb-3 text-sm text-[var(--muted)]">Optional for preview. Needed to save drafts for a recipient.</p><PeopleSearch key={selected.id} mandateId={mandateId} targetId={selected.id} onSaved={refresh} /></details>}
      {contactNeedsLiveEnrichment && <section className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4"><h3 className="text-sm font-semibold text-[var(--status-amber)]">{contact?.fictionalised ? "Live decision-maker required" : contact ? "Work email required" : "Find a recipient"}</h3><p className="mt-2 text-xs leading-5 text-[var(--status-amber)]">{contact?.fictionalised ? "This saved contact is fictionalised. Search company data again and select a real contact before draft approval." : contact ? "Re-enrich this contact or choose another candidate with an available email." : "You can preview without a recipient. To save a sequence, find a decision-maker with a work email."}</p><button disabled={busy !== null || !selected.firmableId} onClick={findCandidates} className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-300/30 px-3 py-2 text-xs font-semibold text-[var(--status-amber)] disabled:opacity-40">{busy === "candidates" && <LoaderCircle size={14} className="animate-spin" />}Search company data</button>{!selected.firmableId && <p className="mt-2 text-xs">Enrich this company first to search company data. Public web search needs only a reviewed website.</p>}{candidates.length > 0 && <div className="mt-3 space-y-2">{candidates.map((candidate) => <button key={candidate.id} disabled={busy !== null} onClick={() => perform("contact", `/api/targets/${selected.id}/contact`, { personId: candidate.id })} className="block w-full rounded-md border border-amber-200/20 bg-black/10 p-3 text-left text-xs hover:border-amber-200/50"><strong className="block text-[var(--status-amber)]">{candidate.position || "Role not provided"}</strong><span className="mt-1 block text-[var(--status-amber)]">{candidate.seniority || "Seniority unknown"}{candidate.department ? ` · ${candidate.department}` : ""} · {candidate.emailAvailable ? "Email available" : "No email shown"}</span></button>)}</div>}<p className="mt-2 text-[10px] leading-4 text-[var(--status-amber)]">Company enrichment may consume credits.</p></section>}
      {contact && <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"><h3 className="text-sm font-semibold">Selected contact</h3>{selected.contacts.length > 1 && <select aria-label="Selected contact" disabled={busy !== null} value={contact.id} onChange={(event) => { if (Object.keys(draftEdits).length && !window.confirm("Discard unsaved edits and switch contact?")) return; setDraftEdits({}); setPreview([]); setError(""); setSelectedContacts((current) => ({ ...current, [selected.id]: event.target.value })); }} className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] px-3 py-2 text-sm">{selected.contacts.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.role || "Unknown role"}</option>)}</select>}<p className="mt-2 text-sm">{contact.displayName}</p><p className="text-xs text-[var(--muted)]">{contact.role || "Role not provided"}</p>{contact.fictionalised && <p className="mt-3 rounded bg-amber-400/5 p-2 text-[10px] leading-4 text-[var(--status-amber)]">Personal data is fictionalised in this environment. Draft preview is safe, but delivery is blocked.</p>}{contact.email && <p className="mt-2 break-all text-xs">{contact.email} · {contact.emailStatus === "published-unverified" ? "Published, not verified" : "Provider supplied"}</p>}{contact.sourceUrl && <a className="mt-2 block text-xs underline" href={contact.sourceUrl} target="_blank" rel="noreferrer">Review contact source</a>}{contact.doNotContact && <p className="mt-3 text-xs text-[var(--status-red)]">This contact is marked do-not-contact.</p>}</section>}
    </aside>
    <section className="min-w-0 space-y-3" aria-busy={busy === "preview" || busy === "drafts"}>
      <div role="tablist" aria-label="Outreach draft channel" className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-1">
        {OUTREACH_CHANNELS.map((channel) => <button key={channel} id={`outreach-${mandateId}-${channel}-tab`} role="tab" aria-selected={activeChannel === channel} aria-controls={`outreach-${mandateId}-${channel}-panel`} tabIndex={activeChannel === channel ? 0 : -1} onClick={() => setActiveChannel(channel)} onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const offset = event.key === "ArrowRight" ? 1 : -1;
          const next = OUTREACH_CHANNELS[(OUTREACH_CHANNELS.indexOf(channel) + offset + OUTREACH_CHANNELS.length) % OUTREACH_CHANNELS.length];
          setActiveChannel(next);
          document.getElementById(`outreach-${mandateId}-${next}-tab`)?.focus();
        }} className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors ${activeChannel === channel ? "bg-[var(--accent)] text-[var(--on-accent)]" : "text-[var(--muted)] hover:bg-[var(--panel-raised)] hover:text-[var(--foreground)]"}`}>{channelLabels[channel]}</button>)}
      </div>
      <div id={`outreach-${mandateId}-${activeChannel}-panel`} role="tabpanel" aria-labelledby={`outreach-${mandateId}-${activeChannel}-tab`} className="space-y-3">
        {error && <p role="alert" className="rounded-md border border-red-400/20 bg-red-400/5 p-3 text-xs text-[var(--status-red)]">{error}</p>}
        {(busy === "preview" || busy === "drafts") && <p role="status" className="text-sm text-[var(--muted)]">{busy === "preview" ? "Generating seven preview steps for Email, LinkedIn and WhatsApp… This may take a minute. Nothing will be saved or sent." : "Generating and saving seven steps for all three channels… This may take a minute."}</p>}
        {preview.length > 0 && <div ref={previewRef} tabIndex={-1} aria-label={`${channelLabels[activeChannel]} draft preview results`} className="space-y-3"><p role="status" className="text-sm text-[var(--status-amber)]">{preview.length} {channelLabels[activeChannel]} preview drafts ready for {selected.companyName} · not saved or sent. Select a recipient and generate the saved sequence when ready.</p>{preview.map(draft => {
          const copy = copyFor(draft, activeChannel);
          return copy ? <article key={draft.step} className="rounded-lg border border-[var(--border)] p-5"><h3 className="font-semibold">{draft.step}.{copy.subject ? ` ${copy.subject}` : ` ${channelLabels[activeChannel]} message`}</h3><p className="mt-3 whitespace-pre-wrap text-sm text-[var(--muted)]">{copy.body}</p></article> : null;
        })}</div>}
        {contactDrafts.length === 0 ? <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-7"><p className="text-xs uppercase tracking-[.16em] text-[var(--accent)]">Outreach readiness</p><h2 className="mt-2 text-xl font-semibold">Generate seven drafts across three channels</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">Preview an aligned seven-step sequence with copy tailored for Email, LinkedIn and WhatsApp. It uses the saved company data and saved outreach profile. Reviewed evidence is used when available, but it is not required. No recipient or email is needed for preview. Select a recipient to generate and save the sequence.</p><button disabled={!readyToPreview || busy !== null} onClick={() => perform("preview", "/api/outreach/drafts", { mandateId, targetId: selected.id, contactId: contact?.id, preview: true })} className="mt-5 mr-3 inline-flex min-h-12 items-center gap-2 rounded-md border border-[var(--border)] px-4 text-sm disabled:opacity-40">{busy === "preview" && <LoaderCircle size={15} className="animate-spin" />}{busy === "preview" ? "Generating preview…" : "Preview all channel drafts"}</button><button disabled={!readyToDraft || busy !== null} onClick={() => perform("drafts", "/api/outreach/drafts", { mandateId, targetId: selected.id, contactId: contact?.id })} className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40">{busy === "drafts" && <LoaderCircle size={15} className="animate-spin" />}Generate and save all drafts</button>{!readyToDraft && <p className="mt-3 text-sm text-[var(--status-amber)]">{previewBlocker || "Ready to preview. A recipient with a work email is needed to save drafts."}{inactiveTarget && <> <a className="underline" href={`/mandates/${mandateId}/targets/${selected.id}`}>Open company worksheet</a></>}</p>}</div> : <><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"><div><p className="text-xs uppercase tracking-[.16em] text-[var(--accent)]">Saved sequence · {channelLabels[activeChannel]}</p><p className="mt-1 text-xs text-[var(--muted)]">{regenerationBlocked ? "This sequence contains approved or historical records. Regeneration is unavailable." : "Regeneration replaces all seven draft steps across every channel."}</p></div><button disabled={!readyToDraft || regenerationBlocked || busy !== null || messageBusy !== null} onClick={regenerateDrafts} className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40">{busy === "drafts" && <LoaderCircle size={14} className="animate-spin" />}Regenerate all channels</button></div>{activeChannel !== "email" && contactDrafts.some((draft) => !copyFor(draft, activeChannel)) && <p className="rounded-md border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-[var(--status-amber)]">This sequence predates {channelLabels[activeChannel]} copy. {regenerationBlocked ? "Regeneration is unavailable for this sequence." : "Regenerate all channels to create it."}</p>}{contactDrafts.filter((draft) => copyFor(draft, activeChannel)).map((draft) => {
          const edit = editFor(draft)!; const approved = draft.state === "approved"; const locallyEditable = ["draft", "approved"].includes(draft.state); const key = editKey(draft); const emailEditKey = editKey(draft, "email");
          return <article key={draft.id} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs uppercase tracking-[.16em] text-[var(--accent)]">Step {draft.step} · {channelLabels[activeChannel]}</span>{activeChannel === "email" && locallyEditable && <button disabled={busy !== null || messageBusy !== null || (!approved && Boolean(!canCompose || draftEdits[emailEditKey] || inactiveTarget || !profileSaved || contact?.fictionalised || !contact?.email || contact.doNotContact))} onClick={() => setApproval(draft, !approved)} className={`rounded-md border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${approved ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--muted)]"}`}>{messageBusy === draft.id ? "Saving approval…" : approved ? "Revoke approval" : draftEdits[emailEditKey] ? "Save edits before approval" : contact?.fictionalised ? "Real contact required" : !canCompose ? "Draft approval unavailable" : "Approve draft"}</button>}</div>
            {activeChannel === "email" && <input aria-label={`Step ${draft.step} email subject`} disabled={!locallyEditable || approved} value={edit.subject || ""} onChange={(event) => setDraftEdits((current) => ({ ...current, [key]: { ...edit, subject: event.target.value } }))} className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 font-semibold disabled:opacity-70" />}
            <textarea aria-label={`Step ${draft.step} ${channelLabels[activeChannel]} message`} disabled={!locallyEditable || (activeChannel === "email" && approved)} value={edit.body} onChange={(event) => setDraftEdits((current) => ({ ...current, [key]: { ...edit, body: event.target.value } }))} className="mt-3 min-h-40 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--input)] p-3 text-sm leading-6 text-[var(--muted)] disabled:opacity-70" />
            <div className="mt-3 flex flex-wrap items-center gap-3"><button disabled={!locallyEditable || (activeChannel === "email" && approved) || messageBusy !== null || !draftEdits[key]} onClick={() => saveDraft(draft)} className="rounded-md border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-40">{messageBusy === key ? "Saving…" : "Save edits"}</button><span className="text-xs text-[var(--muted)]">{draft.scheduledFor ? new Date(draft.scheduledFor).toLocaleDateString("en-AU", { dateStyle: "medium" }) : "Unscheduled"}</span><span className="text-xs text-[var(--muted)]">Evidence: {draft.signalIds.length ? draft.signalIds.join(", ") : "No company claim"}</span>{activeChannel === "email" ? <><span className="text-xs text-[var(--muted)]">Status: {draft.state}</span>{draft.gmailDraftSaved && <span className="text-xs text-[var(--status-emerald)]">Historical Gmail draft</span>}</> : <span className="text-xs text-[var(--muted)]">Saved workspace copy</span>}</div>
            {activeChannel==='email'&&approved&&!draft.gmailDraftSaved&&deliveryAvailable&&<button disabled={messageBusy!==null||busy!==null||!canCompose||inactiveTarget||contact?.doNotContact||contact?.fictionalised||!contact?.email} onClick={()=>sendDraft(draft)} className="mt-4 rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-40">{messageBusy===draft.id?'Checking send…':uncertainSends[draft.id]?'Check send status':'Send approved email'}</button>}
          </article>;
        })}</>}
      </div>
    </section>
  </div>;
}
