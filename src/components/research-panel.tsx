"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  terminalResearchStates,
  groupResearchFindings,
  researchDomain,
  researchQueries,
  continueResearchConfig,
  type ResearchConfig,
  type SavedResearchFinding,
} from "@/domain/research";
import { GeographySelect } from "./geography-select";
import type { AcquisitionBrief } from "@/domain/acquisition";
const input =
  "min-h-12 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-2 text-sm";
const button =
  "min-h-12 rounded-md border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-40";
type Job = {
  id: string;
  status: string;
  pages: number;
  modelCalls: number;
  message: string;
  createdAt: string;
  config: ResearchConfig;
  seeds: string[];
};
type Data = { results?: { jobId: string; added: number; updated: number; people: number }[]; enabled: boolean; jobs: Job[]; peopleJobs?: Job[]; companyJobs?: Job[]; findings: SavedResearchFinding[] };
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
  historyContent,
}: {
  mandateId: string;
  brief: AcquisitionBrief;
  onResultsChanged: () => void;
  historyContent?: ReactNode;
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
  const [terms, setTerms] = useState(
    brief.criteria
      .find((c) => c.key === "subsectors")
      ?.value.split(";")
      .slice(0, 3)
      .map((s) => s.trim().slice(0, 160))
      .join("\n") || "",
  );
  const [geography, setGeography] = useState(
    brief.criteria.find((c) => c.key === "geography")?.state === "unrestricted"
      ? "National"
      : brief.criteria.find((c) => c.key === "geography")?.value || "",
  );
  const [seeds, setSeeds] = useState(""),
    [discover, setDiscover] = useState(true),
    [continuation, setContinuation] = useState<Job | null>(null);
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
      const signature = JSON.stringify([next.jobs.map(j => [j.id, j.status, j.pages, j.message]), next.peopleJobs?.map(j => [j.id, j.status, j.pages]), next.companyJobs?.map(j => [j.id, j.status, j.pages]), next.findings.map(f => [f.id, f.targetId])]);
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
  const currentJob = data.jobs.find(j => !terminalResearchStates.includes(j.status)) || data.jobs[0];
  const runId = currentJob?.config.researchRunId || currentJob?.id;
  const inRun = (j: Job) => j.id === runId || j.config.researchRunId === runId || j.config.parentJobId === runId;
  const relatedPeople = (data.peopleJobs || []).filter(inRun);
  const relatedCompanies = (data.companyJobs || []).filter(inRun);
  const runJobs = [...data.jobs, ...relatedPeople, ...relatedCompanies].filter(inRun);
  const enriching = [...relatedPeople, ...relatedCompanies].filter(j => !terminalResearchStates.includes(j.status));
  const finishedEnrichment = [...relatedPeople, ...relatedCompanies].filter(j => terminalResearchStates.includes(j.status));
  const searchLeadCount = new Set(relatedPeople.flatMap(j => (j.config.peopleSearchLeads || []).map(l => `${j.config.targetId}:${l.url}`))).size;
  const peopleFound = (data.results || []).filter(r => runJobs.some(j => j.id === r.jobId)).reduce((sum, r) => sum + r.people, 0);
  const newBusinessCount = new Set(runJobs.flatMap(j => j.config.newBusinessIds || [])).size;
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
  const remainingFor = (job: Job) =>
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
  function resume(job: Job) {
    setContinuation(job);
    setTargetBusinesses(job.config.targetBusinesses || 20);
    setTerms(job.config.searchTerms.join("\n"));
    setGeography(job.config.geography);
    setSeeds(remainingFor(job).slice(0, 10).join("\n"));
    setDiscover(false);
    setFindPeople(Boolean(job.config.findPeople));
    setSetup(true);
  }
  function retryFailed(job: Job) {
    setContinuation(null);
    setTerms(job.config.searchTerms.join("\n"));
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
        <div className="space-y-3"><p>Website research is awaiting activation.</p><details><summary className="cursor-pointer py-2">Sources &amp; research history</summary>{historyContent}</details></div>
      ) : (
        <>
          {!active && (
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
                <dialog ref={setupRef} onPointerDown={e => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  backdropPressed.current = e.target === e.currentTarget && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom);
                }} onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (backdropPressed.current && e.target === e.currentTarget && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) setSetup(false);
                  backdropPressed.current = false;
                }} onCancel={() => setSetup(false)} onClose={() => setSetup(false)} aria-labelledby="research-setup-title" className="fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-dvh w-full max-w-xl overflow-y-auto border-l border-[var(--border)] bg-[var(--panel)] p-6 text-white backdrop:bg-black/70">
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
                    {!targetValid && <span role="alert" className="block text-sm text-amber-200">Enter a whole number from 1 to 100.</span>}
                  </label>
                  <label className="block text-sm">
                    Public research terms (up to three)
                    <textarea
                      className={input}
                      rows={3}
                      disabled={Boolean(continuation)}
                      value={terms}
                      onChange={(e) => {
                        setTerms(e.target.value);
                      }}
                    />
                  </label>
                  <GeographySelect className={input} disabled={Boolean(continuation)} value={geography} onChange={setGeography} />
                  <details className="rounded-lg border border-[var(--border)] p-3">
                    <summary className="min-h-12 cursor-pointer content-center text-sm font-medium">Search sources & focused queries</summary>
                    <div className="space-y-4 pt-3">
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
                  {discover && !continuation && <p className="text-sm text-[var(--muted)]">Discovery uses the directory index, up to 12 Google Places searches (20 results each), and up to 3 web searches. Discovered links are researched automatically; results are not exhaustive.</p>}
                  {discover && !continuation && (
                    <details>
                      <summary className="cursor-pointer py-2 text-sm">
                        Preview focused searches (
                        {researchQueries(termList).length})
                      </summary>
                      <ul className="list-disc space-y-1 pl-5 text-sm">
                        {researchQueries(termList).map((q) => (
                          <li key={q}>
                            {q} ·{" "}
                            {/^national$/i.test(geography)
                              ? "Australia"
                              : geography}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                    </div>
                  </details>
                  <label className="flex min-h-12 items-center gap-3 text-sm"><input type="checkbox" checked={findPeople} onChange={e => setFindPeople(e.target.checked)} />Find owners and decision-makers</label>
                  <p className="text-sm text-[var(--muted)]">Company details are researched automatically as businesses are found. Missing facts trigger follow-up research; unsupported details stay marked unknown.</p>
                  <div className="sticky -bottom-6 -mx-6 border-t border-[var(--border)] bg-[var(--panel)] p-6 space-y-3">
                  <p className="text-sm text-[var(--muted)]">
                    Research continues towards your target, with company enrichment running alongside discovery. You can stop at any time. The run ends when the target is reached, useful sources are exhausted, or the automatic safety limit is reached. Usage may incur charges.
                  </p>
                  <p className="text-xs text-[var(--muted)]">Starting research shares these search terms, URLs and page content with the research providers. Keep confidential buyer details out of the search settings.</p>
                  <button
                    className={`${button} w-full bg-white font-semibold text-black`}
                    disabled={busy || !targetValid || !termList.length || geography.trim().length < 2}
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
              <h2 className="font-semibold">{!terminalResearchStates.includes(currentJob.status) ? (currentJob.config.purpose === "firmographics" ? "Researching company details" : currentJob.config.purpose === "people" ? "Finding decision-makers" : currentJob.status === "discovering" ? "Finding businesses" : "Researching businesses") : currentJob.status === "cancelled" ? "Research cancelled" : enriching.length ? "Enriching businesses" : "Latest research run"}</h2>
              <span className="text-xs text-[var(--muted)]">{new Date(currentJob.createdAt).toLocaleString()}</span>
            </div>
            {currentJob.config.targetBusinesses && <p className="text-sm font-medium" aria-live="polite">{newBusinessCount} of {currentJob.config.targetBusinesses} new businesses found</p>}
            <p className="text-sm">{currentJob.config.purpose ? currentJob.config.companyName : `${enriching.length} enrichment jobs running · ${finishedEnrichment.length} finished`} · {peopleFound} sourced contact leads{searchLeadCount ? ` · ${searchLeadCount} search leads to verify` : ""}</p>
            <p className="text-sm">{runPages} pages read across this run · {currentJob.config.runtime?.remaining.length || 0} URLs remaining</p>

            <p className="text-sm text-[var(--muted)]">{currentJob.message}</p>
            {!active && terminalResearchStates.includes(currentJob.status) && Boolean(currentJob.config.runtime?.remaining.length) && <p className="text-sm">This run has stopped; the remaining websites have not all been researched.</p>}
            {!active && !currentJob.config.purpose && remainingFor(currentJob).length > 0 && <button className={button} disabled={busy} onClick={() => resume(currentJob)}>Continue research</button>}
            {!active && !currentJob.config.purpose && currentJob.config.runtime?.attempts.some(a => a.status === "failed" || /extraction failed/i.test(a.reason)) && <button className={button} disabled={busy} onClick={() => retryFailed(currentJob)}>Retry failed pages</button>}
            {active && <button className={button} disabled={busy} onClick={() => act({action:"cancel"}, active.id)}>Stop research</button>}
            {active?.status === "queued" && <button className={button} disabled={busy} onClick={() => act({action:"retry-dispatch"}, active.id)}>Reconnect job</button>}
          </div>}
          <details className="border-t border-[var(--border)] pt-3">
            <summary className="cursor-pointer py-2 text-sm font-medium">Sources &amp; research history</summary>
            <div className="mt-4 space-y-5">
          <div className="space-y-3" aria-live="polite">
            {data.jobs.slice(0, 5).map((job) => {
              const runtime = job.config.runtime;
              const websites = new Set(
                (runtime?.attempts || [])
                  .filter((a) => a.status === "read")
                  .map((a) => researchDomain(a.finalUrl || a.url)),
              ).size;
              const finished = terminalResearchStates.includes(job.status);
              const remaining = remainingFor(job);
              return (
                <article
                  key={job.id}
                  className="rounded-lg border border-[var(--border)] p-4"
                >
                  <div className="flex flex-wrap justify-between gap-3">
                    <strong className="capitalize">
                      {job.status === "partial"
                        ? "Finished with remaining work"
                        : job.status}
                    </strong>
                    <span className="text-xs text-[var(--muted)]">
                      {runtime
                        ? `${websites} websites read · ${runtime.attempts.length}/${job.config.budget.maxPages} attempts`
                        : `${job.pages} pages read`}{" "}
                      · {job.modelCalls}/{job.config.budget.maxModelCalls} AI
                      calls
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {job.message}
                  </p>
                  {finished && job.config.workflow === "business" && job.config.findPeople && job.status !== "cancelled" && !active && <button className={`${button} mt-3`} disabled={busy} onClick={() => act({action:"resume-people"}, job.id)}>Check remaining people research</button>}
                  {runtime ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer py-2 text-sm">
                        Page details · {runtime.remaining.length} URLs remaining
                      </summary>
                      <ul className="space-y-3 text-sm">
                        {runtime.attempts.map((a) => (
                          <li key={a.url}>
                            <a
                              className="break-all underline"
                              href={a.finalUrl || a.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {a.url}
                            </a>
                            <p>
                              {a.status} · {a.reason}
                            </p>
                          </li>
                        ))}
                      </ul>
                      {runtime.remaining.length > 0 && (
                        <details className="mt-3">
                          <summary className="cursor-pointer py-2">
                            Remaining websites and pages
                          </summary>
                          <ul className="space-y-2 text-xs">
                            {runtime.remaining.map((url) => (
                              <li key={url} className="break-all">
                                {url}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </details>
                  ) : (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Earlier run: full page history was not recorded.
                      Continuing skips pages with saved findings.
                    </p>
                  )}
                  {!finished ? (
                    <div className="mt-3 flex gap-3">
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() => act({ action: "cancel" }, job.id)}
                      >
                        Cancel research
                      </button>
                      {job.status === "queued" && (
                        <button
                          className={button}
                          disabled={busy}
                          onClick={() =>
                            act({ action: "retry-dispatch" }, job.id)
                          }
                        >
                          Reconnect job
                        </button>
                      )}
                    </div>
                  ) : (
                    remaining.length > 0 &&
                    !active && (
                      <button
                        className={`${button} mt-3`}
                        disabled={busy}
                        onClick={() => resume(job)}
                      >
                        Continue research
                      </button>
                    )
                  )}
                </article>
              );
            })}
          </div>
          {(data.peopleJobs || []).length > 0 && <div className="space-y-3" aria-live="polite">
            <h3 className="font-semibold">Decision-maker research</h3>
            {data.peopleJobs!.slice(0, 6).map(job => <article key={job.id} className="rounded-lg border border-[var(--border)] p-3">
              <p className="font-medium">{job.config.companyName} · {job.status}</p>
              <p className="text-sm text-[var(--muted)]">{job.pages}/{job.config.budget.maxPages} pages · {job.message}</p>
              <a className="mt-2 inline-block text-sm underline" href={`/mandates/${mandateId}?tab=targets`}>Review business and contact leads in Targets</a>
              {!terminalResearchStates.includes(job.status) && <button className={`${button} ml-3`} disabled={busy} onClick={() => act({action:"cancel"}, job.id)}>Stop people research</button>}
              {job.status === "queued" && <button className={`${button} ml-3`} disabled={busy} onClick={() => act({action:"retry-dispatch"}, job.id)}>Reconnect</button>}
            </article>)}
          </div>}
          <details><summary className="min-h-12 cursor-pointer content-center text-sm">Unlinked business evidence</summary>
          <p className="mb-3 text-xs text-[var(--muted)]">Source leads that have not been added to Targets. Review before adding a business.</p>
          <ResearchFindings
            findings={data.findings.filter(f => !f.targetId)}
            onChanged={() => {
              void refresh();
              onResultsChanged();
            }}
          />
          </details>
          {historyContent}
            </div>
          </details>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-200">
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
