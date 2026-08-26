"use client";

import { useMemo, useState } from "react";
import { draftSequence } from "@/domain/outreach";
import { seedTargets } from "@/data/seed-targets";

export function OutreachQueue() {
  const [approved, setApproved] = useState<Set<number>>(new Set());
  const drafts = useMemo(() => draftSequence(seedTargets[0].companyName, "Alex", seedTargets[0].signals, new Date("2026-08-26T09:00:00+10:00")), []);
  function toggle(step: number) { setApproved((current) => { const next = new Set(current); if (next.has(step)) next.delete(step); else next.add(step); return next; }); }
  return <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
    <aside className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <p className="text-xs uppercase tracking-[.16em] text-[var(--muted)]">Default sequence</p><h2 className="mt-2 text-xl font-semibold">Owner succession</h2>
      <dl className="mt-5 space-y-3 text-sm"><div className="flex justify-between"><dt className="text-[var(--muted)]">Messages</dt><dd>7</dd></div><div className="flex justify-between"><dt className="text-[var(--muted)]">Window</dt><dd>35 business days</dd></div><div className="flex justify-between"><dt className="text-[var(--muted)]">Delivery</dt><dd className="text-amber-300">Mock mailbox</dd></div></dl>
      <p className="mt-5 rounded-md bg-black/20 p-3 text-xs leading-5 text-[var(--muted)]">A reply, unsubscribe, bounce, suppression, or manual stop halts every remaining step.</p>
    </aside>
    <section className="space-y-3">
      {drafts.map((draft) => <article key={draft.step} className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><span className="text-xs uppercase tracking-[.16em] text-[var(--accent)]">Step {draft.step}</span><h3 className="mt-1 font-semibold">{draft.subject}</h3></div><button onClick={() => toggle(draft.step)} className={`rounded-md border px-3 py-2 text-xs font-semibold ${approved.has(draft.step) ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--muted)]"}`}>{approved.has(draft.step) ? "Approved" : "Approve draft"}</button></div>
        <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-6 text-[var(--muted)]">{draft.body}</p>
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--muted)]"><span>{draft.scheduledFor.toLocaleDateString("en-AU", { dateStyle: "medium" })}</span><span>Evidence: {draft.signalIds.join(", ")}</span></div>
      </article>)}
    </section>
  </div>;
}
