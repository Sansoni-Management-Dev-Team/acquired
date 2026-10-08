"use client";

import { useState } from "react";
import { campaignStepLabel, campaignStepEntries, renderCampaignTemplate, type CampaignDraft, type CampaignStep } from "@/domain/campaign";

type Draft = CampaignDraft;
type Contact = { id: string; name: string; company: string };
const contactLabel = (contact: Contact) => [contact.name.trim() || "Unnamed person", contact.company].filter(Boolean).join(" · ");
const card = "rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5";
const field = "mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-sm";
const button = "min-h-10 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--panel-raised)]";

export function CampaignMessagesEditor({ draft, selectedStepId, onChange, onSelect, contacts }: {
  draft: Draft; selectedStepId: string | null; onChange: (draft: Draft) => void; onSelect: (id: string) => void; contacts: Contact[];
}) {
  const [channel, setChannel] = useState<"email" | "linkedin" | "whatsapp">(() => { const selected = campaignStepEntries(draft).find(entry => entry.step.id === selectedStepId)?.step; return selected && selected.kind !== "wait" ? selected.kind : "email"; });
  const [recipientIds, setRecipientIds] = useState<string[]>(contacts[0] ? [contacts[0].id] : []);
  const [previewId, setPreviewId] = useState(contacts[0]?.id || "");
  const [copyStatus, setCopyStatus] = useState("");
  const [linkedin, setLinkedin] = useState("Hi {{first_name}}, I came across {{company_name}} while exploring potential acquisitions. Would you be open to a short, confidential conversation?");
  const [whatsapp, setWhatsapp] = useState("Hi {{first_name}}, I wanted to ask whether a confidential conversation about {{company_name}} might be of interest. No pressure either way.");
  const recipients = contacts.filter(contact => recipientIds.includes(contact.id));
  const contact = recipients.find(item => item.id === previewId) || recipients[0];
  const entries = campaignStepEntries(draft);
  const allSteps = entries.map(entry => entry.step);
  const emails = allSteps.filter(step => step.kind === "email");
  const selectedEmail = emails.find(step => step.id === selectedStepId) || emails[0];
  const channelSteps = allSteps.filter(step => step.kind !== "wait").filter(step => step.kind === channel);
  const selectedMessage = channelSteps.find(step => step.id === selectedStepId) || channelSteps[0];
  const template = selectedMessage?.body ?? (channel === "email" ? selectedEmail?.body || "" : channel === "linkedin" ? linkedin : whatsapp);
  const preview = contact ? renderCampaignTemplate(template, { displayName: contact.name, companyName: contact.company }) : template;
  let day = 1;
  const days = new Map<string, number>();
  draft.steps.forEach(step => {
    if (step.kind === "wait") day += step.days;
    else {
      days.set(step.id, day);
      const split = draft.splits?.find(split => split.afterStepId === step.id);
      if (split) {
        const ends = (["pathA", "pathB"] as const).map(path => {
          let branchDay = day;
          split[path].forEach(step => { if (step.kind === "wait") branchDay += step.days; else days.set(step.id, branchDay); });
          return branchDay;
        });
        day = Math.max(...ends);
      }
    }
  });
  function timingLabel(id: string) {
    const entry = entries.find(entry => entry.step.id === id);
    return draft.splits?.length ? `${entry?.path === "pathA" ? "Path A" : entry?.path === "pathB" ? "Path B" : "Main sequence"} · timing depends on path` : `Day ${days.get(id)}`;
  }
  function updateMessage(id: string, update: (step: CampaignStep) => CampaignStep) {
    const map = (steps: CampaignStep[]) => steps.map(step => step.id === id ? update(step) : step);
    onChange({ ...draft, steps: map(draft.steps), ...(draft.splits ? { splits: draft.splits.map(split => ({ ...split, pathA: map(split.pathA), pathB: map(split.pathB) })) } : {}) });
  }

  function updateEmail(id: string, key: "title" | "subject" | "body", value: string) {
    updateMessage(id, step => step.kind === "email" ? { ...step, [key]: value } : step);
  }

  return <div className="grid items-start gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
    <div className="min-w-0 space-y-4">
      <section className={card} aria-label="Selected recipients">
        <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Selected recipients</h3><p className="mt-1 text-xs text-[var(--muted)]">Select contacts for preview.</p></div><span className="rounded-md bg-[var(--success-surface)] px-2 py-1 text-xs font-semibold">{recipients.length} contact{recipients.length === 1 ? "" : "s"}</span></div>
        <div className="mt-3 flex flex-wrap gap-2">{recipients.map(recipient => <button key={recipient.id} type="button" title={`Remove ${contactLabel(recipient)}`} onClick={() => { setRecipientIds(ids => ids.filter(id => id !== recipient.id)); setCopyStatus(""); }} className="rounded-md bg-[var(--panel-raised)] px-2 py-1 text-xs">{contactLabel(recipient)} ×</button>)}</div>
        {contacts.length > 0 ? <label className="mt-3 block text-xs font-medium">Add recipient<select value="" className={field} onChange={event => {
          const next = contacts.find(item => item.id === event.target.value);
          if (!next) return;
          setRecipientIds(ids => [...ids.filter(id => !next.company || contacts.find(item => item.id === id)?.company !== next.company), next.id]);
          setPreviewId(next.id); setCopyStatus("");
        }}><option value="">Select a contact</option>{contacts.filter(item => !recipientIds.includes(item.id)).map(item => <option key={item.id} value={item.id}>{contactLabel(item)}</option>)}</select></label> : <p className="mt-3 text-xs text-[var(--muted)]">Add people to this mandate to preview personalised messages.</p>}
      </section>
      <section className={card}>
        <div className="flex flex-wrap gap-2" aria-label="Message channels">{([ ["email", "Email sequence"], ["linkedin", allSteps.some(step => step.kind === "linkedin") ? "LinkedIn sequence" : "LinkedIn sample"], ["whatsapp", allSteps.some(step => step.kind === "whatsapp") ? "WhatsApp sequence" : "WhatsApp sample"] ] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={channel === key} className={`${button} ${channel === key ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--muted)]"}`} onClick={() => { setChannel(key); setCopyStatus(""); }}>{label}</button>)}</div>
        {channel === "email" ? <>
          <p className="my-4 rounded-lg bg-[var(--accent-soft)] p-3 text-xs text-[var(--muted)]"><strong className="text-[var(--foreground)]">{emails.length === 7 ? "Seven" : emails.length} editable emails.</strong> Edit the draft here or in Sequence flow. Wait steps determine the gaps. Save draft to keep changes.</p>
          <div className="space-y-2">{emails.map((email, index) => <details key={email.id} className="rounded-lg border border-[var(--border)]" onToggle={event => { if (event.currentTarget.open) { onSelect(email.id); setCopyStatus(""); } }}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-3 text-sm"><span className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent)]">{index + 1}</span><span className="font-semibold">{email.title}</span><span className="ml-auto shrink-0 text-xs text-[var(--muted)]">{timingLabel(email.id)}</span></summary>
            <div className="space-y-3 border-t border-[var(--border)] p-4">
              <label className="block text-xs font-medium">Title<input className={field} value={email.title} onChange={event => updateEmail(email.id, "title", event.target.value)} /></label>
              <label className="block text-xs font-medium">Subject<input className={field} value={email.subject} onChange={event => updateEmail(email.id, "subject", event.target.value)} /></label>
              <label className="block text-xs font-medium">Message<textarea className={field} rows={8} value={email.body} onChange={event => updateEmail(email.id, "body", event.target.value)} /></label>
              <p className="text-xs text-[var(--muted)]">Use {"{{first_name}}"}, {"{{full_name}}"}, or {"{{company_name}}"}.</p>
              <button type="button" className={button} onClick={() => { onSelect(email.id); setCopyStatus(""); }}>Preview this email</button>
            </div>
          </details>)}</div>
        </> : channelSteps.length > 0 ? <div className="mt-4 space-y-3">{channelSteps.map(step => <div key={step.id} className="rounded-lg border border-[var(--border)] p-4">
          <label className="block text-xs font-medium">Title<input className={field} value={step.title} onChange={event => updateMessage(step.id, item => ({ ...item, title: event.target.value }))} /></label>
          <p className="mt-2 text-xs font-semibold">{campaignStepLabel(step)}</p>
          <label className="mt-3 block text-xs font-medium">{step.kind === "linkedin" && step.action === "connect" ? "Optional connection note (200 characters after personalisation)" : "Message"}<textarea className={field} rows={6} value={step.body} onChange={event => updateMessage(step.id, item => item.kind !== "wait" ? { ...item, body: event.target.value } : item)} /></label>
          <div className="mt-3 flex items-center justify-between"><button type="button" className={button} onClick={() => { onSelect(step.id); setCopyStatus(""); }}>Preview this message</button><span className="text-xs text-[var(--muted)]">{timingLabel(step.id)}</span></div>
        </div>)}<p className="text-xs text-[var(--muted)]">Saved with your draft. LinkedIn messages require an accepted connection; connection requests skip existing connections.</p></div> : <label className="mt-4 block text-sm font-semibold">{channel === "linkedin" ? "LinkedIn message" : "WhatsApp message"}<textarea rows={8} className={field} value={channel === "linkedin" ? linkedin : whatsapp} onChange={event => { if (channel === "linkedin") setLinkedin(event.target.value); else setWhatsapp(event.target.value); setCopyStatus(""); }} /><span className="mt-2 block text-xs font-normal text-[var(--muted)]">Sample for manual use. Sample edits last while this view is open.</span></label>}
      </section>
    </div>
    <aside className={card}>
      <h3 className="text-sm font-semibold">Preview for</h3>
      <label className="mt-3 block text-xs font-medium">Contact<select value={contact?.id || ""} disabled={!recipients.length} className={field} onChange={event => { setPreviewId(event.target.value); setCopyStatus(""); }}>{!recipients.length && <option value="">Select a recipient</option>}{recipients.map(item => <option key={item.id} value={item.id}>{contactLabel(item)}</option>)}</select></label>
      {channel === "email" && selectedEmail && <p className="mt-4 text-xs font-semibold">{contact ? renderCampaignTemplate(selectedEmail.subject, { displayName: contact.name, companyName: contact.company }) : selectedEmail.subject}</p>}
      <div className="my-3 whitespace-pre-wrap break-words rounded-lg border border-[var(--border)] bg-[var(--background)] p-4 text-xs leading-relaxed">{preview || "Add an email in Sequence flow to preview it here."}</div>
      <button type="button" disabled={!preview} className={button} onClick={async () => { try { await navigator.clipboard.writeText(preview); setCopyStatus("Preview copied."); } catch { setCopyStatus("Could not copy. Select the preview text to copy it manually."); } }}>Copy preview</button>
      <p role="status" className="mt-2 text-xs text-[var(--muted)]">{copyStatus}</p>
      <p className="mt-2 text-xs text-[var(--muted)]">Preview only. Selecting recipients here does not subscribe them or send messages.</p>
    </aside>
  </div>;
}
