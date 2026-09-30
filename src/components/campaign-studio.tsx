"use client";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, Check, Clock3, Pause, Play, Plus, Send, ShieldAlert, X } from "lucide-react";
import { hasOutreachDetails } from "@/domain/outreach-contact";
import { campaignDefinition, type CampaignDefinition, type CampaignStep } from "@/domain/campaign";
import { CampaignMessagesEditor } from "@/components/campaign-messages-editor";
import { CampaignSequenceEditor } from "@/components/campaign-sequence-editor";

type SequenceView = { id: string; name: string; draft: CampaignDefinition; publishedDefinition: CampaignDefinition | null; publishedVersion: number; n8nWorkflowId: string | null; updatedAt: string };
type EnrolmentView = { id: string; sequenceId: string; sequenceName: string; version: number; contactId: string; state: string; stopReason: string | null; stepIndex: number; nextStepAt: string | null; nextStepTitle: string | null; totalSteps: number; recipientEmail: string; startedAt: string; lastSentAt: string | null; activity: { action: string; at: string }[] };
type ContactView = { id: string; name: string; company: string; email: string | null; fictionalised: boolean; doNotContact: boolean };
export type StudioData = { sequences: SequenceView[]; enrolments: EnrolmentView[]; contacts: ContactView[]; mailbox: { address: string | null; ready: boolean; dailyCap: number } | null };
type EditableDefinition = { steps: CampaignStep[]; schemaVersion?: 1 };

const card = "rounded-2xl border border-[var(--border)] bg-[var(--panel)]";
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 text-sm font-medium hover:bg-[var(--panel-raised)] disabled:cursor-not-allowed disabled:opacity-40";
const primary = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40";

function newDefinition(): CampaignDefinition {
  return { schemaVersion: 1, steps: [
    { id: crypto.randomUUID(), kind: "email", title: "First introduction", subject: "A private introduction to {{company_name}}", body: "Hi {{first_name}},\n\nI wanted to introduce myself regarding {{company_name}}. Would you be open to a brief, confidential conversation?\n\nBest regards" },
    { id: crypto.randomUUID(), kind: "wait", title: "Wait three days", days: 3 },
    { id: crypto.randomUUID(), kind: "email", title: "Thoughtful follow-up", subject: "Following up on {{company_name}}", body: "Hi {{first_name}},\n\nI wanted to follow up on my note about {{company_name}}. If a conversation would be useful, I would be glad to arrange one.\n\nBest regards" },
  ] };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function dateLabel(value: string | null) { return value ? new Date(value).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : "—"; }
function statusLabel(enrolment: EnrolmentView) {
  if (enrolment.state === "needs_review") return enrolment.stopReason === "existing_conversation" ? "Existing conversation" : "Needs review";
  if (enrolment.state === "stopped" && enrolment.stopReason === "reply_received") return "Replied — stopped";
  return enrolment.state.charAt(0).toUpperCase() + enrolment.state.slice(1);
}

export function CampaignStudio({ mandateId, mandateName, initialData, initialView = "contacts", enrichmentContactIds }: { mandateId: string; mandateName: string; initialData: StudioData; initialView?: "contacts" | "sequences"; enrichmentContactIds?: string[] }) {
  const [enrichmentFilter, setEnrichmentFilter] = useState(enrichmentContactIds !== undefined);
  const [data, setData] = useState<StudioData>(initialData);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sequenceView, setSequenceView] = useState<"messages" | "flow">("messages");
  const [view, setView] = useState<"contacts" | "sequences">(initialView);
  const initialSequence = initialView === "sequences" ? initialData.sequences[0] : undefined;
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(initialSequence?.id || null);
  const [draftName, setDraftName] = useState(initialSequence?.name || "");
  const [draft, setDraft] = useState<EditableDefinition | null>(() => initialSequence ? structuredClone(initialSequence.draft) : null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(initialSequence?.draft.steps[0]?.id || null);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [enrolSequenceId, setEnrolSequenceId] = useState("");
  const [search, setSearch] = useState("");
  const [openContactId, setOpenContactId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await requestJson<StudioData>(`/api/mandates/${mandateId}/campaigns`);
    setData(next);
    return next;
  }, [mandateId]);

  const chooseSequence = useCallback((sequence: SequenceView) => {
    setSelectedSequenceId(sequence.id);
    setDraftName(sequence.name);
    setDraft(structuredClone(sequence.draft));
    setSelectedStepId(sequence.draft.steps[0]?.id || null);
    setView("sequences");
  }, []);

  const selectedSequence = data?.sequences.find(sequence => sequence.id === selectedSequenceId);
  const enrolledByContact = useMemo(() => new Map((data?.enrolments || []).filter(item => ["active", "paused", "needs_review"].includes(item.state)).map(item => [item.contactId, item])), [data]);
  const visibleContacts = useMemo(() => (data?.contacts || []).filter(contact => hasOutreachDetails(contact) && (!enrichmentFilter || enrichmentContactIds?.includes(contact.id)) && `${contact.name} ${contact.company} ${contact.email || ""}`.toLowerCase().includes(search.toLowerCase())), [data, search, enrichmentFilter, enrichmentContactIds]);

  const openContact = data?.contacts.find(contact => contact.id === openContactId);
  const openEnrolment = openContact ? enrolledByContact.get(openContact.id) || data?.enrolments.find(item => item.contactId === openContact.id) : undefined;
  const published = data?.sequences.filter(sequence => sequence.publishedVersion > 0) || [];
  const enrolSequence = published.find(sequence => sequence.id === enrolSequenceId) || published[0];
  const firstStep = enrolSequence?.publishedDefinition?.steps[0];
  const selectedContacts = (data?.contacts || []).filter(contact => selectedContactIds.includes(contact.id));

  async function perform(work: () => Promise<string>) {
    setBusy(true); setError(""); setNotice("");
    try { const message = await work(); setNotice(message); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed"); }
    finally { setBusy(false); }
  }

  async function createSequence() {
    const definition = newDefinition();
    await perform(async () => {
      const created = await requestJson<SequenceView>(`/api/mandates/${mandateId}/campaigns`, { method: "POST", body: JSON.stringify({ mandateId, name: "New introduction sequence", definition }) });
      setSelectedSequenceId(created.id); setDraftName(created.name); setDraft(definition); setSelectedStepId(definition.steps[0].id); setView("sequences");
      return "Sequence created as a draft. Publish it before adding contacts.";
    });
  }

  async function saveSequence(publish: boolean) {
    if (!selectedSequenceId || !draft) return;
    const parsed = campaignDefinition.safeParse({ ...draft, schemaVersion: 1 });
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(". ")); return; }
    await perform(async () => {
      await requestJson(`/api/campaigns/${selectedSequenceId}`, { method: "PUT", body: JSON.stringify({ name: draftName, definition: parsed.data }) });
      if (publish) {
        const snapshot = await requestJson<{ version: number }>(`/api/campaigns/${selectedSequenceId}/publish`, { method: "POST" });
        return `Published version ${snapshot.version}. Existing contacts remain on their original version.`;
      }
      return "Draft saved. Existing contacts remain on their published version.";
    });
  }

  async function subscribe() {
    if (!enrolSequence || !selectedContactIds.length) return;
    await perform(async () => {
      const result = await requestJson<{ enrolments: { state: string }[] }>(`/api/campaigns/${enrolSequence.id}/enrolments`, { method: "POST", body: JSON.stringify({ contactIds: selectedContactIds, confirmation: true }) });
      setEnrolOpen(false); setSelectedContactIds([]);
      const held = result.enrolments.filter(item => item.state === "needs_review").length;
      return held ? `${result.enrolments.length - held} contact(s) scheduled. ${held} held for an existing conversation.` : `${result.enrolments.length} contact(s) subscribed. Their first email is now scheduled.`;
    });
  }

  async function action(enrolment: EnrolmentView, kind: "pause" | "resume" | "stop" | "review_existing_conversation") {
    await perform(async () => {
      await requestJson(`/api/campaign-enrolments/${enrolment.id}/action`, { method: "POST", body: JSON.stringify({ action: kind }) });
      return kind === "review_existing_conversation" ? "Conversation reviewed; automation resumed." : `Automation ${kind === "pause" ? "paused" : kind === "resume" ? "resumed" : "stopped"}.`;
    });
  }

  return <div className="mx-auto max-w-[1680px] space-y-6 p-5 sm:p-8">
    <Link href={initialView === "contacts" ? `/mandates/${mandateId}?tab=targets` : `/mandates/${mandateId}/people`} className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={16} /> {initialView === "contacts" ? "Back to companies" : "Back to people"}</Link>
    <header className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--muted)]">{mandateName}</p><h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{initialView === "contacts" ? "People" : "Sequences"}</h1><p className="mt-2 text-sm text-[var(--muted)]">{initialView === "contacts" ? "Contacts with email addresses from research and Firmable enrichment, with outreach progress." : "Publish a sequence and subscribe contacts using your connected mailbox."}</p></div><div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-sm"><p className="font-semibold">Your sending mailbox</p><p className="mt-1 text-[var(--muted)]">{data?.mailbox?.address || "Not connected"} · {data?.mailbox?.ready ? "Ready" : "Reconnect required"}</p></div></header>
    {!data?.mailbox?.ready && <div role="alert" className="flex gap-3 rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] p-4 text-sm"><ShieldAlert size={19} /><p>Connect your own Gmail with compose and read-only access before subscribing contacts. <Link href="/settings" className="underline">Open Settings</Link></p></div>}
    {error && <div role="alert" className="rounded-xl border border-red-800 bg-[var(--error-surface)] p-4 text-sm text-[var(--status-red)]">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-800 bg-[var(--success-surface)] p-4 text-sm text-[var(--status-emerald)]">{notice}</div>}
    {enrichmentFilter && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] p-4 text-sm"><p>Showing only people from your latest enrichment · {enrichmentContactIds?.length || 0} contacts</p><Link className="font-semibold underline" href={`/mandates/${mandateId}/people`} onClick={() => { setEnrichmentFilter(false); setSelectedContactIds([]); }}>Show all people</Link></div>}
    {view === "contacts" ? <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">{[["Active", data.enrolments.filter(item => item.state === "active").length], ["Paused or review", data.enrolments.filter(item => ["paused", "needs_review"].includes(item.state)).length], ["Replied", data.enrolments.filter(item => item.stopReason === "reply_received").length]].map(([label, value]) => <div key={label} className={`${card} p-4`}><p className="text-xs uppercase tracking-wider text-[var(--muted)]">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}</div>
      <section className={`${card} overflow-hidden`}><div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] p-5"><div><h2 className="text-xl font-semibold">People and progress</h2><p className="mt-1 text-sm text-[var(--muted)]">People with an email address from research or Firmable enrichment. Select contacts to assign them to a published sequence.</p></div><button type="button" className={primary} disabled={!selectedContactIds.length || !published.length || !data.mailbox?.ready} onClick={() => { setEnrolSequenceId(published[0]?.id || ""); setEnrolOpen(true); }}><Plus size={17} /> Subscribe {selectedContactIds.length || "selected"}</button></div><div className="border-b border-[var(--border)] p-4"><input aria-label="Search people" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search people or companies" className="min-h-11 w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm" /></div><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-[var(--panel-raised)] text-xs uppercase tracking-wider text-[var(--muted)]"><tr>{["Select", "Person", "Sequence", "Status", "Current action", "Next"].map(heading => <th key={heading} className="p-4">{heading}</th>)}</tr></thead><tbody>{visibleContacts.map(contact => { const enrolment = enrolledByContact.get(contact.id) || data.enrolments.find(item => item.contactId === contact.id); const selectable = Boolean(contact.email && !contact.fictionalised && !contact.doNotContact && !enrolledByContact.has(contact.id)); return <tr key={contact.id} className="border-t border-[var(--border)]"><td className="p-4"><input type="checkbox" aria-label={`Select ${contact.name}`} disabled={!selectable} checked={selectedContactIds.includes(contact.id)} onChange={event => setSelectedContactIds(current => event.target.checked ? [...current, contact.id] : current.filter(id => id !== contact.id))} /></td><td className="p-4"><button type="button" className="text-left font-semibold underline underline-offset-4" onClick={() => setOpenContactId(contact.id)}>{contact.name}</button><p className="mt-1 text-xs text-[var(--muted)]">{contact.company} · {contact.email || "No email"}</p></td><td className="p-4">{enrolment ? `${enrolment.sequenceName} · v${enrolment.version}` : "—"}</td><td className="p-4">{enrolment ? statusLabel(enrolment) : "Saved contact"}</td><td className="p-4">{enrolment?.state === "active" ? enrolment.nextStepTitle : enrolment?.stopReason?.replaceAll("_", " ") || "—"}</td><td className="p-4">{dateLabel(enrolment?.nextStepAt || null)}</td></tr>; })}</tbody></table>{!visibleContacts.length && <p className="p-8 text-center text-sm text-[var(--muted)]">{enrichmentFilter ? "No contacts with usable email addresses were returned by this enrichment. Show all people to see earlier contacts." : "No contacts with email addresses found. Research or enrich people from a company worksheet to add them here."}</p>}</div></section>
    </div> : <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-semibold">Your sequences</h2><p className="mt-1 text-sm text-[var(--muted)]">Publishing creates a new immutable version; subscribed contacts continue on theirs.</p></div><button type="button" className={button} disabled={busy} onClick={createSequence}><Plus size={17} /> New sequence</button></div><div className="grid gap-4 xl:grid-cols-[235px_minmax(0,1fr)]"><aside className={`${card} h-fit p-3`}><p className="px-2 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Sequences</p>{data.sequences.map(sequence => <button key={sequence.id} type="button" className={`mt-1 w-full rounded-xl border p-3 text-left ${selectedSequenceId === sequence.id ? "border-[var(--accent)] bg-[var(--panel-raised)]" : "border-transparent hover:bg-[var(--panel-raised)]"}`} onClick={() => chooseSequence(sequence)}><span className="block text-sm font-semibold">{sequence.name}</span><span className="mt-1 block text-xs text-[var(--muted)]">{sequence.publishedVersion ? `Published v${sequence.publishedVersion}` : "Draft"}</span></button>)}{!data.sequences.length && <p className="px-2 py-4 text-xs text-[var(--muted)]">No sequences yet.</p>}</aside>{draft && selectedSequence ? <section className={`${card} min-w-0 overflow-hidden`}><div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--border)] p-5"><label className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Sequence name<input value={draftName} onChange={event => setDraftName(event.target.value)} className="mt-2 block min-h-11 w-72 max-w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-base font-semibold normal-case text-[var(--foreground)]" /></label><div className="flex gap-2"><button type="button" className={button} disabled={busy} onClick={() => saveSequence(false)}>Save draft</button><button type="button" className={primary} disabled={busy} onClick={() => saveSequence(true)}><Check size={16} /> Publish new version</button></div></div><div className="flex gap-2 border-b border-[var(--border)] px-5" aria-label="Sequence views">{([["messages", "Messages"], ["flow", "Sequence flow"]] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={sequenceView === key} onClick={() => setSequenceView(key)} className={`min-h-12 border-b-2 px-3 text-sm font-semibold ${sequenceView === key ? "border-[var(--foreground)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)]"}`}>{label}</button>)}</div>{sequenceView === "messages" ? <CampaignMessagesEditor key={selectedSequenceId} draft={draft} selectedStepId={selectedStepId} onChange={setDraft} onSelect={setSelectedStepId} contacts={data.contacts.filter(contact => !contact.fictionalised && !contact.doNotContact)} /> : <CampaignSequenceEditor draft={draft} selectedStepId={selectedStepId} onChange={setDraft} onSelect={setSelectedStepId} />}<div className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--muted)]">Current published version: {selectedSequence.publishedVersion || "none"}. {selectedSequence.n8nWorkflowId && <a className="ml-2 font-medium underline" href={`https://n8n.mlai.au/workflow/${selectedSequence.n8nWorkflowId}`} target="_blank" rel="noopener noreferrer">Open published workflow in n8n</a>}</div></section> : <div className={`${card} grid min-h-72 place-items-center p-8 text-sm text-[var(--muted)]`}>Select or create a sequence.</div>}</div></div>}
    {openContact && <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onMouseDown={event => { if (event.target === event.currentTarget) setOpenContactId(null); }}><section role="dialog" aria-modal="true" aria-label={`${openContact.name} automation`} className="h-full w-full max-w-lg overflow-y-auto border-l border-[var(--border)] bg-[var(--background)] p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-[var(--muted)]">Contact automation</p><h2 className="mt-2 text-2xl font-semibold">{openContact.name}</h2><p className="text-sm text-[var(--muted)]">{openContact.company} · {openContact.email}</p></div><button type="button" className={button} aria-label="Close" onClick={() => setOpenContactId(null)}><X size={16} /></button></div>{openEnrolment ? <><div className={`${card} mt-6 space-y-3 p-4 text-sm`}><p><strong>Sequence:</strong> {openEnrolment.sequenceName} · version {openEnrolment.version}</p><p><strong>Status:</strong> {statusLabel(openEnrolment)}</p><p><strong>Position:</strong> step {Math.min(openEnrolment.stepIndex + 1, openEnrolment.totalSteps)} of {openEnrolment.totalSteps}</p><p><strong>Next action:</strong> {openEnrolment.nextStepTitle || "None"}</p><p><strong>Scheduled:</strong> {dateLabel(openEnrolment.nextStepAt)}</p><p><strong>Last sent:</strong> {dateLabel(openEnrolment.lastSentAt)}</p>{openEnrolment.stopReason && <p><strong>Reason:</strong> {openEnrolment.stopReason.replaceAll("_", " ")}</p>}</div><div className="mt-5 flex flex-wrap gap-2">{openEnrolment.state === "active" && <button type="button" className={button} disabled={busy} onClick={() => action(openEnrolment, "pause")}><Pause size={16} /> Pause</button>}{openEnrolment.state === "paused" && <button type="button" className={primary} disabled={busy} onClick={() => action(openEnrolment, "resume")}><Play size={16} /> Resume</button>}{openEnrolment.state === "needs_review" && openEnrolment.stopReason === "existing_conversation" && <button type="button" className={primary} disabled={busy} onClick={() => action(openEnrolment, "review_existing_conversation")}><Check size={16} /> Reviewed; resume</button>}{["active", "paused", "needs_review"].includes(openEnrolment.state) && <button type="button" className={button} disabled={busy} onClick={() => action(openEnrolment, "stop")}>Stop permanently</button>}</div><h3 className="mt-8 text-sm font-semibold">Activity</h3><ol className="mt-3 space-y-3 border-l border-[var(--border)] pl-4">{openEnrolment.activity.map((event, index) => <li key={`${event.action}-${index}`} className="text-sm"><p className="font-medium">{event.action.replace(/^campaign\./, "").replaceAll("_", " ")}</p><p className="text-xs text-[var(--muted)]">{dateLabel(event.at)}</p></li>)}</ol></> : <p className="mt-6 text-sm text-[var(--muted)]">This contact has not been subscribed to one of your sequences.</p>}</section></div>}
    {enrolOpen && enrolSequence && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setEnrolOpen(false); }}><section role="dialog" aria-modal="true" aria-label="Confirm automation" className={`${card} w-full max-w-xl p-6 shadow-2xl`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Start automation</p><h2 className="mt-1 text-xl font-semibold">Subscribe {selectedContacts.length} contact{selectedContacts.length === 1 ? "" : "s"}</h2></div><button type="button" className={button} aria-label="Close" onClick={() => setEnrolOpen(false)}><X size={16} /></button></div><p className="mt-3 text-sm text-[var(--muted)]">Confirming starts this published sequence for each selected contact. Emails will send automatically during the sending window unless paused or a reply is found.</p><label className="mt-5 block text-sm font-medium">Sequence<select value={enrolSequence.id} onChange={event => setEnrolSequenceId(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3">{published.map(sequence => <option key={sequence.id} value={sequence.id}>{sequence.name} · v{sequence.publishedVersion}</option>)}</select></label><div className={`${card} mt-5 p-4`}><p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">First action</p><p className="mt-2 flex items-center gap-2 text-sm font-semibold"><Send size={16} /> {firstStep?.kind === "email" ? `Send email: ${firstStep.title}` : "Invalid sequence"}</p><p className="mt-2 text-xs text-[var(--muted)]">From {data?.mailbox?.address}. Existing conversations are checked before subscription and again immediately before sending.</p></div><div className="mt-4 max-h-32 overflow-y-auto text-sm">{selectedContacts.map(contact => <p key={contact.id} className="py-1">{contact.name} · <span className="text-[var(--muted)]">{contact.email}</span></p>)}</div><div className="mt-6 flex justify-end gap-2"><button type="button" className={button} onClick={() => setEnrolOpen(false)}>Cancel</button><button type="button" className={primary} disabled={busy} onClick={subscribe}><Play size={16} /> Confirm and start</button></div></section></div>}
    <p className="flex items-center gap-2 text-xs text-[var(--muted)]"><Clock3 size={14} /> Sending window: weekdays, 9 am–5 pm Melbourne time. This Gmail-first build does not enable LinkedIn or WhatsApp sends.</p>
  </div>;
}
