"use client";

import {AgentManualFeedbackForm} from "./agent-manual-feedback-form";
import { randomUuid } from "@/lib/random-uuid";


import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { dialogBackdrop } from "./dialog-backdrop";
import { CompanyInfoSummary } from "./company-info-summary";
import { CompanyContactsTable, type ContactRetrievalRun } from "./company-contacts-table";
import type { MandateView, MembershipView } from "@/domain/acquisition";
import type { OutreachTargetView } from "./outreach-queue";
import { jsonRequest } from "./mandate-workspace";

const actionClass = "inline-flex min-h-12 items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40";
const reviewTabs = [["review", "Overview"], ["contacts", "Contacts"]] as const;
type ContactsData = { views: OutreachTargetView[]; peopleRun?: ContactRetrievalRun };

export function CompanyReviewPanel({ mandate, initial: member, onClose, position, learningEnabled=false }: {
  learningEnabled?:boolean; mandate: MandateView; initial: MembershipView; onClose: () => void; position: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const backdropPressed = useRef(false);
  const [tab, setTab] = useState("review");
  const [contacts, setContacts] = useState<ContactsData>();
  const [contactsError, setContactsError] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const requestId = useRef<string | null>(null);
  const targetId = member.target.id;
  useEffect(() => { const el = dialog.current!; el.showModal(); return () => el.close(); }, []);
  useEffect(() => {
    if (tab !== "contacts") return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = false;
    async function refresh() {
      try {
        const data: ContactsData = await jsonRequest(`/api/mandates/${mandate.id}/outreach?targetId=${targetId}`);
        if (!live) return;
        setContacts(data);
        setContactsError("");
        active = ["queued", "running"].includes(data.peopleRun?.status || "");
      } catch {
        if (!live) return;
        setContactsError(active ? "Couldn’t update the list. Trying again…" : "Couldn’t load the list. Try again.");
      }
      if (live && active) timer = setTimeout(() => { void refresh(); }, 5000);
    }
    void refresh();
    return () => { live = false; clearTimeout(timer); };
  }, [mandate.id, targetId, tab, refreshKey]);
  async function loadPeople() {
    if (starting) return;
    setStarting(true);
    setStartError("");
    requestId.current ||= randomUuid();
    try {
      const data = await jsonRequest(`/api/mandates/${mandate.id}`, { action: "load-people", targetIds: [targetId], requestId: requestId.current });
      const run: ContactRetrievalRun | undefined = data.refresh?.runs[0];
      if (!run) throw new Error(data.warnings?.[0] || "Please try again.");
      setContacts(previous => ({ views: previous?.views || [], peopleRun: run }));
      requestId.current = null;
      setRefreshKey(value => value + 1);
    } catch (error) {
      setStartError(`Couldn’t start loading people. ${error instanceof Error ? error.message : "Please try again."}`);
    } finally { setStarting(false); }
  }
  function openTab(value: string) { setTab(value); content.current?.scrollTo({ top: 0 }); }
  const savedContacts = contacts?.views.find(t => t.id === member.target.id)?.contacts || [];
  return <dialog ref={dialog} onPointerDown={event => dialogBackdrop(backdropPressed, onClose).onPointerDown(event)} onPointerCancel={() => { backdropPressed.current = false; }} onClick={event => dialogBackdrop(backdropPressed, onClose).onClick(event)} onCancel={e => { e.preventDefault(); onClose(); }} aria-labelledby="company-review-heading" className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-3xl overflow-hidden border-l border-[var(--border)] bg-[var(--background)] p-0 text-[var(--foreground)] shadow-xl backdrop:bg-black/50 backdrop:backdrop-blur-sm">
    <div className="flex h-full flex-col">
      <header className="shrink-0 space-y-5 border-b border-[var(--border)] px-5 pb-5 pt-6 sm:px-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0"><p className="text-xs text-[var(--muted)]">{position}</p><h2 id="company-review-heading" className="mt-2 break-words text-2xl font-semibold leading-tight">{member.target.companyName}</h2><div className="mt-2 break-all text-sm text-[var(--muted)]"><CompanyWebsite domain={member.target.domain} /></div></div>
          <button autoFocus className={`${actionClass} min-w-12 shrink-0 px-3 hover:bg-[var(--panel-raised)]`} aria-label="Close company panel" onClick={onClose}><X size={20} /></button>
        </div>
        <nav role="tablist" aria-label="Company information" className="grid grid-cols-2 gap-1 rounded-[10px] bg-[var(--panel-raised)] p-1">
          {reviewTabs.map(([value, label], index) => <button key={value} id={`company-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls={`company-panel-${value}`} tabIndex={tab === value ? 0 : -1} className={`${actionClass} px-2 leading-tight sm:px-4 ${tab === value ? "bg-[var(--background)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`} onClick={() => openTab(value)} onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? 0 : event.key === "End" ? reviewTabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + reviewTabs.length) % reviewTabs.length;
            openTab(reviewTabs[next][0]);
            document.getElementById(`company-tab-${reviewTabs[next][0]}`)?.focus();
          }}>{label}</button>)}
        </nav>
      </header>
      <div ref={content} className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        <div id="company-panel-review" role="tabpanel" aria-labelledby="company-tab-review" hidden={tab !== "review"}><CompanyInfoSummary member={member} financialScope={mandate.brief.financialScope} />{learningEnabled&&<div className="mt-5 border-t border-[var(--border)] pt-3"><p className="text-xs text-[var(--muted)]">Saved review · version {member.version}{member.assessment.reason?` · ${member.assessment.reason}`:""}</p><AgentManualFeedbackForm mandateId={mandate.id} source={{kind:"target_review",targetId:member.target.id,revision:member.version}} busy={false} defaultCategory="qualification" /></div>}</div>
        <div id="company-panel-contacts" role="tabpanel" aria-labelledby="company-tab-contacts" hidden={tab !== "contacts"}>
          <CompanyContactsTable contacts={savedContacts} availablePeopleCount={contacts?.views.find(t => t.id === targetId)?.availablePeopleCount ?? member.target.sourceData?.firmable?.availablePeopleCount} findings={member.researchFindings} loading={!contacts && !contactsError} error={contactsError || startError} run={contacts?.peopleRun} starting={starting} onLoadPeople={loadPeople} onRetry={contactsError ? () => { setContactsError(""); setRefreshKey(value => value + 1); } : loadPeople} />
        </div>
      </div>
    </div>
  </dialog>;
}

function CompanyWebsite({ domain }: { domain?: string }) {
  let url: URL | null = null;
  try { if (domain) url = new URL(domain.includes(":") ? domain : `https://${domain}`); } catch { /* Unknown website. */ }
  if (!url || !["https:", "http:"].includes(url.protocol) || !url.hostname.includes(".") || url.username || url.password) return null;
  return <a href={url.href} target="_blank" rel="noreferrer" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2">{url.hostname}</a>;
}
