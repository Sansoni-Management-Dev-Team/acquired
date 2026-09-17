"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { dialogBackdrop } from "./dialog-backdrop";
import {
  terminalResearchStates,
  groupResearchFindings,
  researchDomain,
  continueResearchConfig,
  type ResearchConfig,
  type SavedResearchFinding,
} from "@/domain/research";
import { ResearchRunOutcome } from "./research-run-outcome";
import { GeographySelect } from "./geography-select";
import type { AcquisitionBrief } from "@/domain/acquisition";
import { researchEfforts } from "@/domain/adaptive-discovery";
const input =
  "min-h-12 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-2 text-sm";
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
type Data = { results?: { jobId: string; businessDomains?: string[]; added: number; updated: number; people: number }[]; enabled: boolean; jobs: ResearchJob[]; peopleJobs?: ResearchJob[]; companyJobs?: ResearchJob[]; findings: SavedResearchFinding[] };
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
}: {
  mandateId: string;
  brief: AcquisitionBrief;
  onResultsChanged: () => void;
}) {
  const [data, setData] = useState<Data>({
    enabled: false,
    jobs: [],
    findings: [],
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [setup, setSetup] = useState(false);
  const [scope, setScope] = useState(brief.criteria.find(c => c.key === "subsectors")?.value || "");
  const [terms, setTerms] = useState("");
  const [effort, setEffort] = useState<keyof typeof researchEfforts>("standard");
  const [geography, setGeography] = useState(
    brief.criteria.find((c) => c.key === "geography")?.state === "unrestricted"
      ? "National"
      : brief.criteria.find((c) => c.key === "geography")?.value || "",
  );
  const [seeds, setSeeds] = useState(""),
    [discover, setDiscover] = useState(true),
    [continuation, setContinuation] = useState<ResearchJob | null>(null);
  const [targetBusinesses, setTargetBusinesses] = useState<number | "">(20);
  const targetValid = Number.isInteger(targetBusinesses) && Number(targetBusinesses) >= 1 && Number(targetBusinesses) <= 100;
  const backdropPressed = useRef(false);
  const [findPeople, setFindPeople] = useState(true);
  const changedRef = useRef(onResultsChanged);
  useEffect(() => { changedRef.current = onResultsChanged; }, [onResultsChanged]);
  const signatureRef = useRef("");
  const setupRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (setup && setupRef.current && !setupRef.current.open) setupRef.current.showModal(); }, [setup]);
  const refresh = useCallback(async () => {
    try {
      const next: Data = await request(`/api/mandates/${mandateId}/research`);
      setData(next);
      const signature = JSON.stringify([next.jobs.map(j => [j.id, j.status, j.pages, j.message, j.config.newBusinessIds]), next.peopleJobs?.map(j => [j.id, j.status, j.pages]), next.companyJobs?.map(j => [j.id, j.status, j.pages]), next.findings.map(f => [f.id, f.targetId]), next.results]);
      if (signatureRef.current && signature !== signatureRef.current) changedRef.current();
      signatureRef.current = signature;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [mandateId]);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);
  const active = [...data.jobs, ...(data.peopleJobs || []), ...(data.companyJobs || [])].find(
    (j) => !terminalResearchStates.includes(j.status),
  );
  const currentJob = data.jobs.find(j => !terminalResearchStates.includes(j.status)) || active || data.jobs[0];
  const runId = currentJob?.config.researchRunId || currentJob?.id;
  const inRun = (j: ResearchJob) => j.id === runId || j.config.researchRunId === runId || j.config.parentJobId === runId;
  const relatedPeople = (data.peopleJobs || []).filter(inRun);
  const relatedCompanies = (data.companyJobs || []).filter(inRun);
  const runJobs = [...data.jobs, ...relatedPeople, ...relatedCompanies].filter(inRun);
  const discoveryJobs = runJobs.filter(j => !j.config.purpose && !j.config.discoveryCandidate);
  const searchHistory = discoveryJobs.reduce<NonNullable<ResearchConfig["discoveryAttempts"]>>((history, j) => (j.config.discoveryAttempts?.length || 0) > history.length ? j.config.discoveryAttempts! : history, []);
  const searchStopReason = discoveryJobs.find(j => j.config.discoveryStopReason)?.config.discoveryStopReason;
  const enriching = [...relatedPeople, ...relatedCompanies].filter(j => !terminalResearchStates.includes(j.status));
  const finishedEnrichment = [...relatedPeople, ...relatedCompanies].filter(j => terminalResearchStates.includes(j.status));
  const searchLeadCount = new Set(relatedPeople.flatMap(j => (j.config.peopleSearchLeads || []).map(l => `${j.config.targetId}:${l.url}`))).size;
  const peopleFound = (data.results || []).filter(r => runJobs.some(j => j.id === r.jobId)).reduce((sum, r) => sum + r.people, 0);
  const identifiedBusinessCount = new Set((data.results || []).filter(r => runJobs.some(j => j.id === r.jobId)).flatMap(r => r.businessDomains || [])).size;
  const newBusinessCount = new Set(runJobs.flatMap(j => j.config.newBusinessIds || [])).size;
  const activeBusinessCount = new Set(runJobs.filter(j => !terminalResearchStates.includes(j.status)).flatMap(j => j.config.companyDomain || j.config.targetId ? [j.config.companyDomain || j.config.targetId] : [])).size;
  const queuedUrlCount = new Set(runJobs.filter(j => !terminalResearchStates.includes(j.status) && !j.config.parallelDiscovery).flatMap(j => j.config.runtime?.remaining || j.seeds)).size;
  const waitingJobs = runJobs.filter(j => !terminalResearchStates.includes(j.status) && /Waiting for (?:browser|AI) slot/.test(j.message)).length;
  const runPages = runJobs.reduce((sum, j) => sum + j.pages, 0);
  const termList = terms
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
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
  async function act(body: unknown, jobId?: string) {
    setBusy(true);
    setError("");
    try {
      await request(
        jobId
          ? `/api/research/${jobId}`
          : `/api/mandates/${mandateId}/research`,
        body,
      );
      await refresh();
      onResultsChanged();
      setSetup(false);
      setContinuation(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function resume(job: ResearchJob) {
    setContinuation(job);
    setTargetBusinesses(job.config.targetBusinesses || 20);
    setTerms(job.config.searchTerms.join("\n"));
    setScope(job.config.researchScope || job.config.searchTerms.join("; "));
    setEffort(job.config.researchEffort || "standard");
    setGeography(job.config.geography);
    setSeeds(remainingFor(job).slice(0, 10).join("\n"));
    setDiscover(false);
    setFindPeople(Boolean(job.config.findPeople));
    setSetup(true);
  }
  function retryFailed(job: ResearchJob) {
    setContinuation(null);
    setTerms(job.config.searchTerms.join("\n"));
    setScope(job.config.researchScope || job.config.searchTerms.join("; "));
    setEffort(job.config.researchEffort || "standard");
    setGeography(job.config.geography);
    setSeeds((job.config.runtime?.attempts || []).filter(a => a.status === "failed" || /extraction failed/i.test(a.reason)).map(a => a.finalUrl || a.url).slice(0, 10).join("\n"));
    setDiscover(false);
    setSetup(true);
  }
  return (
    <section className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      {loading ? (
        <p role="status">Checking research service…</p>
      ) : !data.enabled ? (
        <p>Website research is awaiting activation.</p>
      ) : (
        <>
          {(!active || setup) && (
            <>
              <button
                className={button}
                onClick={() => {
                  setSetup(!setup);
                  setContinuation(null);
                }}
              >
                {setup ? "Close setup" : "Find & research businesses"}
              </button>
              {setup && (
                <dialog ref={setupRef} onPointerDown={event => dialogBackdrop(backdropPressed, () => setSetup(false)).onPointerDown(event)} onPointerCancel={() => { backdropPressed.current = false; }} onClick={event => dialogBackdrop(backdropPressed, () => setSetup(false)).onClick(event)} onCancel={() => setSetup(false)} onClose={() => setSetup(false)} aria-labelledby="research-setup-title" className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-xl overflow-y-auto border-l border-[var(--border)] bg-[var(--panel)] p-6 text-[var(--foreground)] backdrop:bg-black/70">
                  <div className="sticky -top-6 z-10 -mx-6 -mt-6 mb-5 flex items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--panel)] p-6"><h2 id="research-setup-title" className="text-xl font-semibold">{continuation ? "Continue research" : "Find & research businesses"}</h2><button className={button} onClick={() => setSetup(false)} aria-label="Close research settings">Close</button></div>
                  <div className="space-y-4">
                  {continuation && (
                    <p className="font-medium">
                      Continue {remainingFor(continuation).length} saved URLs
                      automatically. Completed pages are skipped.
                    </p>
                  )}
                  <label className="block space-y-2 text-sm">
                    <span className="font-semibold">Target new businesses</span>
                    <input className={input} type="number" min="1" max="100" step="1" value={targetBusinesses} disabled={Boolean(continuation)} aria-describedby="business-target-help" aria-invalid={!targetValid} onChange={e => setTargetBusinesses(e.target.value === "" ? "" : Number(e.target.value))} />
                    <span id="business-target-help" className="block text-xs text-[var(--muted)]">Aim for this many new, distinct businesses. Existing targets and duplicates don’t count. Research continues automatically through available sources; duplicates do not use up your target.</span>
                    {!targetValid && <span role="alert" className="block text-sm text-[var(--status-amber)]">Enter a whole number from 1 to 100.</span>}
                  </label>
                  <label className="block space-y-2 text-sm">
                    <span>Research scope</span>
                    <textarea className={input} rows={3} maxLength={960} disabled={Boolean(continuation)} value={scope} onChange={e => setScope(e.target.value)} aria-describedby="research-scope-help" />
                    <span id="research-scope-help" className="block text-xs text-[var(--muted)]">Describe the businesses and services to find. AI generates searches and adapts them as it learns. Financial fit and sale intentions are assessed separately when evidence is available.</span>
                  </label>
                  <GeographySelect className={input} disabled={Boolean(continuation)} value={geography} onChange={setGeography} />
                  <label className="block space-y-2 text-sm">
                    <span>Research budget</span>
                    <select className={input} value={effort} disabled={Boolean(continuation)} onChange={e => setEffort(e.target.value as keyof typeof researchEfforts)}>
                      <option value="focused">Focused · up to 12 discovery searches / 30 minutes</option>
                      <option value="standard">Standard · up to 24 discovery searches / 60 minutes</option>
                      <option value="thorough">Thorough · up to 48 discovery searches / 120 minutes</option>
                    </select>
                    <span className="block text-xs text-[var(--muted)]">Limits search effort and run duration. Company and owner follow-ups have separate bounded searches. Provider charges vary; this is not a monetary spending cap.</span>
                  </label>
                  <details className="rounded-lg border border-[var(--border)] p-3">
                    <summary className="min-h-12 cursor-pointer content-center text-sm font-medium">Advanced search settings</summary>
                    <div className="space-y-4 pt-3">
                      <label className="block text-sm">Starting search terms (optional, up to six; one per line)
                        <textarea className={input} rows={3} disabled={Boolean(continuation)} value={terms} onChange={e => setTerms(e.target.value)} />
                      </label>
                      {(termList.length > 6 || termList.some(t => t.length < 2 || t.length > 160)) && <p role="alert" className="text-xs text-[var(--status-amber)]">Use up to six starting terms, each between 2 and 160 characters.</p>}
                      <p className="text-xs text-[var(--muted)]">These are hints. The agent can generate different queries within your research scope.</p>
                  {!continuation && (
                    <>
                      <label className="block text-sm">
                        Starting websites (optional, one URL per line)
                        <textarea
                          className={input}
                          rows={3}
                          value={seeds}
                          onChange={(e) => {
                            setSeeds(e.target.value);
                          }}
                        />
                      </label>
                      <label className="flex min-h-12 items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={discover}
                          onChange={(e) => {
                            setDiscover(e.target.checked);
                          }}
                        />
                        Find websites using directories, Google Places and web search
                      </label>
                    </>
                  )}
                  {discover && !continuation && <p className="text-sm text-[var(--muted)]">Directories and maps provide initial leads. Web searches adapt to results, duplicates and candidate research. You can review attempted queries and their rationale during the run.</p>}
                    </div>
                  </details>
                  <label className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" checked={findPeople} onChange={e => setFindPeople(e.target.checked)} />Find owners and decision-makers</label>
                  <p className="text-sm text-[var(--muted)]">Company details are researched automatically. Unsupported facts stay unknown.</p>
                  <div className="sticky -bottom-6 -mx-6 border-t border-[var(--border)] bg-[var(--panel)] p-6 space-y-3">
                  <p className="text-sm text-[var(--muted)]">
                    Research runs until the target or a safety limit is reached. Stop at any time. Provider charges may apply.
                  </p>
                  <p className="text-xs text-[var(--muted)]">Starting research shares this public research scope, generated queries, URLs and page content with the research providers. Keep confidential buyer details out of the search settings.</p>
                  <button
                    className={`${button} w-full bg-[var(--accent)] font-semibold text-[var(--on-accent)]`}
                    disabled={busy || !targetValid || scope.trim().length < 2 || termList.length > 6 || termList.some(t => t.length < 2 || t.length > 160) || geography.trim().length < 2}
                    onClick={() =>
                      act({
                        requestId: crypto.randomUUID(),
                        workflow: "business",
                        targetBusinesses,
                        mode: "automatic",
                        companyBudget: { maxCompanies: 2, maxPages: 3 },
                        findPeople,
                        peopleSearchesPerCompany: 2,
                        ...(findPeople ? { peopleBudget: { maxCompanies: Number(targetBusinesses), maxPages: 12 } } : {}),
                        ...(continuation
                          ? { continueFrom: continuation.id }
                          : {}),
                        seeds: seeds
                          .split("\n")
                          .map((s) => s.trim())
                          .filter(Boolean),
                        searchTerms: termList,
                        researchScope: scope.trim(),
                        researchEffort: effort,
                        geography,
                        approved: true,
                        discover,
                        budget,
                        strategy: "discover",
                      })
                    }
                  >
                    {continuation ? "Continue research" : "Find & research businesses"}
                  </button>
                  </div>
                  </div>
                </dialog>
              )}
            </>
          )}
          {currentJob && <div className="space-y-3" role="status">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">{!terminalResearchStates.includes(currentJob.status) ? (currentJob.config.purpose === "firmographics" ? "Researching company details" : currentJob.config.purpose === "people" ? "Finding decision-makers" : currentJob.status === "discovering" ? "Finding businesses" : "Researching businesses") : currentJob.status === "cancelled" ? "Research cancelled" : enriching.length ? "Enriching businesses" : currentJob.status === "failed" ? "Research failed" : currentJob.status === "complete" ? "Research complete" : "Research paused"}</h2>
              <span className="text-xs text-[var(--muted)]">{new Date(currentJob.createdAt).toLocaleString()}</span>
            </div>
            <ResearchProgress job={currentJob} count={newBusinessCount} identified={identifiedBusinessCount} active={Boolean(active)} enriching={enriching.length} />
            {!currentJob.config.purpose && !terminalResearchStates.includes(currentJob.status) && <p className="text-sm text-[var(--muted)]">{currentJob.status === "discovering" ? "Searching for candidate websites…" : "Reading candidate websites and checking business details…"} The count increases as new businesses are saved to Targets.</p>}
            <ResearchRunOutcome status={currentJob.status} remaining={remainingFor(currentJob).length} active={Boolean(active)} canResume={!currentJob.config.purpose} busy={busy} onResume={() => resume(currentJob)} />
            <details className="text-sm text-[var(--muted)]"><summary className="min-h-12 cursor-pointer content-center">Details</summary>
              <p>{activeBusinessCount} businesses in progress · {waitingJobs} jobs waiting for a provider slot · {enriching.length} enrichment jobs running · {finishedEnrichment.length} finished · {peopleFound} contact leads{searchLeadCount ? ` · ${searchLeadCount} leads to verify` : ""}</p>
              <p>{runPages} pages read · {queuedUrlCount} URLs queued</p><p className="mt-2 break-words">{currentJob.message === "Discovery complete" ? "Website search finished; researching candidate businesses" : currentJob.message}</p>
            </details>
            {searchHistory.length > 0 && <details className="rounded-lg border border-[var(--border)] p-3 text-sm">
              <summary className="min-h-12 cursor-pointer content-center">Search activity · {searchHistory.length} attempts</summary>
              <ol className="space-y-3 pt-2">{searchHistory.map((attempt, i) => <li key={`${i}:${attempt.query}`}>
                <p className="font-medium">{attempt.query}</p>
                {attempt.reason && <p className="text-[var(--muted)]">{attempt.reason}</p>}
                <p className="text-xs text-[var(--muted)]">{attempt.status === "failed" ? "Search failed; a retry may follow" : `${attempt.resultCount ?? "—"} results · ${attempt.newDomains ?? "—"} new candidate domains`}</p>
              </li>)}</ol>
              {searchStopReason && <p className="mt-3 text-[var(--muted)]">{searchStopReason}</p>}
            </details>}
            {!active && !currentJob.config.purpose && currentJob.config.runtime?.attempts.some(a => a.status === "failed" || /extraction failed/i.test(a.reason)) && <button className={button} disabled={busy} onClick={() => retryFailed(currentJob)}>Retry failed pages</button>}
            {active && <button className={button} disabled={busy} onClick={() => act({action:"cancel"}, active.id)}>Stop research</button>}
            {active?.status === "queued" && <button className={button} disabled={busy} onClick={() => act({action:"retry-dispatch"}, active.id)}>Reconnect job</button>}
            {[...data.jobs, ...(data.peopleJobs || []), ...(data.companyJobs || [])].filter(job => job.id !== active?.id && !terminalResearchStates.includes(job.status)).map(job => <ActiveResearchJob key={job.id} job={job} busy={busy} onCancel={() => act({action:"cancel"}, job.id)} onRetry={() => act({action:"retry-dispatch"}, job.id)} />)}
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
            {group.findings.some(f => f.targetId) && <p className="mt-3 text-sm">In Targets · {relevant ? "Ready to review" : "Needs more evidence"}</p>}
            {company && !group.findings.some((f) => f.targetId) && (
              <button
                className={`${button} mt-3`}
                disabled={Boolean(busy)}
                onClick={() => accept(company)}
              >
                {busy === company.id ? "Adding…" : "Add company to targets"}
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

function ResearchProgress({ job, count, identified, active, enriching }: { job: ResearchJob; count: number; identified: number; active: boolean; enriching: number }) {
  const goal = !job.config.purpose && job.config.targetBusinesses;
  const discovering = Boolean(goal && !terminalResearchStates.includes(job.status));
  const determinate = Boolean(goal && (discovering || !active));
  const label = !active && !determinate ? `Research ${job.status}` : determinate ? `${count} of ${goal} new businesses saved` : job.config.purpose === "people" ? "Finding decision-makers…" : enriching || job.config.purpose === "firmographics" ? "Researching company details…" : active ? "Researching businesses…" : `Research ${job.status}`;
  const percentage = determinate ? Math.min(100, Math.max(0, count / Number(goal) * 100)) : undefined;
  return <div className="space-y-2">{!job.config.purpose && <p className="text-sm font-medium" aria-live="polite">{identified} {identified === 1 ? "business" : "businesses"} identified <span className="font-normal text-[var(--muted)]">· includes existing businesses</span></p>}<p role="status" aria-live="polite" className="text-sm font-medium">{label}</p>{(active || determinate) && <div role="progressbar" aria-label={label} aria-valuemin={determinate ? 0 : undefined} aria-valuemax={determinate ? 100 : undefined} aria-valuenow={percentage} className="h-2 overflow-hidden rounded-full bg-[var(--panel-raised)]"><div className={`h-full rounded-full bg-[var(--accent)] ${determinate ? "transition-[width]" : "w-1/3 motion-safe:animate-pulse"}`} style={determinate ? { width: `${percentage}%` } : undefined} /></div>}</div>;
}
