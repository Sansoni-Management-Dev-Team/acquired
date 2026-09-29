"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Clock3 } from "lucide-react";
import type { AcquisitionBrief, MandateView } from "@/domain/acquisition";

export function HomeMandateCreate({ mandates }: { mandates: MandateView[] }) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setError("");
    setBusy(true);
    try {
      const generated = await fetch("/api/mandates/generate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description }),
      });
      const draft = await generated.json() as { brief?: AcquisitionBrief; error?: string };
      if (!generated.ok || !draft.brief) throw new Error(draft.error || "Could not create a mandate from your description.");
      const saved = await fetch("/api/mandates", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft.brief),
      });
      const result = await saved.json() as { id?: string; error?: string };
      if (!saved.ok || !result.id) throw new Error(result.error || "Could not save the mandate.");
      router.push(`/mandates/${result.id}`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the mandate.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="mx-auto max-w-6xl space-y-10 p-5 sm:p-8">
    <section className="rounded-3xl bg-[linear-gradient(115deg,#bfd2f6_0%,#d8c7f5_45%,#f5c2a5_100%)] px-5 py-16 text-slate-900 sm:px-10 sm:py-20">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-center text-3xl font-bold tracking-tight sm:text-5xl">Create a mandate</h1>
        <p className="mt-3 text-center text-sm text-slate-700 sm:text-base">Tell us what you want to buy. We’ll turn it into a mandate you can review.</p>
        <form onSubmit={event => { event.preventDefault(); void create(); }} className="mt-8 rounded-2xl bg-white p-5 shadow-xl sm:p-7">
          <label htmlFor="mandate-description" className="block text-sm font-semibold">Tell us about the businesses you’re looking to buy</label>
          <textarea id="mandate-description" required minLength={10} maxLength={5000} rows={5} value={description} onChange={event => setDescription(event.target.value)} placeholder="For example: profitable commercial refrigeration service businesses in Victoria with recurring maintenance work" className="mt-3 w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-900 placeholder:text-slate-500" />
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex justify-end"><button disabled={busy || description.trim().length < 10} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Creating mandate…" : "Create mandate"}<ArrowRight size={17} /></button></div>
        </form>
      </div>
    </section>
    <section aria-labelledby="recent-mandates-heading" className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 sm:p-7">
      <div className="flex items-center justify-between gap-4"><h2 id="recent-mandates-heading" className="text-2xl font-semibold">Your recent mandates</h2><Link href="/mandates" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--panel-raised)]">View all</Link></div>
      {mandates.length ? <div className="mt-5 grid gap-3">{mandates.slice(0, 5).map(mandate => <Link key={mandate.id} href={`/mandates/${mandate.id}`} className="flex items-center gap-4 rounded-xl border border-[var(--border)] p-4 hover:bg-[var(--panel-raised)]"><Clock3 size={20} className="shrink-0 text-[var(--accent)]" /><span><strong className="block">{mandate.brief.name}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{new Date(mandate.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</span></span></Link>)}</div> : <p className="mt-5 text-sm text-[var(--muted)]">Your mandates will appear here after you create one.</p>}
    </section>
  </div>;
}
