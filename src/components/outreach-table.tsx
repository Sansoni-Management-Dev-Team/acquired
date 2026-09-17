"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { dialogBackdrop } from "./dialog-backdrop";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { BuyerProfile } from "@/domain/buyer-profile";
import { OutreachQueue, type OutreachTargetView } from "./outreach-queue";

const button = "min-h-12 rounded-md border border-[var(--border)] px-4 text-sm disabled:opacity-40";

export function OutreachTable({ mandateId, initialTargets, initialBuyerProfile, initialTargetId, canCompose }: {
  mandateId: string; initialTargets: OutreachTargetView[]; initialBuyerProfile: BuyerProfile | null; initialTargetId?: string; canCompose: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(() => {
    const target = initialTargets.find(target => target.id === initialTargetId);
    return target ? `${target.id}:${target.contacts[0]?.id || "missing"}` : null;
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [results, setResults] = useState<Record<string, string>>({});
  const cancelled = useRef(false);
  const mounted = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPressed = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelled.current = true; }; }, []);
  useEffect(() => { if (openKey && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [openKey]);
  const rows = initialTargets.flatMap(target => (target.contacts.length ? target.contacts : [null]).map(contact => ({ key: `${target.id}:${contact?.id || "missing"}`, target, contact })));
  const visible = rows.filter(row => `${row.target.companyName} ${row.contact?.displayName || ""} ${row.contact?.role || ""}`.toLowerCase().includes(filter.toLowerCase()));
  const selectedRows = visible.filter(row => selected.includes(row.key) && row.contact);
  const selectable = visible.filter(row => row.contact);
  const openRow = rows.find(row => row.key === openKey);
  const allSelected = selectable.length > 0 && selectable.every(row => selected.includes(row.key));
  const selectAll = useRef<HTMLInputElement>(null);
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selectedRows.length > 0 && !allSelected; }, [selectedRows.length, allSelected]);
  function close() {
    if (dirty && !window.confirm("Discard unsaved draft edits?")) return;
    dialog.current?.close(); setOpenKey(null); setDirty(false); opener.current?.focus();
  }
  function open(key: string, element: HTMLElement) { opener.current = element; setOpenKey(key); }
  function readiness(row: typeof rows[number]) {
    if (!initialBuyerProfile?.publicProfileApproved) return "Approve profile in Brief";
    if (["parked", "excluded"].includes(row.target.stage || "")) return "Inactive company";
    if (row.contact?.doNotContact) return "Do not contact";
    if (row.contact?.fictionalised) return "Real contact needed";
    if (!row.contact?.email) return "Work email needed";
    return "Ready";
  }
  async function batch(action: "generate" | "save-gmail") {
    const work = [...selectedRows];
    setBusy(true); cancelled.current = false; setProgress({ completed: 0, total: work.length });
    try {
      // One contact per request keeps long-running provider calls bounded and gives
      // immediate per-row feedback. The server validates every contact independently.
      for (const [index, row] of work.entries()) {
        if (index > 0) await new Promise(resolve => setTimeout(resolve, 300));
        if (cancelled.current) break;
        setResults(current => ({ ...current, [row.key]: action === "generate" ? "Generating…" : "Saving to Gmail…" }));
        try {
          const response = await fetch("/api/outreach/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mandateId, action, rows: [{ targetId: row.target.id, contactId: row.contact!.id }] }) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Request failed");
          const result = data.results?.[0];
          if (!result?.ok) throw new Error(result?.error || "No result returned");
          if (mounted.current) setResults(current => ({ ...current, [row.key]: action === "generate" ? result.result?.reused ? "Saved drafts already exist" : "Drafts ready" : "Saved to Gmail Drafts" }));
        } catch (error) {
          if (mounted.current) setResults(current => ({ ...current, [row.key]: `Failed: ${error instanceof Error ? error.message : "Request failed"}` }));
        }
        if (!mounted.current) break;
        setProgress({ completed: index + 1, total: work.length }); router.refresh();
      }
    } finally { if (mounted.current) { setBusy(false); router.refresh(); } }
  }
  return <section className="min-w-0 space-y-4">
    <header><h2 className="text-xl font-semibold">Outreach</h2><p className="mt-2 text-sm text-[var(--muted)]">Select decision-makers to generate drafts. Open a person to review and edit their messages.</p></header>
    {!initialBuyerProfile?.publicProfileApproved && <p className="text-sm text-[var(--status-amber)]"><Link href={`/mandates/${mandateId}?tab=brief`} className="underline">Go to Brief to complete and approve the buyer profile</Link> before drafting.</p>}
    <label className="block max-w-md text-sm">Find a person or business<input value={filter} disabled={busy} onChange={event => { setFilter(event.target.value); setSelected([]); }} className="mt-2 min-h-12 w-full rounded-md border border-[var(--border)] bg-[var(--panel)] px-3" /></label>
    <div className="flex flex-wrap items-center gap-3"><span className="text-sm">{selectedRows.length} selected</span><button className={button} disabled={busy || !selectedRows.length || !initialBuyerProfile?.publicProfileApproved} onClick={() => void batch("generate")}>Generate drafts</button><button className={button} disabled={busy || !selectedRows.length || !canCompose || !initialBuyerProfile?.publicProfileApproved} onClick={() => void batch("save-gmail")}>Save to Gmail Drafts</button><button className={button} disabled={busy || !selected.length} onClick={() => setSelected([])}>Clear selection</button>{busy && <button className={button} onClick={() => { cancelled.current = true; }}>Stop after current contact</button>}</div>
    {!canCompose && <p className="text-sm text-[var(--muted)]"><Link href="/settings" className="underline">Connect Gmail with draft permission</Link> to save messages to your inbox drafts.</p>}
    <p className="text-xs text-[var(--muted)]">Messages are saved as drafts for review. Sending is unavailable.</p>
    {progress.total > 0 && <div className="space-y-2"><p role="status" className="text-sm">{busy ? "Processing" : progress.completed < progress.total ? "Stopped" : "Finished"}: {progress.completed} of {progress.total} contacts processed. Check each row for its result.</p><progress aria-label="Contacts processed" max={progress.total} value={progress.completed} className="h-2 w-full accent-[var(--accent)]" /></div>}
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-[var(--panel)]"><tr><th className="p-3"><input ref={selectAll} type="checkbox" aria-label="Select all visible contacts" disabled={busy || !selectable.length} checked={allSelected} onChange={event => setSelected(event.target.checked ? selectable.map(row => row.key) : [])} /></th>{["Decision-maker", "Business", "Work email", "Stage", "Readiness", "Drafts"].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{visible.map(row => {
      const drafts = row.target.drafts.filter(draft => draft.contactId === row.contact?.id);
      return <tr key={row.key} className="border-t border-[var(--border)] hover:bg-[var(--panel)]" onClick={event => { if (!(event.target as HTMLElement).closest("button,input,a")) { const trigger = event.currentTarget.querySelector("button"); if (trigger) open(row.key, trigger); } }}><td className="p-3"><input type="checkbox" aria-label={`Select ${row.contact?.displayName || "missing contact"} at ${row.target.companyName}`} disabled={busy || !row.contact} checked={selected.includes(row.key)} onChange={event => setSelected(current => event.target.checked ? [...current, row.key] : current.filter(key => key !== row.key))} /></td><td className="p-3"><button className="min-h-12 text-left font-semibold underline" onClick={event => open(row.key, event.currentTarget)}>{row.contact?.displayName || "Find a decision-maker"}</button><p className="text-xs text-[var(--muted)]">{row.contact?.role || "Role unknown"}</p></td><td className="p-3">{row.target.companyName}</td><td className="max-w-52 break-all p-3">{row.contact?.email || "Missing"}</td><td className="p-3">{row.target.stage || "Unknown"}</td><td className="p-3">{readiness(row)}</td><td className="max-w-64 break-words p-3"><span role="status">{results[row.key] || (drafts.length ? `${drafts.length} drafts · ${drafts.filter(draft => draft.gmailDraftSaved).length} in Gmail` : "No drafts")}</span></td></tr>;
    })}</tbody></table>{!visible.length && <p className="p-6 text-sm text-[var(--muted)]">No outreach candidates in this view. Add companies and contacts in Targets.</p>}</div>
    {openRow && <dialog ref={dialog} onPointerDown={event => dialogBackdrop(backdropPressed, close).onPointerDown(event)} onPointerCancel={() => { backdropPressed.current = false; }} onClick={event => dialogBackdrop(backdropPressed, close).onClick(event)} aria-labelledby="outreach-drawer-title" onCancel={event => { event.preventDefault(); close(); }} className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-none overflow-y-auto border-l border-[var(--border)] bg-[var(--background)] p-5 text-[var(--foreground)] backdrop:bg-black/50 sm:w-[min(760px,90vw)] sm:p-6"><header className="mb-5 flex items-center justify-between gap-4"><div><h2 id="outreach-drawer-title" className="text-xl font-semibold">{openRow.contact?.displayName || "Find a decision-maker"}</h2><p className="text-sm text-[var(--muted)]">{openRow.target.companyName}</p></div><button autoFocus aria-label="Close outreach drafts" className="flex size-12 shrink-0 items-center justify-center rounded-md border border-[var(--border)]" onClick={close}><X size={22} /></button></header><OutreachQueue key={openRow.key} mandateId={mandateId} initialTargetId={openRow.target.id} initialTargets={[{ ...openRow.target, contacts: openRow.contact ? [openRow.contact] : [] }]} initialBuyerProfile={initialBuyerProfile} canCompose={canCompose} embedded onDirtyChange={setDirty} /></dialog>}
  </section>;
}
