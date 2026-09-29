"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useActivePolling } from "./use-active-polling";
import {
  terminalResearchStates,
  groupResearchFindings,
  researchDomain,
  continueResearchConfig,
  type ResearchConfig,
  type SavedResearchFinding,
} from "@/domain/research";
import { ResearchRunOutcome } from "./research-run-outcome";
import type { AcquisitionBrief } from "@/domain/acquisition";
import { candidateStatus } from "@/domain/target-candidates";
const button =
  "min-h-12 rounded-md border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-40";
export type ResearchJob = {
  id: string;
  status: string;
  pages: number;
  modelCalls: number;
  message: string;
  createdAt: string;
  config: ResearchConfig;
  seeds: string[];
};
export function candidatesArrivedForRun(jobs: ResearchJob[], startedJobId: string) {
  const root = jobs.find(job => job.id === startedJobId);
  if (!root) return false;
  const runId = root.config.researchRunId || root.id;
  return jobs.some(job =>
    (job.config.researchRunId === runId || job.config.parentJobId === startedJobId) &&
    (job.config.discoveryCandidate || (job.config.newBusinessIds?.length || 0) > 0),
  );
}
export type ResearchPanelData = { active?: boolean; results?: { jobId: string; businessDomains?: string[]; added: number; updated: number; people: number }[]; enabled: boolean; jobs: ResearchJob[]; peopleJobs?: ResearchJob[]; companyJobs?: ResearchJob[]; findings: SavedResearchFinding[]; evidence?: Record<string, import("@/domain/evidence-status").EvidenceCounts> };
type Data = ResearchPanelData;
async function request(url: string, body?: unknown) {
  const r = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Research request failed");
  return j;
}
export function ResearchPanel({
  mandateId,
  brief,
  onResultsChanged,
  showStartAction = true,
  onCandidatesFound,
}: {
  mandateId: string;
  brief: AcquisitionBrief;
  onResultsChanged: (data: ResearchPanelData, changed: boolean) => void;
  showStartAction?: boolean;
  onCandidatesFound?: () => void;
}) {
  const [data, setData] = useState<Data>({
    enabled: false,
    jobs: [],
    findings: [],
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const startedJobId = useRef<string | null>(null);
  const changedRef = useRef(onResultsChanged);
  useEffect(() => { changedRef.current = onResultsChanged; }, [onResultsChanged]);
  const signatureRef = useRef("");
  const refresh = useCallback(async () => {
    try {
      const next: Data = await request(`/api/mandates/${mandateId}/research`);
      setData(next);
      const signature = JSON.stringify([next.jobs.map(j => [j.id, j.status, j.pages, j.message, j.config.newBusinessIds]), next.peopleJobs?.map(j => [j.id, j.status, j.pages]), next.companyJobs?.map(j => [j.id, j.status, j.pages]), next.findings.map(f => [f.id, f.targetId]), next.results]);
      changedRef.current(next, Boolean(signatureRef.current && signature !== signatureRef.current));
      signatureRef.current = signature;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [mandateId]);
  useActivePolling(refresh, { active: Boolean(data.active), intervalMs: 5000 });
  const active = [...data.jobs, ...(data.peopleJobs || []), ...(data.companyJobs || [])].find(
    (j) => !terminalResearchStates.includes(j.status),
  );
  const currentJob = data.jobs.find(j => !terminalResearchStates.includes(j.status)) || active || data.jobs[0];
  const runId = currentJob?.config.researchRunId || currentJob?.id;
  const inRun = (j: ResearchJob) => j.id === runId || j.config.researchRunId === runId || j.config.parentJobId === runId;
  const relatedPeople = (data.peopleJobs || []).filter(inRun);
  const relatedCompanies = (data.companyJobs || []).filter(inRun);
  const runJobs = [...data.jobs, ...relatedPeople, ...relatedCompanies].filter(inRun);
  const candidateJobs = runJobs.filter(j => j.config.discoveryCandidate);
  useEffect(() => {
    if (!startedJobId.current || !onCandidatesFound) return;
    if (candidatesArrivedForRun(data.jobs, startedJobId.current)) {
      startedJobId.current = null;
      onCandidatesFound();
    }
  }, [data.jobs, onCandidatesFound]);
  const discoveryJobs = runJobs.filter(j => !j.config.purpose && !j.config.discoveryCandidate);
  const searchHistory = discoveryJobs.reduce<NonNullable<ResearchConfig["discoveryAttempts"]>>((history, j) => (j.config.discoveryAttempts?.length || 0) > history.length ? j.config.discoveryAttempts! : history, []);
  const searchStopReason = discoveryJobs.find(j => j.config.discoveryStopReason)?.config.discoveryStopReason;
  const enriching = [...relatedPeople, ...relatedCompanies].filter(j => !terminalResearchStates.includes(j.status));
  const identifiedBusinessCount = new Set((data.results || []).filter(r => runJobs.some(j => j.id === r.jobId)).flatMap(r => r.businessDomains || [])).size;
  const newBusinessCount = new Set(runJobs.flatMap(j => j.config.newBusinessIds || [])).size;
  const finishedBelowGoal = currentJob?.status === "complete" && !active && Boolean(currentJob.config.targetBusinesses && newBusinessCount < currentJob.config.targetBusinesses);
  const budget = {
    maxPages: 5,
    maxDomains: 5,
    maxMinutes: 10,
    maxModelCalls: 5,
  };
  const remainingFor = (job: ResearchJob) =>
    continueResearchConfig(
      job.config,
      job.seeds || [],
      data.findings.filter((f) => f.jobId === job.id).map((f) => f.sourceUrl),
      budget,
      job.id,
    ).runtime!.remaining;
  async function act(body: unknown, jobId?: string, navigateOnCandidates = false) {
    setBusy(true);
    setError("");
    try {
      const result = await request(
        jobId
          ? `/api/research/${jobId}`
          : `/api/mandates/${mandateId}/research`,
        body,
      );
      if (navigateOnCandidates && result.jobId) startedJobId.current = result.jobId;
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function resume(job: ResearchJob) {
    void act({ ...job.config, requestId: crypto.randomUUID(), continueFrom: job.id, seeds: remainingFor(job).slice(0, 10), approved: true, budget });
  }
  function retryFailed(job: ResearchJob) {
    const seeds = (job.config.runtime?.attempts || []).filter(a => a.status === "failed" || /extraction failed/i.test(a.reason)).map(a => a.finalUrl || a.url).slice(0, 10);
    void act({ ...job.config, requestId: crypto.randomUUID(), seeds, approved: true, discover: false, budget });
  }
  if (!showStartAction && !loading && data.enabled && !currentJob) return null;
  return (
    <section className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      {loading ? (
        <p role="status">Checking research service…</p>
      ) : !data.enabled ? (
        <p>Website research is awaiting activation.</p>
      ) : (
        <>
          {!active && showStartAction && (
            <div className="space-y-2">
              <button className={button} disabled={busy || !brief.naturalLanguage.trim() && !brief.criteria.find(c => c.key === "subsectors")?.value.trim()} onClick={() => void act({ requestId: crypto.randomUUID(), fromBrief: true }, undefined, Boolean(onCandidatesFound))}>
                Find & research businesses
              </button>
              <p className="text-xs text-[var(--muted)]">AI uses the saved brief to plan searches. Research providers receive search terms, source URLs and public page content. Provider charges may apply.</p>
            </div>
          )}
          {currentJob && <div className="space-y-3" role="status">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">{!terminalResearchStates.includes(currentJob.status) ? (currentJob.config.purpose === "firmographics" ? "Researching company details" : currentJob.config.purpose === "people" ? "Finding decision-makers" : currentJob.status === "discovering" ? "Finding businesses" : "Researching businesses") : currentJob.status === "cancelled" ? "Research cancelled" : enriching.length ? "Enriching businesses" : currentJob.status === "failed" ? "Research failed" : finishedBelowGoal ? "Research finished" : currentJob.status === "complete" ? "Research complete" : "Research paused"}</h2>
              {finishedBelowGoal && <span className="rounded-full bg-[var(--panel-raised)] px-2.5 py-1 text-xs font-medium text-[var(--status-amber)]">Below goal</span>}
            </div>
            <ResearchProgress job={currentJob} count={newBusinessCount} identified={identifiedBusinessCount} active={Boolean(active)} enriching={enriching.length} />
            {currentJob.config.mode === "automatic" && <DiscoveryCandidateList jobs={candidateJobs} searching={Boolean(active)} />}
            {!currentJob.config.purpose && !terminalResearchStates.includes(currentJob.status) && <p className="text-sm text-[var(--muted)]">{currentJob.status === "discovering" ? "Finding websites…" : "Checking business details…"}</p>}
            {showStartAction && <ResearchRunOutcome showSummary={false} status={currentJob.status} remaining={remainingFor(currentJob).length} active={Boolean(active)} canResume={!currentJob.config.purpose} busy={busy} onResume={() => resume(currentJob)} goal={currentJob.config.targetBusinesses} saved={newBusinessCount} />}
            {showStartAction && (currentJob.status === "failed" || currentJob.status === "partial" || currentJob.status === "cancelled") && currentJob.message && <p className="break-words text-sm text-[var(--muted)]">{currentJob.message}</p>}
            {showStartAction && searchHistory.length > 0 && <details className="rounded-lg border border-[var(--border)] p-3 text-sm">
              <summary className="min-h-12 cursor-pointer content-center">Search activity · {searchHistory.length} attempts</summary>
              <ol className="space-y-3 pt-2">{searchHistory.map((attempt, i) => <li key={`${i}:${attempt.query}`}>
                <p className="font-medium">{attempt.query}</p>
                {attempt.reason && <p className="text-[var(--muted)]">{attempt.reason}</p>}
                <p className="text-xs text-[var(--muted)]">{attempt.status === "failed" ? "Search failed; a retry may follow" : `${attempt.resultCount ?? "—"} results · ${attempt.newDomains ?? "—"} new candidate domains`}</p>
              </li>)}</ol>
              {searchStopReason && <p className="mt-3 text-[var(--muted)]">{searchStopReason}</p>}
            </details>}
            {showStartAction && !active && !currentJob.config.purpose && currentJob.config.runtime?.attempts.some(a => a.status === "failed" || /extraction failed/i.test(a.reason)) && <button className={button} disabled={busy} onClick={() => retryFailed(currentJob)}>Retry failed pages</button>}
            {showStartAction && active && <button className={button} disabled={busy} onClick={() => act({action:"cancel"}, active.id)}>Stop research</button>}
            {showStartAction && active?.status === "queued" && <button className={button} disabled={busy} onClick={() => act({action:"retry-dispatch"}, active.id)}>Reconnect job</button>}
            {(showStartAction ? [...data.jobs, ...(data.peopleJobs || []), ...(data.companyJobs || [])] : []).filter(job => job.id !== active?.id && !job.config.discoveryCandidate && !terminalResearchStates.includes(job.status)).map(job => <ActiveResearchJob key={job.id} job={job} busy={busy} onCancel={() => act({action:"cancel"}, job.id)} onRetry={() => act({action:"retry-dispatch"}, job.id)} />)}
          </div>}

        </>
      )}
      {busy && <p role="status" className="text-sm">Updating research…</p>}
      {error && (
        <p role="alert" className="text-sm text-[var(--status-red)]">
          {error}
        </p>
      )}
    </section>
  );
}

export function DiscoveryCandidateList({ jobs, searching }: { jobs: ResearchJob[]; searching: boolean }) {
  const seen = new Set<string>();
  const unique = jobs.filter(job => {
    const domain = (job.config.companyDomain || job.seeds[0] || job.id).replace(/^www\./, "").toLowerCase();
    if (seen.has(domain)) return false;
    seen.add(domain);
    return true;
  });
  const active = unique.filter(job => !terminalResearchStates.includes(job.status));
  const saved = unique.filter(job => (job.config.newBusinessIds?.length || 0) > 0).length;
  const reading = active.filter(job => ["crawling", "reading"].includes(job.status)).length;
  const extracting = active.filter(job => job.status === "extracting").length;
  const queued = active.filter(job => job.status === "queued").length;
  const visible = active.slice(0, 5);
  const stages = [
    queued > 0 && `${queued} queued`,
    reading > 0 && `${reading} reading`,
    extracting > 0 && `${extracting} extracting`,
  ].filter(Boolean).join(" · ");
  if (!searching && !active.length) return <details className="border-t border-[var(--border)] text-xs text-[var(--muted)]">
    <summary className="min-h-12 cursor-pointer content-center">Activity · {unique.length} websites found</summary>
    <p className="pb-2">{saved} saved · Results in Companies</p>
  </details>;
  return <section className="rounded-lg border border-[var(--border)] bg-[var(--panel-raised)] px-3 py-2 text-sm" aria-label="Research activity">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">Activity</h3>
      <p className="text-xs text-[var(--muted)]" aria-live="polite">{stages || "Finding websites…"}</p>
    </div>
    {visible.length > 0 && <ul className="mt-2 space-y-1">
      {visible.map(job => <li key={job.id} className="flex min-w-0 items-center justify-between gap-3 border-t border-[var(--border)] pt-1 text-xs">
        <span className="truncate">{job.config.companyDomain || job.seeds[0] || "Candidate website"}</span>
        <span className="shrink-0 text-[var(--muted)]">{candidateStatus(job.status, false)}</span>
      </li>)}
    </ul>}
    {active.length > visible.length && <p className="mt-1 text-xs text-[var(--muted)]">+{active.length - visible.length} more being checked</p>}
  </section>;
}
function ResearchFindings({
  findings,
  onChanged,
}: {
  findings: SavedResearchFinding[];
  onChanged: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  const groups = groupResearchFindings(findings);
  async function accept(f: SavedResearchFinding) {
    setBusy(f.id);
    setError("");
    try {
      await request(`/api/research/${f.jobId}`, {
        action: "accept",
        findingId: f.id,
      });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-4">
      <h3 className="font-semibold">
        Businesses and source evidence ({groups.length})
      </h3>
      {!groups.length && (
        <p className="text-sm text-[var(--muted)]">
          Business evidence will appear as pages are assessed. Reading a page
          does not guarantee supported findings.
        </p>
      )}
      {groups.map((group) => {
        const company = group.findings.find(
          (f) => f.evidence.kind === "company" && f.evidence.website,
        );
        const roles = group.claims.filter(
          (c) => c.finding.evidence.kind === "business_role",
        );
        const relevant = group.claims.some(
          (c) =>
            ["product", "capability", "customer"].includes(
              c.finding.evidence.kind,
            ) && c.finding.evidence.relevance === "relevant",
        );
        return (
          <article
            key={group.domain}
            className="rounded-lg border border-[var(--border)] p-4"
          >
            <h4 className="text-lg font-semibold">{group.name}</h4>
            <p className="break-all text-xs text-[var(--muted)]">
              {group.domain}
            </p>
            <p className="mt-2 text-sm">
              {roles.length
                ? roles.map((c) => c.finding.evidence.value).join(" · ")
                : "Business role unknown"}
            </p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {relevant
                ? "Potentially relevant product or service evidence — review required"
                : "Mandate fit not established"}{" "}
              · Financial fit unknown
            </p>
            <details className="mt-3">
              <summary className="cursor-pointer py-3 text-sm">
                {group.claims.length} distinct claims ·{" "}
                {new Set(group.findings.map((f) => f.sourceUrl)).size} source
                pages
              </summary>
              <div className="space-y-4">
                {group.claims.map(({ finding: f, sources }) => (
                  <div
                    key={f.id}
                    className="border-t border-[var(--border)] pt-3"
                  >
                    <p className="text-xs uppercase text-[var(--muted)]">
                      {f.evidence.kind.replaceAll("_", " ")} ·{" "}
                      {f.evidence.kind === "accreditation"
                        ? "Certification claim — unverified"
                        : f.evidence.kind === "identifier"
                          ? "Source-listed identifier — not registry verified"
                          : "Quoted source statement — not independently verified"}
                    </p>
                    <p className="mt-2 text-sm">{f.evidence.value}</p>
                    <blockquote className="mt-2 border-l border-[var(--border)] pl-3 text-sm text-[var(--muted)]">
                      {f.evidence.quote}
                    </blockquote>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {[
                        ...new Map(
                          sources.map((s) => [s.sourceUrl, s]),
                        ).values(),
                      ].map((s) => (
                        <a
                          key={s.sourceUrl}
                          className="text-xs underline"
                          href={s.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Source · {new Date(s.observedAt).toLocaleDateString()}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
            {group.excluded > 0 && (
              <p className="mt-2 text-xs text-[var(--muted)]">
                {group.excluded} earlier unsupported claims omitted from this
                assessment.
              </p>
            )}
            {group.findings.some(f => f.targetId) && <p className="mt-3 text-sm">In Companies · {relevant ? "Ready to review" : "Needs more evidence"}</p>}
            {company && !group.findings.some((f) => f.targetId) && (
              <button
                className={`${button} mt-3`}
                disabled={Boolean(busy)}
                onClick={() => accept(company)}
              >
                {busy === company.id ? "Adding…" : "Add company to mandate"}
              </button>
            )}
          </article>
        );
      })}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function TargetResearchEvidence({
  mandateId,
  targetId,
  domain,
}: {
  mandateId: string;
  targetId: string;
  domain: string;
}) {
  const [findings, setFindings] = useState<SavedResearchFinding[]>([]);
  useEffect(() => {
    let current = true;
    request(`/api/mandates/${mandateId}/research`)
      .then((data: Data) => {
        if (current)
          setFindings(
            data.findings.filter(
              (f) =>
                f.targetId === targetId ||
                researchDomain(f.sourceUrl) === domain,
            ),
          );
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [mandateId, targetId, domain]);
  if (!findings.length) return null;
  return <ResearchFindings findings={findings} onChanged={() => {}} />;
}

export function ActiveResearchJob({ job, busy, onCancel, onRetry }: { job: ResearchJob; busy: boolean; onCancel: () => void; onRetry: () => void }) {
  const foundUrl = job.seeds[0] || (job.config.companyDomain ? `https://${job.config.companyDomain}/` : "");
  const stage = job.config.purpose === "people"
    ? "Finding decision-makers"
    : job.config.purpose === "firmographics"
      ? "Researching company details"
      : job.config.discoveryCandidate
        ? "Researching candidate website"
        : "Company research";
  return <div className="flex flex-wrap items-center gap-3 text-sm">
    <div className="min-w-0 flex-1">
      {job.config.companyName && <p className="font-medium">{job.config.companyName}</p>}
      {foundUrl
        ? <a className="block break-all underline" href={foundUrl} target="_blank" rel="noreferrer">{foundUrl}</a>
        : <p className="font-medium">{job.config.companyDomain || job.config.targetId || "Research"}</p>}
      <p className="text-xs text-[var(--muted)]">{stage}</p>
    </div>
    <button className={button} disabled={busy} onClick={onCancel}>Stop research</button>
    {job.status === "queued" && <button className={button} disabled={busy} onClick={onRetry}>Reconnect job</button>}
  </div>;
}

export function ResearchProgress({ job, count, identified, active, enriching }: { job: ResearchJob; count: number; identified: number; active: boolean; enriching: number }) {
  const goal = !job.config.purpose && job.config.targetBusinesses;
  const discovering = Boolean(goal && !terminalResearchStates.includes(job.status));
  const determinate = Boolean(goal && (discovering || !active));
  const label = !active && !determinate ? `Research ${job.status}` : determinate ? `${count} of ${goal} new businesses saved` : job.config.purpose === "people" ? "Finding decision-makers…" : enriching || job.config.purpose === "firmographics" ? "Researching company details…" : active ? "Researching businesses…" : `Research ${job.status}`;
  const percentage = determinate ? Math.min(100, Math.max(0, count / Number(goal) * 100)) : undefined;
  return <div className="space-y-2">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <p role="status" aria-live="polite" className="text-sm font-medium">{label}</p>
      {determinate && <span className="text-xs tabular-nums text-[var(--muted)]">{Math.round(percentage!)}%</span>}
    </div>
    {(active || determinate) && <div role="progressbar" aria-label={label} aria-valuemin={determinate ? 0 : undefined} aria-valuemax={determinate ? 100 : undefined} aria-valuenow={percentage} className="h-1.5 overflow-hidden rounded-full bg-[var(--panel-raised)]">
      <div className={`h-full rounded-full bg-[var(--accent)] ${determinate ? "transition-[width]" : "w-1/3 motion-safe:animate-pulse"}`} style={determinate ? { width: `${percentage}%` } : undefined} />
    </div>}
    {!job.config.purpose && <p className="text-xs text-[var(--muted)]" title="Includes existing businesses" aria-label={`${identified} ${identified === 1 ? "business" : "businesses"} identified, including existing businesses`}>{identified} {identified === 1 ? "business" : "businesses"} identified</p>}
  </div>;
}
