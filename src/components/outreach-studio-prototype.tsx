"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clock, GitBranch, Mail, MessageCircle, Pause, Play, Plus, Search, Send, ShieldCheck, Smartphone, Users, X } from "lucide-react";

type View = "contacts" | "sequences";
type ContactStatus = "Active" | "Needs review" | "Paused" | "Replied" | "Not enrolled";
type DemoContact = {
  id: string;
  name: string;
  role: string;
  company: string;
  email: string;
  sequenceId: string | null;
  status: ContactStatus;
  currentStep: string;
  nextAction: string;
  lastActivity: string;
};
type DemoSequence = { id: string; name: string; version: string; status: "Published" | "Draft"; description: string };
type DemoNode = { id: string; type: "start" | "email" | "wait" | "condition" | "linkedin" | "end"; title: string; detail: string; x: number; y: number };

const sequences: DemoSequence[] = [
  { id: "founder-intro", name: "Founder introduction", version: "v2", status: "Published", description: "A measured introduction to owner-operators" },
  { id: "warm-follow-up", name: "Warm follow-up", version: "v1", status: "Draft", description: "A shorter sequence for known contacts" },
];

const startingContacts: DemoContact[] = [
  { id: "avery", name: "Avery Moore", role: "Managing Director", company: "Northstar Fabrication", email: "avery@example.com", sequenceId: "founder-intro", status: "Active", currentStep: "Wait 3 business days", nextAction: "Email follow-up · Tomorrow, 9:30 am", lastActivity: "Opener approved · 2 days ago" },
  { id: "jordan", name: "Jordan Lee", role: "Founder", company: "Meridian Components", email: "jordan@example.com", sequenceId: "founder-intro", status: "Needs review", currentStep: "Email opener", nextAction: "Approve draft to continue", lastActivity: "Draft prepared · 1 hour ago" },
  { id: "samira", name: "Samira Patel", role: "Owner", company: "Westhaven Engineering", email: "samira@example.com", sequenceId: "founder-intro", status: "Paused", currentStep: "Wait 3 business days", nextAction: "Paused · no action scheduled", lastActivity: "Paused manually · yesterday" },
  { id: "alex", name: "Alex Chen", role: "Director", company: "Harbour Industrial", email: "alex@example.com", sequenceId: "founder-intro", status: "Replied", currentStep: "Reply received", nextAction: "No further outreach", lastActivity: "Replied · this morning" },
  { id: "taylor", name: "Taylor Reid", role: "CEO", company: "Pioneer Services", email: "taylor@example.com", sequenceId: null, status: "Not enrolled", currentStep: "—", nextAction: "Add to a sequence", lastActivity: "Contact added · 3 days ago" },
  { id: "casey", name: "Casey Tran", role: "Founder", company: "Summit Precision", email: "casey@example.com", sequenceId: null, status: "Not enrolled", currentStep: "—", nextAction: "Add to a sequence", lastActivity: "Contact added · 5 days ago" },
];

const nodeSets: Record<string, DemoNode[]> = {
  "founder-intro": [
    { id: "start", type: "start", title: "Contact enrolled", detail: "Entry point", x: 30, y: 20 },
    { id: "email", type: "email", title: "Email opener", detail: "Approval required", x: 30, y: 130 },
    { id: "wait", type: "wait", title: "Wait 3 business days", detail: "9:30 am · contact timezone", x: 30, y: 240 },
    { id: "reply", type: "condition", title: "Did they reply?", detail: "Check before the next step", x: 30, y: 350 },
    { id: "end", type: "end", title: "Stop sequence", detail: "Notify the owner", x: 310, y: 350 },
    { id: "linkedin", type: "linkedin", title: "LinkedIn follow-up", detail: "Manual confirmation", x: 30, y: 480 },
  ],
  "warm-follow-up": [
    { id: "start", type: "start", title: "Contact enrolled", detail: "Entry point", x: 30, y: 20 },
    { id: "email", type: "email", title: "Warm email", detail: "Approval required", x: 30, y: 130 },
    { id: "wait", type: "wait", title: "Wait 5 business days", detail: "Only if no reply", x: 30, y: 240 },
    { id: "end", type: "end", title: "Close the loop", detail: "End sequence", x: 30, y: 350 },
  ],
};

const card = "rounded-2xl border border-[var(--border)] bg-[var(--panel)]";
const secondaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 text-sm font-medium hover:bg-[var(--panel-raised)] disabled:cursor-not-allowed disabled:opacity-40";
const primaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40";

function statusColor(status: ContactStatus) {
  if (status === "Active" || status === "Replied") return "var(--status-emerald)";
  if (status === "Needs review") return "var(--status-amber)";
  return "var(--muted)";
}

function StatusBadge({ status }: { status: ContactStatus }) {
  return <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-2.5 py-1 text-xs font-medium" style={{ color: statusColor(status) }}><span className="size-1.5 rounded-full bg-current" />{status}</span>;
}

function StepIcon({ type }: { type: DemoNode["type"] }) {
  if (type === "email") return <Mail size={18} />;
  if (type === "wait") return <Clock size={18} />;
  if (type === "condition") return <GitBranch size={18} />;
  if (type === "linkedin") return <MessageCircle size={18} />;
  if (type === "end") return <Check size={18} />;
  return <Play size={18} />;
}

export function OutreachStudioPrototype({ mandateId, mandateName }: { mandateId?: string; mandateName: string }) {
  const [view, setView] = useState<View>("contacts");
  const [contacts, setContacts] = useState(startingContacts);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sequenceFilter, setSequenceFilter] = useState("all");
  const [checked, setChecked] = useState<string[]>([]);
  const [openContactId, setOpenContactId] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollSequenceId, setEnrollSequenceId] = useState(sequences[0].id);
  const [selectedSequenceId, setSelectedSequenceId] = useState(sequences[0].id);
  const [selectedNodeId, setSelectedNodeId] = useState("email");
  const [nodeTitles, setNodeTitles] = useState<Record<string, string>>({});

  const visibleContacts = useMemo(() => contacts.filter((contact) => {
    const matchesSearch = `${contact.name} ${contact.role} ${contact.company} ${contact.email}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (statusFilter === "all" || contact.status === statusFilter) && (sequenceFilter === "all" || contact.sequenceId === sequenceFilter);
  }), [contacts, search, statusFilter, sequenceFilter]);
  const eligibleVisibleContacts = visibleContacts.filter((contact) => !contact.sequenceId);
  const openContact = contacts.find((contact) => contact.id === openContactId);
  const selectedSequence = sequences.find((sequence) => sequence.id === selectedSequenceId)!;
  const nodes = nodeSets[selectedSequenceId];
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || nodes[0];
  const selectedForEnrollment = contacts.filter((contact) => checked.includes(contact.id));
  const enrolledCount = contacts.filter((contact) => contact.sequenceId).length;
  const activeCount = contacts.filter((contact) => contact.status === "Active").length;
  const needsReviewCount = contacts.filter((contact) => contact.status === "Needs review").length;
  const repliedCount = contacts.filter((contact) => contact.status === "Replied").length;

  function selectSequence(id: string) {
    setSelectedSequenceId(id);
    setSelectedNodeId("email");
  }

  function enrollSelected() {
    setContacts((current) => current.map((contact) => checked.includes(contact.id) ? {
      ...contact,
      sequenceId: enrollSequenceId,
      status: "Active",
      currentStep: "Email opener",
      nextAction: "Review first draft · next business day",
      lastActivity: "Added to sequence · just now",
    } : contact));
    setChecked([]);
    setEnrollOpen(false);
  }

  function togglePause(id: string) {
    setContacts((current) => current.map((contact) => contact.id !== id ? contact : contact.status === "Paused" ? {
      ...contact, status: "Active", nextAction: "Email follow-up · next business day", lastActivity: "Resumed · just now",
    } : {
      ...contact, status: "Paused", nextAction: "Paused · no action scheduled", lastActivity: "Paused manually · just now",
    }));
  }

  return <div className="mx-auto max-w-[1680px] space-y-6 p-5 sm:p-8">
    {mandateId && <Link href={`/mandates/${mandateId}/people`} className="inline-flex items-center gap-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"><ArrowLeft size={16} /> Back to people</Link>}
    <header className="flex flex-wrap items-end justify-between gap-5">
      <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--muted)]">{mandateName} / Outreach</p><h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Outreach studio</h1><p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">Plan the sequence, enroll the right people, and see what happens next for each contact.</p></div>
      <span className="rounded-full border border-[var(--border)] bg-[var(--panel-raised)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wider">Interactive mockup</span>
    </header>
    <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] px-4 py-3 text-sm"><ShieldCheck size={19} className="mt-0.5 shrink-0" /><p><strong>Preview only.</strong> These are fictional contacts and local sample interactions. Nothing is saved, scheduled, or sent.</p></div>
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)]">
      <div role="tablist" aria-label="Outreach studio views" className="flex gap-6">
        {([ ["contacts", "Contacts", Users], ["sequences", "Sequences", GitBranch] ] as const).map(([key, label, Icon]) => <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)} className={`flex min-h-12 items-center gap-2 border-b-2 px-1 text-sm font-medium ${view === key ? "border-[var(--accent)] text-[var(--foreground)]" : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"}`}><Icon size={17} />{label}</button>)}
      </div>
      <p className="pb-3 text-xs text-[var(--muted)]">Prototype of the future mandate-level Outreach experience</p>
    </div>

    {view === "contacts" ? <div className="space-y-6" role="tabpanel">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[["Enrolled", enrolledCount, "Across all sequences"], ["Active", activeCount, "Next actions scheduled"], ["Needs review", needsReviewCount, "Waiting for approval"], ["Replied", repliedCount, "Outreach automatically stopped"]].map(([label, value, caption]) => <div key={label} className={`${card} p-4`}><p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p><p className="mt-1 text-xs text-[var(--muted)]">{caption}</p></div>)}
      </div>
      <section className={`${card} overflow-hidden`} aria-label="Contacts and sequence progress">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] p-5">
          <div><h2 className="text-xl font-semibold">Contacts in outreach</h2><p className="mt-1 text-sm text-[var(--muted)]">Follow every contact from enrollment through reply or completion.</p></div>
          <button type="button" className={primaryButton} disabled={!checked.length} onClick={() => setEnrollOpen(true)}><Plus size={17} /> Add {checked.length || "selected"} to sequence</button>
        </div>
        <div className="flex flex-wrap gap-3 border-b border-[var(--border)] p-4">
          <label className="relative min-w-[230px] flex-1"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" /><span className="sr-only">Search contacts</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people or businesses" className="min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] pl-10 pr-3 text-sm" /></label>
          <label className="sr-only" htmlFor="prototype-sequence-filter">Filter by sequence</label><select id="prototype-sequence-filter" value={sequenceFilter} onChange={(event) => setSequenceFilter(event.target.value)} className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm"><option value="all">All sequences</option>{sequences.map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.name}</option>)}</select>
          <label className="sr-only" htmlFor="prototype-status-filter">Filter by status</label><select id="prototype-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm"><option value="all">All statuses</option>{["Active", "Needs review", "Paused", "Replied", "Not enrolled"].map((status) => <option key={status}>{status}</option>)}</select>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1020px] text-left text-sm"><thead className="bg-[var(--panel-raised)] text-xs uppercase tracking-wider text-[var(--muted)]"><tr><th className="w-12 p-4"><input type="checkbox" aria-label="Select all unenrolled contacts shown" disabled={!eligibleVisibleContacts.length} checked={eligibleVisibleContacts.length > 0 && eligibleVisibleContacts.every((contact) => checked.includes(contact.id))} onChange={(event) => setChecked(event.target.checked ? Array.from(new Set([...checked, ...eligibleVisibleContacts.map((contact) => contact.id)])) : checked.filter((id) => !eligibleVisibleContacts.some((contact) => contact.id === id)))} /></th>{["Contact", "Sequence", "Status", "Current step", "What’s next"].map((heading) => <th key={heading} className="p-4">{heading}</th>)}</tr></thead><tbody>{visibleContacts.map((contact) => <tr key={contact.id} className="border-t border-[var(--border)] hover:bg-[var(--panel-raised)]"><td className="p-4"><input type="checkbox" aria-label={`Select ${contact.name}`} disabled={Boolean(contact.sequenceId)} checked={checked.includes(contact.id)} onChange={(event) => setChecked((current) => event.target.checked ? [...current, contact.id] : current.filter((id) => id !== contact.id))} /></td><td className="p-4"><button type="button" className="text-left" onClick={() => setOpenContactId(contact.id)}><span className="font-semibold underline decoration-[var(--border)] underline-offset-4 hover:decoration-current">{contact.name}</span><span className="block text-xs text-[var(--muted)]">{contact.role} · {contact.company}</span></button></td><td className="p-4 text-[var(--muted)]">{sequences.find((sequence) => sequence.id === contact.sequenceId)?.name || "—"}</td><td className="p-4"><StatusBadge status={contact.status} /></td><td className="p-4">{contact.currentStep}</td><td className="p-4"><span className={contact.status === "Needs review" ? "font-medium text-[var(--status-amber)]" : ""}>{contact.nextAction}</span><button type="button" onClick={() => setOpenContactId(contact.id)} className="mt-1 flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]">View timeline <ArrowRight size={13} /></button></td></tr>)}</tbody></table>{!visibleContacts.length && <div className="p-10 text-center text-sm text-[var(--muted)]">No contacts match these filters.</div>}</div>
        <div className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--muted)]">Showing {visibleContacts.length} fictional contacts · Select rows to preview bulk enrollment</div>
      </section>
    </div> : <div className="space-y-5" role="tabpanel">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-semibold">Sequences</h2><p className="mt-1 text-sm text-[var(--muted)]">Build the journey once, then add contacts to it.</p></div><button type="button" className={secondaryButton} onClick={() => selectSequence("warm-follow-up")}><Plus size={16} /> Explore draft sequence</button></div>
      <div className="grid gap-4 2xl:grid-cols-[245px_minmax(0,1fr)]">
        <aside className={`${card} h-fit p-3`} aria-label="Demo sequences"><p className="px-2 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Your sequences</p><div className="space-y-2">{sequences.map((sequence) => <button key={sequence.id} type="button" onClick={() => selectSequence(sequence.id)} className={`w-full rounded-xl border p-3 text-left ${selectedSequenceId === sequence.id ? "border-[var(--foreground)] bg-[var(--panel-raised)]" : "border-transparent hover:bg-[var(--panel-raised)]"}`}><span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{sequence.name}</span><span className="text-xs text-[var(--muted)]">{sequence.version}</span></span><span className="mt-2 block text-xs text-[var(--muted)]">{sequence.description}</span><span className="mt-3 inline-block rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px]">{sequence.status}</span></button>)}</div></aside>
        <section className={`${card} min-w-0 overflow-hidden`} aria-label="Sequence builder mockup">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4"><div><div className="flex items-center gap-2"><h3 className="text-lg font-semibold">{selectedSequence.name}</h3><span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px]">{selectedSequence.status} · {selectedSequence.version}</span></div><p className="mt-1 text-xs text-[var(--muted)]">Click a step to inspect its settings. Changes in this mockup stay in this browser session.</p></div><button type="button" className={secondaryButton} onClick={() => { setView("contacts"); setSequenceFilter(selectedSequenceId); }}>View enrolled contacts <ArrowRight size={15} /></button></div>
          <div className="grid min-w-0 xl:grid-cols-[175px_minmax(0,1fr)_270px]">
            <div className="border-b border-[var(--border)] p-4 xl:border-b-0 xl:border-r"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Step library</p><p className="mt-2 text-xs text-[var(--muted)]">Drag-and-drop comes with the real builder.</p><div className="mt-4 space-y-2">{[[Mail, "Send email", "Ready for MVP"], [Clock, "Wait", "Business days"], [GitBranch, "Condition", "Reply / no reply"], [MessageCircle, "LinkedIn", "Manual first"], [Smartphone, "WhatsApp", "Later phase"]].map(([Icon, title, detail]) => { const Step = Icon as typeof Mail; return <div key={title as string} className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-raised)] p-2.5"><Step size={16} className="mt-0.5 shrink-0" /><div><p className="text-xs font-semibold">{title as string}</p><p className="text-[11px] text-[var(--muted)]">{detail as string}</p></div></div>; })}</div></div>
            <div className="min-w-0 overflow-x-auto bg-[var(--background)]" style={{ backgroundImage: "radial-gradient(var(--border) 0.8px, transparent 0.8px)", backgroundSize: "18px 18px" }}><div className="relative h-[600px] w-[520px]"><svg aria-hidden="true" className="absolute inset-0" width="520" height="600" viewBox="0 0 520 600" fill="none" stroke="var(--muted)" strokeWidth="2"><path d="M115 110 V130 M115 220 V240 M115 330 V350" />{selectedSequenceId === "founder-intro" ? <><path d="M200 395 H310 M115 440 V480" /><text x="225" y="385" fill="var(--muted)" stroke="none" fontSize="11">Reply</text><text x="132" y="464" fill="var(--muted)" stroke="none" fontSize="11">No reply</text></> : null}</svg>{nodes.map((node) => <button key={node.id} type="button" onClick={() => setSelectedNodeId(node.id)} style={{ left: node.x, top: node.y, width: 170 }} className={`absolute min-h-[90px] rounded-xl border p-3 text-left shadow-lg ${selectedNode.id === node.id ? "border-[var(--foreground)] bg-[var(--panel-raised)] ring-2 ring-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--panel)] hover:border-[var(--muted)]"}`}><span className="flex items-center gap-2 text-[var(--muted)]"><StepIcon type={node.type} /><span className="text-[10px] font-semibold uppercase tracking-wider">{node.type === "condition" ? "Branch" : node.type}</span></span><span className="mt-2 block text-sm font-semibold">{nodeTitles[`${selectedSequenceId}:${node.id}`] || node.title}</span><span className="mt-0.5 block text-[11px] text-[var(--muted)]">{node.detail}</span></button>)}</div></div>
            <div className="border-t border-[var(--border)] p-4 xl:border-l xl:border-t-0"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Step settings</p><div className="mt-4 flex items-center gap-2"><span className="rounded-lg bg-[var(--panel-raised)] p-2"><StepIcon type={selectedNode.type} /></span><span className="text-sm font-semibold">{selectedNode.type === "condition" ? "Reply condition" : selectedNode.type.charAt(0).toUpperCase() + selectedNode.type.slice(1)}</span></div><label className="mt-5 block text-xs font-medium">Step name<input value={nodeTitles[`${selectedSequenceId}:${selectedNode.id}`] ?? selectedNode.title} onChange={(event) => setNodeTitles((current) => ({ ...current, [`${selectedSequenceId}:${selectedNode.id}`]: event.target.value }))} className="mt-2 min-h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm" /></label>{selectedNode.type === "email" ? <div className="mt-5 space-y-3"><p className="text-xs font-medium">Message preview</p><div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-xs"><p className="font-semibold">Subject: A quick introduction</p><p className="mt-3 leading-relaxed text-[var(--muted)]">Hi {"{{first_name}}"}, I’ve been following {"{{company_name}}"} and wanted to reach out privately...</p></div><p className="text-xs text-[var(--muted)]">Sender: Connected Gmail mailbox · Approval required before sending</p></div> : <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 text-xs text-[var(--muted)]">{selectedNode.detail}<br /><br />Timing, branch rules and channel settings will be editable here.</div>}<div className="mt-6 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]"><p className="font-medium text-[var(--foreground)]">Publishing guardrails</p><p className="mt-1">Graph validation, a version snapshot and a test preview are required before this sequence can go live.</p></div></div>
          </div>
        </section>
      </div>
    </div>}

    {openContact && <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpenContactId(null); }}><section role="dialog" aria-modal="true" aria-label={`${openContact.name} outreach timeline`} className="h-full w-full max-w-[520px] overflow-y-auto border-l border-[var(--border)] bg-[var(--background)] p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Contact timeline</p><h2 className="mt-2 text-2xl font-semibold">{openContact.name}</h2><p className="mt-1 text-sm text-[var(--muted)]">{openContact.role} · {openContact.company}</p></div><button type="button" aria-label="Close timeline" className={secondaryButton} onClick={() => setOpenContactId(null)}><X size={17} /></button></div><div className="mt-6"><StatusBadge status={openContact.status} /></div><div className={`${card} mt-6 space-y-4 p-4`}><div><p className="text-xs text-[var(--muted)]">Sequence</p><p className="mt-1 font-semibold">{sequences.find((sequence) => sequence.id === openContact.sequenceId)?.name || "Not enrolled"}</p></div><div className="grid grid-cols-2 gap-4 border-t border-[var(--border)] pt-4"><div><p className="text-xs text-[var(--muted)]">Current step</p><p className="mt-1 text-sm font-medium">{openContact.currentStep}</p></div><div><p className="text-xs text-[var(--muted)]">What’s next</p><p className="mt-1 text-sm font-medium">{openContact.nextAction}</p></div></div></div>{openContact.sequenceId && <div className={`${card} mt-4 p-4`}><h3 className="text-sm font-semibold">Position in sequence</h3><div className="mt-4 flex items-center gap-1" aria-label={`Current step: ${openContact.currentStep}`}>{["Email", "Wait", "Reply check", "Follow-up"].map((step, index) => { const currentIndex = openContact.status === "Replied" ? 2 : openContact.currentStep.includes("Wait") ? 1 : 0; return <div key={step} className="min-w-0 flex-1"><div className={`h-1.5 rounded-full ${index <= currentIndex ? "bg-[var(--foreground)]" : "bg-[var(--border)]"}`} /><p className={`mt-2 truncate text-[10px] ${index === currentIndex ? "font-semibold" : "text-[var(--muted)]"}`}>{step}</p></div>; })}</div></div>}<h3 className="mt-8 text-sm font-semibold">Activity</h3><ol className="mt-4 space-y-0 border-l border-[var(--border)] pl-5"><li className="relative pb-6 text-sm before:absolute before:-left-[25px] before:top-1.5 before:size-2 before:rounded-full before:bg-[var(--foreground)]"><p className="font-medium">{openContact.lastActivity}</p><p className="mt-1 text-xs text-[var(--muted)]">Current status in the sequence</p></li><li className="relative pb-6 text-sm before:absolute before:-left-[25px] before:top-1.5 before:size-2 before:rounded-full before:bg-[var(--muted)]"><p className="font-medium">Contact reviewed</p><p className="mt-1 text-xs text-[var(--muted)]">Profile and channel availability checked</p></li><li className="relative text-sm before:absolute before:-left-[25px] before:top-1.5 before:size-2 before:rounded-full before:bg-[var(--muted)]"><p className="font-medium">Contact added to mandate</p></li></ol>{(openContact.status === "Active" || openContact.status === "Paused") && <button type="button" className={`${secondaryButton} mt-8 w-full`} onClick={() => togglePause(openContact.id)}>{openContact.status === "Paused" ? <Play size={16} /> : <Pause size={16} />}{openContact.status === "Paused" ? "Resume sequence" : "Pause sequence"}</button>}<p className="mt-3 text-xs text-[var(--muted)]">This control changes sample state only.</p></section></div>}

    {enrollOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setEnrollOpen(false); }}><section role="dialog" aria-modal="true" aria-label="Add contacts to a sequence" className={`${card} w-full max-w-lg p-6 shadow-2xl`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">Bulk enrollment</p><h2 className="mt-1 text-xl font-semibold">Add {checked.length} contact{checked.length === 1 ? "" : "s"} to a sequence</h2></div><button type="button" aria-label="Close enrollment" className={secondaryButton} onClick={() => setEnrollOpen(false)}><X size={16} /></button></div><p className="mt-3 text-sm text-[var(--muted)]">Each contact gets an independent timeline and status. Existing enrollments will be checked before adding in the real flow.</p><label className="mt-5 block text-sm font-medium">Sequence<select value={enrollSequenceId} onChange={(event) => setEnrollSequenceId(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3">{sequences.filter((sequence) => sequence.status === "Published").map((sequence) => <option key={sequence.id} value={sequence.id}>{sequence.name} · {sequence.version}</option>)}</select></label><div className="mt-5 max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--background)] p-3"><p className="mb-2 text-xs font-semibold text-[var(--muted)]">Selected contacts</p>{selectedForEnrollment.map((contact) => <p key={contact.id} className="py-1 text-sm">{contact.name} <span className="text-[var(--muted)]">· {contact.company}</span></p>)}</div><div className="mt-6 flex justify-end gap-2"><button type="button" className={secondaryButton} onClick={() => setEnrollOpen(false)}>Cancel</button><button type="button" className={primaryButton} onClick={enrollSelected}><Send size={16} /> Add to sequence</button></div><p className="mt-3 text-xs text-[var(--muted)]">Demo only: no real enrollment or messages are created.</p></section></div>}
  </div>;
}
