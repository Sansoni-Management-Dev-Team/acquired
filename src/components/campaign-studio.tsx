"use client";
import { campaignReviewAction } from "@/domain/campaign-review-action";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { gmailStatusMessages, type GmailConnectionStatus } from "@/domain/gmail-connection";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Clock3, Pause, Play, Plus, Send, ShieldAlert, X } from "lucide-react";
import { matchesContactFilter, missingCampaignDetails, campaignChannels, type ContactFilter, type CreateContactRequest } from "@/domain/contact-record";
import { campaignDraftDefinition, campaignDefinition, campaignStepLabel, type CampaignDefinition } from "@/domain/campaign";
import { useCampaignHistory } from "@/hooks/use-campaign-history";
import type { CampaignRun } from "@/domain/campaign-run";
import { CampaignSequenceEditor } from "@/components/campaign-sequence-editor";

import { replyChannelLabel, type ReplyChannel } from "@/domain/campaign-replies";

type SequenceView = { id: string; name: string; draft: CampaignDefinition; publishedDefinition: CampaignDefinition | null; publishedVersion: number; n8nWorkflowId: string | null; updatedAt: string };
type EnrolmentView = { lastReply?: { channel: ReplyChannel; receivedAt: string } | null; run?: CampaignRun; id: string; sequenceId: string; sequenceName: string; version: number; contactId: string; state: string; stopReason: string | null; stepIndex: number; nextStepAt: string | null; nextStepTitle: string | null; totalSteps: number; recipientEmail: string | null; startedAt: string; lastSentAt: string | null; activity: { action: string; at: string }[] };
type ContactView = { id: string; name: string; company: string; email: string | null; phone?: string | null; linkedinUrl?: string | null; role?: string; fictionalised: boolean; doNotContact: boolean };
export type StudioData = { replyMonitoring?: { mode: "off" | "observe" | "enforce"; monitors: { channel: ReplyChannel; lastSuccessAt: string | null; error: string | null; healthy: boolean }[] }; n8nUrl?: string | null; sequences: SequenceView[]; enrolments: EnrolmentView[]; contacts: ContactView[]; mailbox: { address: string | null; ready: boolean; status?: GmailConnectionStatus; dailyCap: number } | null };


const card = "rounded-2xl border border-[var(--border)] bg-[var(--panel)]";
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 text-sm font-medium hover:bg-[var(--panel-raised)] disabled:cursor-not-allowed disabled:opacity-40";
const personName = (contact: ContactView) => contact.name.trim() || "Unnamed person";
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
  if (enrolment.state === "active" && enrolment.stopReason === "reply_monitor_wait") return "Waiting for reply checks";
  if (enrolment.state === "needs_review") return enrolment.stopReason === "initial_conversation_requires_review" ? "Review first conversation" : enrolment.stopReason === "existing_conversation" ? "Existing conversation" : "Needs review";
  if (enrolment.state === "stopped" && enrolment.stopReason === "reply_received") return `${enrolment.lastReply ? replyChannelLabel(enrolment.lastReply.channel) : "Email"} reply — stopped`;
  return enrolment.state.charAt(0).toUpperCase() + enrolment.state.slice(1);
}

export function CampaignStudio({ mandateId, mandateName, initialData, initialView = "contacts", enrichmentContactIds }: { mandateId: string; mandateName: string; initialData: StudioData; initialView?: "contacts" | "sequences"; enrichmentContactIds?: string[] }) {
  const [enrichmentFilter, setEnrichmentFilter] = useState(enrichmentContactIds !== undefined);
  const [data, setData] = useState<StudioData>(initialData);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"contacts" | "sequences">(initialView);
  const initialSequence = initialView === "sequences" ? initialData.sequences[0] : undefined;
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(initialSequence?.id || null);
  const [draftName, setDraftName] = useState(initialSequence?.name || "");
  const { draft, setDraft, resetDraft, ...history } = useCampaignHistory(initialSequence ? structuredClone(initialSequence.draft) : null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(initialSequence?.draft.steps[0]?.id || null);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [enrolSequenceId, setEnrolSequenceId] = useState("");
  const [search, setSearch] = useState("");
  const [contactFilter, setContactFilter] = useState<ContactFilter>("all");
  const [addPersonOpen, setAddPersonOpen] = useState(false);
  const [personDraft, setPersonDraft] = useState<CreateContactRequest>({});
  const [openContactId, setOpenContactId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await requestJson<StudioData>(`/api/mandates/${mandateId}/campaigns`);
    setData(next);
    return next;
  }, [mandateId]);

  useEffect(() => {
    if (view !== "sequences") return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await requestJson<StudioData>(`/api/mandates/${mandateId}/campaigns`);
        if (!cancelled) setData(next);
      } catch { /* Retain the last known status on a temporary polling failure. */ }
    };
    const timer = setInterval(() => { void refresh(); }, 15000);
    void refresh();
    return () => { cancelled = true; clearInterval(timer); };
  }, [mandateId, view]);

  const chooseSequence = useCallback((sequence: SequenceView) => {
    setSelectedSequenceId(sequence.id);
    setDraftName(sequence.name);
    resetDraft(structuredClone(sequence.draft));
    setSelectedStepId(sequence.draft.steps[0]?.id || null);
    setView("sequences");
  }, [resetDraft]);

  const selectedSequence = data?.sequences.find(sequence => sequence.id === selectedSequenceId);
  const enrolledByContact = useMemo(() => new Map((data?.enrolments || []).filter(item => ["active", "paused", "needs_review"].includes(item.state)).map(item => [item.contactId, item])), [data]);
  const visibleContacts = useMemo(() => (data?.contacts || []).filter(contact => !contact.fictionalised && matchesContactFilter(contact, contactFilter) && (!enrichmentFilter || enrichmentContactIds?.includes(contact.id)) && `${personName(contact)} ${contact.company} ${contact.email || ""} ${contact.phone || ""} ${contact.linkedinUrl || ""}`.toLowerCase().includes(search.toLowerCase())), [data, search, contactFilter, enrichmentFilter, enrichmentContactIds]);

  const openContact = data?.contacts.find(contact => contact.id === openContactId);
  const openEnrolment = openContact ? enrolledByContact.get(openContact.id) || data?.enrolments.find(item => item.contactId === openContact.id) : undefined;
  const published = data?.sequences.filter(sequence => sequence.publishedVersion > 0) || [];
  const enrolSequence = published.find(sequence => sequence.id === enrolSequenceId) || published[0];
  const firstStep = enrolSequence?.publishedDefinition?.steps[0];
  const initialSplit = enrolSequence?.publishedDefinition?.splits?.find(split => split.afterStepId === "start");
  const selectedContacts = (data?.contacts || []).filter(contact => selectedContactIds.includes(contact.id));

  const enrolDefinition = enrolSequence?.publishedDefinition;
  const missingRecipients = enrolDefinition ? selectedContacts.flatMap(contact => {
    const missing = missingCampaignDetails(enrolDefinition, contact);
    return missing.length ? [`${personName(contact)}: needs ${missing.join(" and ")}`] : [];
  }) : ["Select a published sequence"];
  const needsMailbox = enrolDefinition ? campaignChannels(enrolDefinition).includes("email") : false;

  async function addPerson() {
    await perform(async () => {
      await requestJson(`/api/mandates/${mandateId}/contacts`, { method: "POST", body: JSON.stringify(personDraft) });
      setPersonDraft({}); setAddPersonOpen(false); setEnrichmentFilter(false); setContactFilter("all");
      return "Person added.";
    });
  }

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
      setSelectedSequenceId(created.id); setDraftName(created.name); resetDraft(definition); setSelectedStepId(definition.steps[0].id); setView("sequences");
      return "Sequence created as a draft. Publish it before adding contacts.";
    });
  }

  async function saveSequence(publish: boolean) {
    if (!selectedSequenceId || !draft) return;
    const parsed = (publish ? campaignDefinition : campaignDraftDefinition).safeParse({ ...draft, schemaVersion: 1 });
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(". ")); return; }
    await perform(async () => {
      await requestJson(`/api/campaigns/${selectedSequenceId}`, { method: "PUT", body: JSON.stringify({ name: draftName, definition: parsed.data }) });
      if (publish) {
        const snapshot = await requestJson<{ version: number; n8nWorkflowId: string | null; localDevelopment: boolean }>(`/api/campaigns/${selectedSequenceId}/publish`, { method: "POST" });
        const destination = snapshot.n8nWorkflowId ? "Workflow created." : `Published ${snapshot.localDevelopment ? "locally" : "using the app worker"}; an external workflow was not created because workflow integration is not enabled.`;
        return `Published version ${snapshot.version}. ${destination} Existing contacts remain on their original version.`;
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
      return held ? `${result.enrolments.length - held} contact(s) scheduled. ${held} held for review.` : `${result.enrolments.length} contact(s) subscribed. Their first action is now scheduled.`;
    });
  }

  async function action(enrolment: EnrolmentView, kind: "pause" | "resume" | "stop" | "review_existing_conversation" | "retry_preflight") {
    await perform(async () => {
      await requestJson(`/api/campaign-enrolments/${enrolment.id}/action`, { method: "POST", body: JSON.stringify({ action: kind }) });
      return kind === "review_existing_conversation" ? "Conversation reviewed; automation resumed." : `Automation ${kind === "pause" ? "paused" : kind === "resume" ? "resumed" : "stopped"}.`;
    });
  }

  return <div className="mx-auto max-w-[1680px] space-y-6 p-5 sm:p-8">
    <Link href={initialView === "contacts" ? `/mandates/${mandateId}?tab=targets` : `/mandates/${mandateId}/people`} className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={16} /> {initialView === "contacts" ? "Back to companies" : "Back to people"}</Link>
    <header className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--muted)]">{mandateName}</p><h1 className="mt-2 text-3xl font-semibold sm:text-4xl">{initialView === "contacts" ? "People" : "Sequences"}</h1><p className="mt-2 text-sm text-[var(--muted)]">{initialView === "contacts" ? "People and their available contact details, with outreach progress." : "Publish a sequence and subscribe contacts using your connected accounts."}</p></div></header>
    {!data.mailbox?.ready && <div role="alert" className="flex gap-3 rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] p-4 text-sm"><ShieldAlert size={19} /><p>{gmailStatusMessages[data?.mailbox?.status ?? (data?.mailbox ? "reconnect_required" : "not_connected")]} <Link href="/settings" className="underline">Open Settings</Link></p></div>}
    {error && <div role="alert" className="rounded-xl border border-red-800 bg-[var(--error-surface)] p-4 text-sm text-[var(--status-red)]">{error}</div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-800 bg-[var(--success-surface)] p-4 text-sm text-[var(--status-emerald)]">{notice}</div>}
    {data.replyMonitoring && data.replyMonitoring.mode !== "off" && <section className={`${card} space-y-3 p-4`} aria-label="Reply monitoring"><p className="text-sm font-semibold">Reply monitoring {data.replyMonitoring.mode === "observe" ? "· Observation mode" : "· Stops outreach across channels"}</p><div className="flex flex-wrap gap-4">{data.replyMonitoring.monitors.length ? data.replyMonitoring.monitors.map(monitor => <div key={monitor.channel} className="text-sm"><p>{replyChannelLabel(monitor.channel)} · {monitor.healthy ? "Monitoring" : "Check required"}</p><p className="text-xs text-[var(--muted)]">Last checked: {dateLabel(monitor.lastSuccessAt)}</p>{monitor.error && <p className="mt-1 text-xs">{monitor.error}</p>}</div>) : <p className="text-sm text-[var(--muted)]">Checks begin when contacts are subscribed.</p>}</div></section>}
    {enrichmentFilter && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] p-4 text-sm"><p>Showing only people from your latest enrichment · {enrichmentContactIds?.length || 0} contacts</p><Link className="font-semibold underline" href={`/mandates/${mandateId}/people`} onClick={() => { setEnrichmentFilter(false); setSelectedContactIds([]); }}>Show all people</Link></div>}
    {view === "contacts" ? <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">{[["Active", data.enrolments.filter(item => item.state === "active").length], ["Paused or review", data.enrolments.filter(item => ["paused", "needs_review"].includes(item.state)).length], ["Replied", data.enrolments.filter(item => item.stopReason === "reply_received").length]].map(([label, value]) => <div key={label} className={`${card} p-4`}><p className="text-xs uppercase tracking-wider text-[var(--muted)]">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}</div>
      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] p-5">
          <div><h2 className="text-xl font-semibold">People and progress</h2><p className="mt-1 text-sm text-[var(--muted)]">Filter by available contact details, then select people for a published sequence.</p></div>
          <div className="flex gap-2"><button type="button" className={button} onClick={() => setAddPersonOpen(true)}><Plus size={17} /> Add person</button><button type="button" className={primary} disabled={!selectedContactIds.length || !published.length} onClick={() => { setEnrolSequenceId(published[0]?.id || ""); setEnrolOpen(true); }}><Plus size={17} /> Subscribe {selectedContactIds.length || "selected"}</button></div>
        </div>
        <div className="flex flex-wrap items-end gap-4 border-b border-[var(--border)] p-4">
          <input aria-label="Search people" value={search} onChange={event => { setSearch(event.target.value); setSelectedContactIds([]); }} placeholder="Search people or companies" className="min-h-11 w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm" />
          <label className="text-sm">Contact details<select aria-label="Filter people by contact details" value={contactFilter} onChange={event => { setContactFilter(event.target.value as ContactFilter); setSelectedContactIds([]); }} className="ml-2 min-h-11 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3"><option value="all">All people</option><option value="linkedin">Has LinkedIn</option><option value="email">Has email</option><option value="phone">Has phone</option></select></label>
          <button type="button" className={button} disabled={!visibleContacts.some(contact => !contact.doNotContact && !enrolledByContact.has(contact.id))} onClick={() => setSelectedContactIds(visibleContacts.filter(contact => !contact.doNotContact && !enrolledByContact.has(contact.id)).map(contact => contact.id))}>Select all shown</button>
          {selectedContactIds.length > 0 && <button type="button" className={button} onClick={() => setSelectedContactIds([])}>Clear selection</button>}
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-[var(--panel-raised)] text-xs uppercase tracking-wider text-[var(--muted)]"><tr>{["Select", "Person", "Email", "LinkedIn", "Phone", "Sequence", "Status", "Current action", "Next"].map(heading => <th key={heading} className="p-4">{heading}</th>)}</tr></thead>
          <tbody>{visibleContacts.map(contact => {
            const enrolment = enrolledByContact.get(contact.id) || data.enrolments.find(item => item.contactId === contact.id);
            const selectable = !contact.fictionalised && !contact.doNotContact && !enrolledByContact.has(contact.id);
            return <tr key={contact.id} className="border-t border-[var(--border)]">
              <td className="p-4"><input type="checkbox" aria-label={`Select ${personName(contact)}`} disabled={!selectable} checked={selectedContactIds.includes(contact.id)} onChange={event => setSelectedContactIds(current => event.target.checked ? [...current, contact.id] : current.filter(id => id !== contact.id))} /></td>
              <td className="p-4"><button type="button" className="text-left font-semibold underline underline-offset-4" onClick={() => setOpenContactId(contact.id)}>{personName(contact)}</button>{contact.company && <p className="mt-1 text-xs text-[var(--muted)]">{contact.company}</p>}{contact.role && <p className="mt-1 text-xs text-[var(--muted)]">{contact.role}</p>}</td>
              <td className="p-4">{contact.email || "—"}</td><td className="p-4">{contact.linkedinUrl ? <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="underline">Profile</a> : "—"}</td><td className="p-4">{contact.phone || "—"}</td>
              <td className="p-4">{enrolment ? `${enrolment.sequenceName} · v${enrolment.version}` : "—"}</td><td className="p-4">{enrolment ? statusLabel(enrolment) : contact.doNotContact ? "Do not contact" : "Saved contact"}</td><td className="p-4">{enrolment?.state === "active" ? enrolment.nextStepTitle : enrolment?.stopReason?.replaceAll("_", " ") || "—"}</td><td className="p-4">{dateLabel(enrolment?.nextStepAt || null)}</td>
            </tr>;
          })}</tbody></table>{!visibleContacts.length && <p className="p-8 text-center text-sm text-[var(--muted)]">{enrichmentFilter ? "No people were returned by this enrichment. Show all people to see earlier contacts." : "No people match these filters. Add a person or load people from a company worksheet."}</p>}</div>
      </section>
    </div> : <section className={`${card} min-w-0 overflow-hidden`}>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] p-5">
        <div className="flex min-w-0 flex-1 flex-wrap gap-4">
          <label className="min-w-0 flex-1 basis-56 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Sequence
            <select value={selectedSequenceId || ""} disabled={busy || !data.sequences.length} onChange={event => {
              const sequence = data.sequences.find(sequence => sequence.id === event.target.value);
              if (sequence) chooseSequence(sequence);
            }} className="mt-2 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm font-semibold normal-case text-[var(--foreground)] disabled:opacity-40">
              {!selectedSequence && <option value="">{data.sequences.length ? "Select a sequence" : "No sequences yet"}</option>}
              {data.sequences.map(sequence => <option key={sequence.id} value={sequence.id}>{sequence.name} · {sequence.publishedVersion ? `Published v${sequence.publishedVersion}` : "Draft"}</option>)}
            </select>
          </label>
          <label className="min-w-0 flex-1 basis-56 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Sequence name
            <input value={draftName} disabled={busy || !selectedSequence} onChange={event => setDraftName(event.target.value)} className="mt-2 block min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-base font-semibold normal-case text-[var(--foreground)] disabled:opacity-40" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy} onClick={createSequence}><Plus size={17} /> New sequence</button>
          <button type="button" className={button} disabled={busy || !draft || !selectedSequence} onClick={() => saveSequence(false)}>Save draft</button>
          <button type="button" className={primary} disabled={busy || !draft || !selectedSequence} onClick={() => saveSequence(true)}><Check size={16} /> Publish new version</button>
        </div>
      </div>
      {draft && selectedSequence ? <>
        <CampaignSequenceEditor key={selectedSequenceId} history={history} runs={data.enrolments.filter(item => item.sequenceId === selectedSequenceId && item.run).map(item => item.run!)} draft={draft} selectedStepId={selectedStepId} onChange={setDraft} onSelect={setSelectedStepId} />
        <div className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--muted)]">Current published version: {selectedSequence.publishedVersion || "none"}. {selectedSequence.publishedVersion > 0 && !selectedSequence.n8nWorkflowId && "No external workflow is connected to this version."} {selectedSequence.n8nWorkflowId && data.n8nUrl && <a className="ml-2 font-medium underline" href={`${data.n8nUrl}/workflow/${selectedSequence.n8nWorkflowId}`} target="_blank" rel="noopener noreferrer">Open published workflow</a>}</div>
      </> : <div className="grid min-h-72 place-items-center p-8 text-sm text-[var(--muted)]">{data.sequences.length ? "Select a sequence to edit." : "Create a sequence to start building your flow."}</div>}
    </section>}

    {openContact && <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onMouseDown={event => { if (event.target === event.currentTarget) setOpenContactId(null); }}><section role="dialog" aria-modal="true" aria-label={`${personName(openContact)} automation`} className="h-full w-full max-w-lg overflow-y-auto border-l border-[var(--border)] bg-[var(--background)] p-6"><div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-[var(--muted)]">Contact automation</p><h2 className="mt-2 text-2xl font-semibold">{personName(openContact)}</h2><p className="text-sm text-[var(--muted)]">{[openContact.company, openContact.email].filter(Boolean).join(" · ")}</p><p className="mt-2 text-sm text-[var(--muted)]"><span className="font-medium">Phone:</span> {openContact.phone || "Not available"}</p>{openContact.linkedinUrl && <a href={openContact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm underline">LinkedIn profile</a>}</div><button type="button" className={button} aria-label="Close" onClick={() => setOpenContactId(null)}><X size={16} /></button></div>{openEnrolment ? <><div className={`${card} mt-6 space-y-3 p-4 text-sm`}><p><strong>Sequence:</strong> {openEnrolment.sequenceName} · version {openEnrolment.version}</p><p><strong>Status:</strong> {statusLabel(openEnrolment)}</p><p><strong>Position:</strong> step {Math.min(openEnrolment.stepIndex + 1, openEnrolment.totalSteps)} of {openEnrolment.totalSteps}</p><p><strong>Next action:</strong> {openEnrolment.nextStepTitle || "None"}</p><p><strong>Scheduled:</strong> {dateLabel(openEnrolment.nextStepAt)}</p><p><strong>Last sent:</strong> {dateLabel(openEnrolment.lastSentAt)}</p>{openEnrolment.lastReply && <p><strong>Reply:</strong> {replyChannelLabel(openEnrolment.lastReply.channel)} · {dateLabel(openEnrolment.lastReply.receivedAt)}</p>}{openEnrolment.stopReason && <p><strong>Reason:</strong> {openEnrolment.stopReason.replaceAll("_", " ")}</p>}</div><div className="mt-5 flex flex-wrap gap-2">{openEnrolment.state === "active" && <button type="button" className={button} disabled={busy} onClick={() => action(openEnrolment, "pause")}><Pause size={16} /> Pause</button>}{openEnrolment.state === "paused" && <button type="button" className={primary} disabled={busy} onClick={() => action(openEnrolment, "resume")}><Play size={16} /> Resume</button>}{openEnrolment.state === "needs_review" && campaignReviewAction(openEnrolment.stopReason) === "review_existing_conversation" && <button type="button" className={primary} disabled={busy} onClick={() => action(openEnrolment, "review_existing_conversation")}><Check size={16} /> Reviewed; resume</button>}{openEnrolment.state === "needs_review" && campaignReviewAction(openEnrolment.stopReason) === "retry_preflight" && <button type="button" className={button} disabled={busy} onClick={() => action(openEnrolment, "retry_preflight")}>Retry safety checks</button>}{["active", "paused", "needs_review"].includes(openEnrolment.state) && <button type="button" className={button} disabled={busy} onClick={() => action(openEnrolment, "stop")}>Stop permanently</button>}</div><h3 className="mt-8 text-sm font-semibold">Activity</h3><ol className="mt-3 space-y-3 border-l border-[var(--border)] pl-4">{openEnrolment.activity.map((event, index) => <li key={`${event.action}-${index}`} className="text-sm"><p className="font-medium">{event.action.replace(/^campaign\./, "").replaceAll("_", " ")}</p><p className="text-xs text-[var(--muted)]">{dateLabel(event.at)}</p></li>)}</ol></> : <p className="mt-6 text-sm text-[var(--muted)]">This contact has not been subscribed to one of your sequences.</p>}</section></div>}
    {enrolOpen && enrolSequence && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setEnrolOpen(false); }}><section role="dialog" aria-modal="true" aria-label="Confirm automation" className={`${card} w-full max-w-xl p-6 shadow-2xl`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Start automation</p><h2 className="mt-1 text-xl font-semibold">Subscribe {selectedContacts.length} contact{selectedContacts.length === 1 ? "" : "s"}</h2></div><button type="button" className={button} aria-label="Close" onClick={() => setEnrolOpen(false)}><X size={16} /></button></div><p className="mt-3 text-sm text-[var(--muted)]">Confirming starts this published sequence for each selected contact. Published email, WhatsApp and enabled LinkedIn actions run automatically during their sending windows. {data.replyMonitoring?.mode === "enforce" ? "A reply on any monitored channel stops all remaining sequence actions. Unavailable reply monitoring holds outreach for review." : data.replyMonitoring?.mode === "observe" ? "Email replies stop the sequence. WhatsApp and LinkedIn reply monitoring is in observation mode." : "Email replies stop the sequence; WhatsApp and LinkedIn replies are not yet monitored."}</p><label className="mt-5 block text-sm font-medium">Sequence<select value={enrolSequence.id} onChange={event => setEnrolSequenceId(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3">{published.map(sequence => <option key={sequence.id} value={sequence.id}>{sequence.name} · v{sequence.publishedVersion}</option>)}</select></label><div className={`${card} mt-5 p-4`}><p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">First action</p><p className="mt-2 flex items-center gap-2 text-sm font-semibold"><Send size={16} /> {initialSplit ? `A/B split: ${initialSplit.percentage}% Path A / ${100 - initialSplit.percentage}% Path B` : firstStep && firstStep.kind !== "wait" ? `${campaignStepLabel(firstStep)}: ${firstStep.title}` : "Invalid sequence"}</p><p className="mt-2 text-xs text-[var(--muted)]">{needsMailbox ? `From ${data?.mailbox?.address || "your email account"}. Existing email conversations are checked before subscription and sending.` : "Uses your connected account for each channel in this sequence."}</p></div><div className="mt-4 max-h-32 overflow-y-auto text-sm">{selectedContacts.map(contact => <p key={contact.id} className="py-1">{personName(contact)} · <span className="text-[var(--muted)]">{contact.email || contact.linkedinUrl || contact.phone || "No contact details"}</span></p>)}</div>{missingRecipients.length > 0 && <div role="alert" className="mt-4 text-sm text-[var(--status-red)]">{missingRecipients.map(message => <p key={message}>{message}</p>)}</div>}{needsMailbox && !data.mailbox?.ready && <p role="alert" className="mt-4 text-sm">Connect an email account with verified reply monitoring for this sequence.</p>}<div className="mt-6 flex justify-end gap-2"><button type="button" className={button} onClick={() => setEnrolOpen(false)}>Cancel</button><button type="button" className={primary} disabled={busy || missingRecipients.length > 0 || (needsMailbox && !data.mailbox?.ready)} onClick={subscribe}><Play size={16} /> Confirm and start</button></div></section></div>}
    {addPersonOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setAddPersonOpen(false); }}><section role="dialog" aria-modal="true" aria-label="Add person" className={`${card} w-full max-w-xl p-6 shadow-2xl`}>
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Add person</h2><p className="mt-2 text-sm text-[var(--muted)]">Every field is optional. Sequences need only the contact details for their channels.</p></div><button type="button" className={button} aria-label="Close add person" onClick={() => setAddPersonOpen(false)}><X size={16} /></button></div>
      <form onSubmit={event => { event.preventDefault(); void addPerson(); }} className="mt-5 space-y-4">
        {([["fullName", "Full name", "text"], ["linkedinUrl", "LinkedIn profile URL", "url"], ["email", "Email", "email"], ["company", "Company", "text"], ["jobTitle", "Job title", "text"], ["phone", "Phone", "tel"]] as const).map(([key, label, type]) => <label key={key} className="block text-sm font-medium">{label}<input type={type} maxLength={500} value={personDraft[key] || ""} onChange={event => setPersonDraft(current => ({ ...current, [key]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3" /></label>)}
        {error && <p role="alert" className="text-sm text-[var(--status-red)]">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" className={button} onClick={() => setAddPersonOpen(false)}>Cancel</button><button type="submit" disabled={busy} className={primary}>Add person</button></div>
      </form>
    </section></div>}
    <p className="flex items-center gap-2 text-xs text-[var(--muted)]"><Clock3 size={14} /> Sending window: weekdays, 9 am–5 pm Melbourne time. {data.replyMonitoring?.mode === "enforce" ? "Replies on any monitored channel stop the entire sequence." : data.replyMonitoring?.mode === "observe" ? "Reply monitoring is in observation mode; email replies stop the sequence." : "Channel delivery requires a verified connection."}</p>
  </div>;
}
