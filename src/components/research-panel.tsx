"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  terminalResearchStates,
  groupResearchFindings,
  researchDomain,
  researchQueries,
  continueResearchConfig,
  type ResearchConfig,
  type SavedResearchFinding,
} from "@/domain/research";
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
type Data = { enabled: boolean; jobs: Job[]; findings: SavedResearchFinding[] };
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
  const [strategy,setStrategy]=useState<"discover"|"investigate">("discover");
  const [terms, setTerms] = useState(
    brief.criteria
      .find((c) => c.key === "subsectors")
      ?.value.split(";")
      .slice(0, 3)
      .map((s) => s.trim().slice(0, 160))
      .join("\n") || "",
  );
  const [geography, setGeography] = useState(
    brief.criteria.find((c) => c.key === "geography")?.value || "",
  );
  const [seeds, setSeeds] = useState(""),
    [approved, setApproved] = useState(false),
    [pages, setPages] = useState(3),
    [useAi, setUseAi] = useState(true),
    [discover, setDiscover] = useState(true),
    [continuation, setContinuation] = useState<Job | null>(null);
  const setupRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (setup && continuation) setupRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [setup, continuation]);
  const refresh = useCallback(async () => {
    try {
      setData(await request(`/api/mandates/${mandateId}/research`));
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
  const active = data.jobs.find(
    (j) => !terminalResearchStates.includes(j.status),
  );
  const termList = terms
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const budget = {
    maxPages: pages,
    maxDomains: Math.min(3, pages),
    maxMinutes: 10,
    maxModelCalls: useAi ? pages : 0,
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
      setApproved(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function resume(job: Job) {
    setContinuation(job);
    setTerms(job.config.searchTerms.join("\n"));
    setGeography(job.config.geography);
    setSeeds(remainingFor(job).slice(0, 10).join("\n"));
    setDiscover(false);
    setStrategy("discover");
    setApproved(false);
    setSetup(true);
  }
  return (
    <section className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div>
        <h2 className="text-xl font-semibold">Research public websites</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Assess different businesses first, then investigate their products and
          supply role. Evidence remains provisional; unknowns stay visible.
        </p>
      </div>
      {loading ? (
        <p role="status">Checking research service…</p>
      ) : !data.enabled ? (
        <p>Website research is awaiting activation.</p>
      ) : (
        <>
          {!active && (
            <>
              <button
                className={button}
                onClick={() => {
                  setSetup(!setup);
                  setContinuation(null);
                  setApproved(false);
                }}
              >
                Set up research
              </button>
              {setup && (
                <div ref={setupRef} className="space-y-4 rounded-lg border border-[var(--border)] p-4">
                  {continuation && (
                    <p className="font-medium">
                      Continue {remainingFor(continuation).length} saved URLs
                      with a fresh budget. Completed pages are skipped.
                    </p>
                  )}
                  <label className="block text-sm">
                    Public research terms (up to three)
                    <textarea
                      className={input}
                      rows={3}
                      disabled={Boolean(continuation)}
                      value={terms}
                      onChange={(e) => {
                        setTerms(e.target.value);
                        setApproved(false);
                      }}
                    />
                  </label>
                  <label className="block text-sm">
                    Geography
                    <input
                      className={input}
                      disabled={Boolean(continuation)}
                      value={geography}
                      onChange={(e) => {
                        setGeography(e.target.value);
                        setApproved(false);
                      }}
                    />
                  </label>
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
                            setApproved(false);
                          }}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={discover}
                          onChange={(e) => {
                            setDiscover(e.target.checked);
                            setApproved(false);
                          }}
                        />
                        Find starting websites using directories and Google
                        Places
                      </label>
                    </>
                  )}
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
                  {continuation && <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={strategy === "investigate"} onChange={(e) => { setStrategy(e.target.checked ? "investigate" : "discover"); setApproved(false); }} />
                    Investigate product pages on known websites first
                  </label>}
                  <label className="block text-sm">
                    Maximum page attempts
                    <select
                      className={input}
                      value={pages}
                      onChange={(e) => {
                        setPages(Number(e.target.value));
                        setApproved(false);
                      }}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={useAi}
                      onChange={(e) => {
                        setUseAi(e.target.checked);
                        setApproved(false);
                      }}
                    />
                    Assess sourced claims with AI
                  </label>
                  <p className="text-sm text-[var(--muted)]">
                    This run allows {pages} page attempts, {Math.min(3, pages)}{" "}
                    domains, {useAi ? pages : 0} AI calls and 10 minutes. Failed
                    attempts count toward the limit. Included allowances are
                    shared across your account; usage may incur charges.
                  </p>
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      className="mt-1"
                      type="checkbox"
                      checked={approved}
                      onChange={(e) => setApproved(e.target.checked)}
                    />
                    I approve this run and sharing these public research terms,
                    URLs and page content with the research providers. I have
                    removed confidential buyer details.
                  </label>
                  <button
                    className={button}
                    disabled={busy || !approved}
                    onClick={() =>
                      act({
                        requestId: crypto.randomUUID(),
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
                        strategy: continuation ? strategy : "discover",
                      })
                    }
                  >
                    {continuation ? "Continue research" : "Start research"}
                  </button>
                </div>
              )}
            </>
          )}
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
          <ResearchFindings
            findings={data.findings}
            onChanged={() => {
              void refresh();
              onResultsChanged();
            }}
          />
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
