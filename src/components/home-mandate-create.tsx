"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CircleAlert, Clock3 } from "lucide-react";
import type { AcquisitionBrief, MandateView } from "@/domain/acquisition";
import { CompanyDiscoveryLoading } from "./company-discovery-loading";
import { CompanySearchProgress } from "./company-search-progress";
import { nextTestMandate } from "@/domain/test-mandates";
import { DetailTooltip } from "./detail-tooltip";

export function HomeMandateCreate({ mandates }: { mandates: MandateView[] }) {
  const [description, setDescription] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [searchRun, setSearchRun] = useState<{ mandateId: string; jobId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  async function create(mode: "custom" | "demo" = "custom") {
    if (busy) return;
    setError("");
    setBusy(true);
    setProgress(mode === "demo" ? "Loading a demo mandate…" : "Generating your mandate…");
    try {
      let id = createdId;
      if (!id) {
        let brief: AcquisitionBrief;
        if (mode === "demo") {
          brief = nextTestMandate();
          setDescription(brief.naturalLanguage);
        } else {
          const generated = await fetch("/api/mandates/generate", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description }),
            signal: AbortSignal.timeout(45000),
          });
          const draft = await generated.json() as { brief?: AcquisitionBrief; error?: string };
          if (!generated.ok || !draft.brief) throw new Error(draft.error || "Could not create a mandate from your description.");
          brief = draft.brief;
        }
        setProgress("Saving your mandate…");
        const saved = await fetch("/api/mandates", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(brief),
          signal: AbortSignal.timeout(15000),
        });
        const result = await saved.json() as { id?: string; error?: string };
        if (!saved.ok || !result.id) throw new Error(result.error || "Could not save the mandate.");
        id = result.id;
        setCreatedId(id);
      }
      setProgress("Starting company research…");
      const research = await fetch(`/api/mandates/${id}/research`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: crypto.randomUUID(), fromBrief: true }),
        signal: AbortSignal.timeout(30000),
      });
      const researchResult = await research.json() as { error?: string; jobId?: string };
      if (!research.ok && !(research.status === 409 && researchResult.error?.includes("already running"))) throw new Error(researchResult.error || "Could not start company research.");
      setSearchRun({ mandateId: id, jobId: researchResult.jobId });
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "TimeoutError" ? "This is taking longer than expected. Please try again." : cause instanceof Error ? cause.message : "Could not create the mandate.");
      setBusy(false);
      setProgress("");
    }
  }

  if (searchRun) return <CompanyDiscoveryLoading mandateId={searchRun.mandateId} startedJobId={searchRun.jobId} />;
  if (busy) return <div className="mx-auto my-[8vh] max-w-[620px] px-4 sm:px-0"><CompanySearchProgress detail={progress || undefined} /></div>;

  return <div className="mx-auto max-w-6xl space-y-10 p-5 sm:p-8">
    <section className="rounded-3xl px-5 py-16 text-[var(--foreground)] sm:px-10 sm:py-20">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-center text-3xl font-bold tracking-tight sm:text-5xl">Create a mandate</h1>
        <p className="mt-3 text-center text-sm text-[var(--muted)] sm:text-base">Tell us what you want to buy. We’ll turn it into a mandate you can review.</p>
        <form onSubmit={event => { event.preventDefault(); void create(); }} className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm sm:p-7">
          <div className="flex items-center gap-2">
            <label htmlFor="mandate-description" className="text-sm font-semibold">Tell us about the businesses you’re looking to buy</label>
            <DetailTooltip content={<div className="space-y-2 text-sm leading-relaxed">
              <p className="font-semibold">Tips for a good mandate</p>
              <ul className="list-disc space-y-2 pl-4">
                <li>Describe the industry, services and customers you want to target.</li>
                <li>Specify the states or regions where the business should operate.</li>
                <li>Give target revenue, EBITDA and team size ranges, including the currency.</li>
                <li>Separate must-haves from preferences, such as recurring revenue, licences or low owner dependence. Mention any exclusions.</li>
                <li>Include your preferred acquisition structure and owner transition, if known.</li>
              </ul>
              <p className="text-[var(--muted)]">Plain English is enough. Include what you know and leave anything you’re unsure about open.</p>
            </div>}>
              <span className="flex size-7 items-center justify-center rounded-full text-[var(--muted)] hover:bg-[var(--panel-raised)] hover:text-[var(--foreground)]">
                <CircleAlert size={16} aria-hidden="true" />
                <span className="sr-only">Tips for writing a good mandate</span>
              </span>
            </DetailTooltip>
          </div>
          <textarea id="mandate-description" required minLength={10} maxLength={5000} rows={5} readOnly={Boolean(createdId)} value={description} onChange={event => setDescription(event.target.value)} placeholder="For example: We are seeking an established commercial refrigeration service business in Queensland or New South Wales with annual revenue of AUD 4–12 million, EBITDA of AUD 700,000–2 million and 15–55 employees. Prefer recurring maintenance and repair work for commercial customers, diversified customers and a capable management team. We are open to a full or majority acquisition with an owner transition period." className="mt-3 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--input)] px-4 py-3 text-base text-[var(--foreground)] placeholder:text-[var(--muted)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]" />
          {error && <p role="alert" className="mt-3 text-sm text-[var(--status-red)]">{error}</p>}
          {progress && <p role="status" className="mt-3 text-sm text-[var(--muted)]">{progress}</p>}
          {createdId && error && <Link href={`/mandates/${createdId}?tab=targets`} className="mt-2 inline-block text-sm text-[var(--accent)] underline underline-offset-4">Open your saved mandate</Link>}
          <div className="mt-4 flex flex-wrap justify-end gap-3"><button type="button" disabled={busy || Boolean(createdId)} onClick={() => void create("demo")} className="min-h-12 rounded-xl border border-[var(--border)] px-5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--panel-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50">Run demo</button><button disabled={busy || description.trim().length < 10} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Working…" : createdId ? "Retry company research" : "Find companies"}<ArrowRight size={17} /></button></div>
        </form>
      </div>
    </section>
    <section aria-labelledby="recent-mandates-heading" className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 sm:p-7">
      <div className="flex items-center justify-between gap-4"><h2 id="recent-mandates-heading" className="text-2xl font-semibold">Your recent mandates</h2><Link href="/mandates" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--panel-raised)]">View all</Link></div>
      {mandates.length ? <div className="mt-5 grid gap-3">{mandates.slice(0, 5).map(mandate => <Link key={mandate.id} href={`/mandates/${mandate.id}`} className="flex items-center gap-4 rounded-xl border border-[var(--border)] p-4 hover:bg-[var(--panel-raised)]"><Clock3 size={20} className="shrink-0 text-[var(--accent)]" /><span><strong className="block">{mandate.brief.name}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{new Date(mandate.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</span></span></Link>)}</div> : <p className="mt-5 text-sm text-[var(--muted)]">Your mandates will appear here after you create one.</p>}
    </section>
  </div>;
}
