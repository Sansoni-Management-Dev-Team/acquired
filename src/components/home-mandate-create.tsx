"use client";

import { randomUuid } from "@/lib/random-uuid";


import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMandateCache } from "@/lib/mandate-cache";
import Link from "next/link";
import { ArrowRight, CircleAlert, Clock3, LoaderCircle } from "lucide-react";
import type { AcquisitionBrief, MandateView } from "@/domain/acquisition";
import { CompanyDiscoveryLoading } from "./company-discovery-loading";
import { CompanyPipelineProgress } from "./company-pipeline-progress";
import {z} from "zod";
import {briefSchema} from "@/domain/acquisition";
import { useRouter } from "next/navigation";
import { AgentModeToggle, AgentPlanReview } from "./agent-mode";
import { DetailTooltip } from "./detail-tooltip";
import {cachedDemoRequestTimeoutMs,saveCachedDemoRequest} from '@/lib/cached-demo-request';

const cachedDemoSchema=z.object({sourceMandateId:z.string().uuid(),brief:briefSchema,companies:z.number().int().nonnegative(),people:z.number().int().nonnegative()});

export function HomeMandateCreate({ mandates, recentStatus, recentLoaded = true, agentModeEnabled = false, nativeAgentEnabled = false }: { nativeAgentEnabled?: boolean; agentModeEnabled?: boolean; mandates: MandateView[]; recentStatus?: ReactNode; recentLoaded?: boolean }) {
  const router = useRouter();
  const [agentMode, setAgentMode] = useState(false);
  const [reviewBrief, setReviewBrief] = useState<AcquisitionBrief | null>(null);
  const [reviewMode, setReviewMode] = useState<"custom" | "demo">("custom");
  const [description, setDescription] = useState("");
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  // Preserve text entered into the server-rendered field before hydration.
  useEffect(() => {
    if (descriptionInput.current) setDescription(descriptionInput.current.value);
  }, []);
  const createLock = useRef(false);
  const demoSource=useRef<z.infer<typeof cachedDemoSchema>|null>(null),demoCreateRequest=useRef<string|null>(null);
  const [demoAttempted,setDemoAttempted]=useState(false),[creatingDemo,setCreatingDemo]=useState(false);
  const researchRequestId = useRef<string | null>(null);
  const nativeCreateRequest = useRef<string | null>(null);
  const [nativeCreateAttempted,setNativeCreateAttempted] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [searchRun, setSearchRun] = useState<{ mandateId: string; jobId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  async function create(mode: "custom" | "demo" = "custom", approvedBrief?: AcquisitionBrief) {
    if (busy || createLock.current) return;
    createLock.current = true;
    setError("");
    setBusy(true);setCreatingDemo(mode==='demo'||Boolean(demoSource.current));
    const native = agentMode && nativeAgentEnabled;
    setProgress(mode === "demo" ? "Loading a demo mandate…" : "Generating your mandate…");
    try {
      let id = createdId;
      if(mode==='demo'||demoSource.current){
        if(!demoSource.current){
          setProgress('Loading saved company and people data…');
          const response=await fetch('/api/mandates/demo-data',{cache:'no-store',signal:AbortSignal.timeout(cachedDemoRequestTimeoutMs)}),value=await response.json();
          if(!response.ok)throw Error(typeof value.error==='string'?value.error:'No saved demo data is available.');
          const parsed=cachedDemoSchema.safeParse(value);if(!parsed.success)throw Error('The saved demo dataset could not be verified.');demoSource.current=parsed.data;
        }
        const source=demoSource.current;setDescription(source.brief.naturalLanguage);setDemoAttempted(true);
        if(!id){
          setProgress('Preparing your saved demo workspace…');
          if(native){nativeCreateRequest.current??=JSON.stringify({requestId:randomUuid(),brief:source.brief,executionMode:'demo',demoSourceMandateId:source.sourceMandateId});setNativeCreateAttempted(true);}
          else demoCreateRequest.current??=JSON.stringify({requestId:randomUuid(),sourceMandateId:source.sourceMandateId});
          const value=await saveCachedDemoRequest({native,body:native?nativeCreateRequest.current!:demoCreateRequest.current!,sourceMandateId:source.sourceMandateId,onReconcile:()=>setProgress('Checking your saved demo workspace…')});
          id=value.id;setCreatedId(id);useMandateCache.getState().upsert({id,brief:source.brief,createdAt:new Date().toISOString()});
        }
        router.push(agentMode?`/mandates/${id}/agent`:`/mandates/${id}?tab=targets`);setBusy(false);setProgress('');return;
      }
      if (!id) {
        let brief: AcquisitionBrief;
        if (native && nativeCreateRequest.current) {
          brief = (JSON.parse(nativeCreateRequest.current) as { brief: AcquisitionBrief }).brief;
        } else if (approvedBrief) {
          brief = approvedBrief;
        } else {
          const generated = await fetch("/api/mandates/generate", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description }),
            signal: AbortSignal.timeout(45000),
          });
          const draft = await generated.json() as { brief?: AcquisitionBrief; error?: string };
          if (!generated.ok || !draft.brief) throw new Error(draft.error || "Could not create a mandate from your description.");
          brief = draft.brief;
        }
        if (agentMode && !native && !approvedBrief) {
          setReviewMode(mode);
          setReviewBrief(brief);
          setBusy(false);
          setProgress("");
          return;
        }
        setProgress("Saving your mandate…");
        if (native) {nativeCreateRequest.current ??= JSON.stringify({requestId:randomUuid(),brief,executionMode:'real'});setNativeCreateAttempted(true);}
        const saved = await fetch(native ? "/api/mandates/agent" : "/api/mandates", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: native ? nativeCreateRequest.current! : JSON.stringify(brief),
          signal: AbortSignal.timeout(15000),
        });
        const result = await saved.json() as { id?: string; revision?: string; error?: string };
        if (!saved.ok || !result.id) throw new Error(result.error || "Could not save the mandate.");
        if(native&&(!result.revision || !/^\d{1,30}$/.test(result.revision)))throw new Error("Could not confirm the saved mandate revision. Retry this exact request.");
        id = result.id;
        setCreatedId(id);
        useMandateCache.getState().upsert({ id, brief, createdAt: new Date().toISOString() });
      }
      if(native){
        // The server owns the saved initial research launch; opening chat never launches it again.
        router.push(`/mandates/${id}/agent`);setBusy(false);setProgress("");return;
      }
      setProgress("Starting company research…");
      researchRequestId.current ??= randomUuid();
      const research = await fetch(`/api/mandates/${id}/research`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: researchRequestId.current, fromBrief: true }),
        signal: AbortSignal.timeout(30000),
      });
      const researchResult = await research.json() as { error?: string; jobId?: string };
      if (!research.ok && !(research.status === 409 && researchResult.error?.includes("already running"))) throw new Error(researchResult.error || "Could not start company research.");
      if (agentMode) {
        router.push(`/mandates/${id}/agent`);
        setBusy(false);
        setProgress("");
      } else setSearchRun({ mandateId: id, jobId: researchResult.jobId });
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "TimeoutError" ? "This is taking longer than expected. Please try again." : cause instanceof Error ? cause.message : "Could not create the mandate.");
      setBusy(false);
      setProgress("");
    } finally {
      createLock.current = false;
    }
  }

  if (reviewBrief) return <AgentPlanReview demo={reviewMode==='demo'} nativeAgentEnabled={nativeAgentEnabled} saved={Boolean(createdId) || nativeCreateAttempted || demoAttempted} brief={reviewBrief} busy={busy} error={error} savedMandateId={createdId || undefined} onBack={() => { setReviewBrief(null); setReviewMode('custom'); setError(""); }} onStart={() => void create(reviewMode, reviewBrief)} />;
  if (searchRun) return <CompanyDiscoveryLoading mandateId={searchRun.mandateId} startedJobId={searchRun.jobId} />;
  if(busy&&creatingDemo)return <section role="status" aria-live="polite" className="mx-auto my-[8vh] max-w-xl space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-7"><LoaderCircle size={24} className="animate-spin text-[var(--muted)]" aria-hidden="true"/><h1 className="text-xl font-semibold">Opening your demo workspace</h1><p className="text-sm text-[var(--muted)]">{progress}</p><p className="text-xs text-[var(--muted)]">Saved companies and people · no live research.</p></section>;
  if (busy) return agentMode ? <section role="status" aria-live="polite" className="mx-auto my-[8vh] max-w-xl space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-7"><LoaderCircle size={24} className="animate-spin text-[var(--muted)]" aria-hidden="true"/><h1 className="text-xl font-semibold">Preparing your agent workspace</h1><p className="text-sm text-[var(--muted)]">{progress}</p><p className="text-xs text-[var(--muted)]">Your agent will summarize the mandate in chat. Press Start when you’re ready.</p></section> : <div className="mx-auto my-[8vh] max-w-[620px] px-4 sm:px-0"><CompanyPipelineProgress detail={progress || undefined} /></div>;

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
          <textarea ref={descriptionInput} id="mandate-description" required minLength={10} maxLength={5000} rows={5} readOnly={Boolean(createdId) || nativeCreateAttempted || demoAttempted} defaultValue={description} onChange={event => setDescription(event.target.value)} placeholder="For example: We are seeking an established commercial refrigeration service business in Queensland or New South Wales with annual revenue of AUD 4–12 million, EBITDA of AUD 700,000–2 million and 15–55 employees. Prefer recurring maintenance and repair work for commercial customers, diversified customers and a capable management team. We are open to a full or majority acquisition with an owner transition period." className="mt-3 w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--input)] px-4 py-3 text-base text-[var(--foreground)] placeholder:text-[var(--muted)] focus-visible:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]" />
          {agentModeEnabled && <AgentModeToggle nativeAgentEnabled={nativeAgentEnabled} enabled={agentMode} disabled={busy || Boolean(createdId) || nativeCreateAttempted || demoAttempted} onChange={setAgentMode} />}
          {error && <p role="alert" className="mt-3 text-sm text-[var(--status-red)]">{error}</p>}
          {progress && <p role="status" className="mt-3 text-sm text-[var(--muted)]">{progress}</p>}
          {createdId && error && <Link href={`/mandates/${createdId}?tab=targets`} className="mt-2 inline-block text-sm text-[var(--accent)] underline underline-offset-4">Open your saved mandate</Link>}
          <div className="mt-4 flex flex-wrap justify-end gap-3"><button type="button" disabled={busy || Boolean(createdId) || nativeCreateAttempted || demoAttempted} onClick={() => void create("demo")} className="min-h-12 rounded-xl border border-[var(--border)] px-5 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--panel-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50">Run demo</button><button disabled={busy || !demoAttempted&&description.trim().length < 10} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Working…" : demoAttempted ? "Retry opening demo" : agentMode && nativeCreateAttempted ? "Retry opening agent chat" : createdId ? "Retry company research" : agentMode ? nativeAgentEnabled ? "Continue" : "Review agent plan" : "Find companies"}<ArrowRight size={17} /></button></div>
          <p className="mt-3 text-right text-xs text-[var(--muted)]">Demo uses saved companies and people. No live research is run.</p>
        </form>
      </div>
    </section>
    <section aria-labelledby="recent-mandates-heading" className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-5 sm:p-7">
      <div className="flex items-center justify-between gap-4"><h2 id="recent-mandates-heading" className="text-2xl font-semibold">Your recent mandates</h2><Link href="/mandates" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--panel-raised)]">View all</Link></div>
      {recentStatus && <div className="mt-5">{recentStatus}</div>}
      {mandates.length ? <div className="mt-5 grid gap-3">{mandates.slice(0, 5).map(mandate => <Link key={mandate.id} href={`/mandates/${mandate.id}`} className="flex items-center gap-4 rounded-xl border border-[var(--border)] p-4 hover:bg-[var(--panel-raised)]"><Clock3 size={20} className="shrink-0 text-[var(--accent)]" /><span><strong className="block">{mandate.brief.name}</strong><span className="mt-1 block text-xs text-[var(--muted)]">{new Date(mandate.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</span></span></Link>)}</div> : recentLoaded ? <p className="mt-5 text-sm text-[var(--muted)]">Your mandates will appear here after you create one.</p> : null}
    </section>
  </div>;
}
