"use client";

import { useRouter } from "next/navigation";
import { BriefCriteria } from "./brief-criteria";
import { useState } from "react";
import { CompanyDiscoveryLoading } from "./company-discovery-loading";
import { CompanySearchProgress } from "./company-search-progress";
import type { AcquisitionBrief } from "@/domain/acquisition";

async function postJson(url: string, body: unknown, timeoutMs: number) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const result = await response.json() as { error?: string; jobId?: string; brief?: AcquisitionBrief };
  if (!response.ok && !(response.status === 409 && result.error?.includes("already running"))) throw new Error(result.error || "Could not start company research.");
  return result;
}

export function MandateBriefForm({ mandateId, brief, onSaved }: { mandateId: string; brief: AcquisitionBrief; onSaved?: (brief: AcquisitionBrief) => void }) {
  const router = useRouter();
  const [currentBrief, setCurrentBrief] = useState(brief);
  const [criteria, setCriteria] = useState(brief.criteria);
  const [savedCriteria, setSavedCriteria] = useState(brief.criteria);
  const [savingCriteria, setSavingCriteria] = useState(false);
  const [criteriaMessage, setCriteriaMessage] = useState("");
  const [searchRun, setSearchRun] = useState<{ jobId?: string } | null>(null);
  const [description, setDescription] = useState(brief.naturalLanguage);
  const [savedDescription, setSavedDescription] = useState(brief.naturalLanguage);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  async function findCompanies() {
    setBusy(true);
    setError("");
    try {
      if (JSON.stringify(criteria) !== JSON.stringify(savedCriteria)) {
        await postJson(`/api/mandates/${mandateId}`, { action: "brief", brief: { ...currentBrief, criteria } }, 40000);
        setSavedCriteria(criteria);
        setCurrentBrief({ ...currentBrief, criteria });
        onSaved?.({ ...currentBrief, criteria });
      }
      if (description.trim() !== savedDescription) {
        setProgress("Updating your search…");
        const updated = await postJson(`/api/mandates/${mandateId}`, { action: "brief-description", description }, 40000);
        if (updated.brief) {
          setCurrentBrief(updated.brief);
          setCriteria(updated.brief.criteria);
          setSavedCriteria(updated.brief.criteria);
          onSaved?.(updated.brief);
        }
        setSavedDescription(description.trim());
      }
      setProgress("Starting company research…");
      const result = await postJson(`/api/mandates/${mandateId}/research`, { requestId: crypto.randomUUID(), fromBrief: true }, 30000);
      setSearchRun({ jobId: result.jobId });
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "TimeoutError" ? "This is taking longer than expected. Please try again." : cause instanceof Error ? cause.message : "Could not start company research.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function saveCriteria() {
    setSavingCriteria(true);
    setCriteriaMessage("");
    try {
      await postJson(`/api/mandates/${mandateId}`, { action: "brief", brief: { ...currentBrief, criteria } }, 40000);
      setSavedCriteria(criteria);
      setCurrentBrief({ ...currentBrief, criteria });
      onSaved?.({ ...currentBrief, criteria });
      setCriteriaMessage("Criteria saved.");
      router.refresh();
    } catch (cause) { setCriteriaMessage(cause instanceof Error ? cause.message : "Could not save criteria."); }
    finally { setSavingCriteria(false); }
  }

  if (searchRun) return <CompanyDiscoveryLoading mandateId={mandateId} startedJobId={searchRun.jobId} />;
  if (busy) return <div className="mx-auto my-[8vh] max-w-[620px]"><CompanySearchProgress detail={progress || undefined} /></div>;

  return <div className="mx-auto max-w-4xl space-y-5"><form onSubmit={event => { event.preventDefault(); void findCompanies(); }} className="mx-auto max-w-4xl space-y-5 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 sm:p-8">
    <label htmlFor="acquisition-description" className="block text-sm font-semibold">Describe the acquisition brief</label>
    <textarea id="acquisition-description" required minLength={10} maxLength={10000} rows={10} readOnly={busy} value={description} onChange={event => setDescription(event.target.value)} placeholder="Tell us about the businesses you’re looking to buy" className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--panel-raised)] p-4 text-sm text-[var(--foreground)]" />
    {error && <p role="alert" className="text-sm text-[var(--status-red)]">{error}</p>}
    {progress && <p role="status" className="text-sm text-[var(--muted)]">{progress}</p>}
    <div className="flex justify-end"><button disabled={busy || savingCriteria || description.trim().length < 10} className="min-h-12 rounded-lg bg-[var(--accent)] px-5 text-sm font-semibold text-[var(--on-accent)] disabled:opacity-50">{busy ? "Finding companies…" : "Find companies"}</button></div>
  </form>
    <p className="text-sm text-[var(--muted)]">Criteria extracted from your brief inform provisional fit. Review them to confirm requirements and preferences. Unspecified conditions remain unknown.</p>
    <BriefCriteria criteria={criteria} onChange={setCriteria} />
    <div className="flex items-center justify-end gap-3">{criteriaMessage && <p role="status" className="text-sm">{criteriaMessage}</p>}<button type="button" disabled={savingCriteria || JSON.stringify(criteria) === JSON.stringify(savedCriteria)} onClick={() => void saveCriteria()} className="min-h-12 rounded-lg border border-[var(--border)] px-5 text-sm disabled:opacity-50">{savingCriteria ? "Saving…" : "Save criteria"}</button></div>
  </div>;
}
