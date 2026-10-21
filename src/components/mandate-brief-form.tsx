"use client";

import { randomUuid } from "@/lib/random-uuid";


import { useState } from "react";
import { CompanyDiscoveryLoading } from "./company-discovery-loading";
import { CompanyPipelineProgress } from "./company-pipeline-progress";
import { useMandateCache } from "@/lib/mandate-cache";
import type { AcquisitionBrief } from "@/domain/acquisition";

async function postJson(url: string, body: unknown, timeoutMs: number) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const result = await response.json() as { error?: string; jobId?: string; brief?: AcquisitionBrief; revision?:string };
  if (!response.ok && !(response.status === 409 && result.error?.includes("already running"))) throw new Error(result.error || "Could not start company research.");
  return result;
}

export function MandateBriefForm({ mandateId, brief, revision, onSaved }: { mandateId: string; brief: AcquisitionBrief; revision?:string; onSaved?: (brief: AcquisitionBrief,revision?:string) => void }) {
  const [searchRun, setSearchRun] = useState<{ jobId?: string } | null>(null);
  const [description, setDescription] = useState(brief.naturalLanguage);
  const [savedDescription, setSavedDescription] = useState(brief.naturalLanguage);
  const [baseRevision,setBaseRevision]=useState(revision);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  async function reloadBrief(){
    setBusy(true);setError('');
    try{
      const response=await fetch(`/api/mandates/${mandateId}?briefOnly=true`,{cache:'no-store'});
      const result=await response.json();
      if(!response.ok||!result.mandate?.revision||!result.mandate?.brief)throw new Error('Could not load the saved brief.');
      const saved=result.mandate as {brief:AcquisitionBrief;revision:string};
      setDescription(saved.brief.naturalLanguage);setSavedDescription(saved.brief.naturalLanguage);setBaseRevision(saved.revision);
      onSaved?.(saved.brief,saved.revision);
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not load the saved brief.');}
    finally{setBusy(false);}
  }

  async function findCompanies() {
    setBusy(true);
    setError("");
    try {
      if (description.trim() !== savedDescription) {
        if(!baseRevision)throw new Error('Load the saved brief before editing it.');
        setProgress("Updating your search…");
        const updated = await postJson(`/api/mandates/${mandateId}`, { action: "brief-description", description, expectedRevision:baseRevision }, 40000);
        if(!updated.brief||!updated.revision)throw new Error('The saved brief could not be confirmed. Load the saved brief before continuing.');
        if (updated.brief) {
          setBaseRevision(updated.revision);
          onSaved?.(updated.brief,updated.revision);
          const cached = useMandateCache.getState().entry?.mandates.find(m => m.id === mandateId);
          if (cached) useMandateCache.getState().upsert({ ...cached, brief: updated.brief,revision:updated.revision });
        }
        setSavedDescription(description.trim());
      }
      setProgress("Starting company research…");
      const result = await postJson(`/api/mandates/${mandateId}/research`, { requestId: randomUuid(), fromBrief: true }, 30000);
      setSearchRun({ jobId: result.jobId });
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "TimeoutError" ? "This is taking longer than expected. Please try again." : cause instanceof Error ? cause.message : "Could not start company research.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  if (searchRun) return <CompanyDiscoveryLoading mandateId={mandateId} startedJobId={searchRun.jobId} />;
  if (busy) return <div className="mx-auto my-[8vh] max-w-[620px]"><CompanyPipelineProgress detail={progress || undefined} /></div>;

  return <div className="mx-auto max-w-4xl space-y-5"><form onSubmit={event => { event.preventDefault(); void findCompanies(); }} className="mx-auto max-w-4xl space-y-5 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 sm:p-8">
    <label htmlFor="acquisition-description" className="block text-sm font-semibold">Describe the acquisition brief</label>
    <textarea id="acquisition-description" required minLength={10} maxLength={10000} rows={10} readOnly={busy} value={description} onChange={event => setDescription(event.target.value)} placeholder="Tell us about the businesses you’re looking to buy" className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--panel-raised)] p-4 text-sm text-[var(--foreground)]" />
    {error && <div className="space-y-2"><p role="alert" className="text-sm text-[var(--status-red)]">{error}</p><button type="button" onClick={()=>void reloadBrief()} className="text-sm underline underline-offset-4">Load saved brief</button><p className="text-xs text-[var(--muted)]">Loading replaces your unsaved description with the current saved brief.</p></div>}
    {progress && <p role="status" className="text-sm text-[var(--muted)]">{progress}</p>}
    {description.trim()!==savedDescription && <p className="text-sm text-[var(--muted)]">Your description changes remain unsaved. Find companies updates the description and starts research separately.</p>}
    <div className="flex justify-end"><button disabled={busy || description.trim().length < 10} className="min-h-12 rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-50">{busy ? "Finding companies…" : "Find companies"}</button></div>
  </form>
  </div>;
}
