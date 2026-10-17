"use client";

import { randomUuid } from "@/lib/random-uuid";


import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { contactEnrichmentProgress, type ContactEnrichmentRun } from "@/domain/contact-enrichment";
import { CompanySearchProgress } from "./company-search-progress";
import { jsonRequest, buttonClass } from "./mandate-workspace";
import { useActivePolling } from "./use-active-polling";

export function ContactEnrichmentProgress({ mandateId, targetIds, onBack }: { mandateId: string; targetIds: string[]; onBack: () => void }) {
  const router = useRouter();
  const started = useRef(false);
  const [runIds, setRunIds] = useState<string[]>([]);
  const [runs, setRuns] = useState<ContactEnrichmentRun[]>([]);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [queueFailed, setQueueFailed] = useState(false);
  const progress = contactEnrichmentProgress(runs, runIds);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void jsonRequest(`/api/mandates/${mandateId}`, { action: "enrich", targetIds, requestId: randomUuid() }).then(result => {
      const queued = result.refresh?.runs || [];
      setWarnings(result.warnings || []);
      if (!queued.length) throw new Error(result.warnings?.join(" ") || "No companies could be queued for enrichment.");
      setRunIds(queued.map((run: { id: string }) => run.id));
    }).catch(() => { setError("We couldn’t start finding contacts. Please try again later."); setQueueFailed(true); });
  }, [mandateId, targetIds]);
  const refresh = useCallback(async () => {
    if (!runIds.length) return;
    try {
      const workspace = await jsonRequest(`/api/mandates/${mandateId}?enrichmentRuns=${runIds.join(",")}`);
      setRuns(workspace.firmableRefreshes);
      setError("");
    } catch { setError("Could not update progress. Retrying automatically…"); }
  }, [mandateId, runIds]);
  useActivePolling(refresh, { active: runIds.length > 0 && !progress.finished, intervalMs: 5000, key: runIds.join(",") });
  useEffect(() => {
    if (!progress.finished || progress.failed) return;
    const timer = setTimeout(() => router.push(`/mandates/${mandateId}/people?enrichmentRuns=${runIds.join(",")}`), 700);
    return () => clearTimeout(timer);
  }, [progress.finished, progress.failed, mandateId, runIds, router]);
  const stopped = queueFailed || progress.failed;
  return <div className="mx-auto flex min-h-[70vh] w-full max-w-[620px] flex-col justify-center gap-4">
    <CompanySearchProgress label={stopped ? "ENRICHMENT STOPPED" : progress.finished ? "ENRICHMENT COMPLETE" : "ENRICHING"} title={stopped ? "Could not retrieve phone numbers" : progress.finished ? "Phone lookup finished" : "Finding phone numbers"} detail={progress.finished && !progress.failed ? `${progress.saved} phone number${progress.saved === 1 ? "" : "s"} saved. Opening your filtered people list…` : "Researching only the companies you selected."} stages={['Load saved contacts', 'Check phone availability', 'Retrieve phone numbers', 'Save phone numbers']} stage={progress.stage} complete={progress.finished && !progress.failed} running={!stopped && !progress.finished} />
    {error && <p role="alert" className="text-sm text-[var(--status-red)]">{error}</p>}
    {warnings.length > 0 && <p role="status" className="text-sm text-[var(--muted)]">{warnings.join(" ")}</p>}
    {progress.failed && <p role="alert" className="text-sm text-[var(--status-red)]">We couldn’t finish retrieving phone numbers. Please try again later.</p>}
    <button type="button" className={`${buttonClass} self-center`} onClick={onBack}>{stopped ? "Back to companies" : "Back to companies · enrichment continues"}</button>
  </div>;
}
