"use client";
import { useCallback, useEffect, useState } from "react";
import {
  terminalResearchStates,
  type ResearchConfig,
  type ResearchFinding,
} from "@/domain/research";
import type { AcquisitionBrief } from "@/domain/acquisition";
const input =
  "min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--panel-raised)] p-2 text-sm";
const button =
  "min-h-11 rounded-md border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-40";
type Job = {
  id: string;
  status: string;
  pages: number;
  modelCalls: number;
  message: string;
  createdAt: string;
  config: ResearchConfig;
};
type Finding = {
  id: string;
  jobId: string;
  sourceUrl: string;
  observedAt: string;
  confidence: number;
  targetId: string | null;
  evidence: ResearchFinding;
};
type Data = { enabled: boolean; jobs: Job[]; findings: Finding[] };
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
    [busy, setBusy] = useState(false);
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
    [discover, setDiscover] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setData(await request(`/api/mandates/${mandateId}/research`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [mandateId]);
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);
  const active = data.jobs.find(
    (j) => !terminalResearchStates.includes(j.status),
  );
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div>
        <h2 className="text-xl font-semibold">Research public websites</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Find businesses and investigate their capabilities. Work continues
          when you leave this page; source claims remain provisional.
        </p>
      </div>
      {loading ? (
        <p role="status">Checking research service…</p>
      ) : !data.enabled ? (
        <p className="text-sm text-[var(--muted)]">
          Website research is awaiting activation. Directory and Google Places
          discovery remain available above.
        </p>
      ) : (
        <>
          {!active && (
            <details>
              <summary className="cursor-pointer py-3 font-medium">
                Set up research
              </summary>
              <div className="mt-4 space-y-4">
                <label className="block text-sm">
                  Public search terms (one per line, up to three)
                  <textarea
                    className={input}
                    rows={3}
                    value={terms}
                    onChange={(e) => {
                      setTerms(e.target.value);
                      setApproved(false);
                    }}
                  />
                </label>
                <label className="block text-sm">
                  Search geography
                  <input
                    className={input}
                    value={geography}
                    onChange={(e) => {
                      setGeography(e.target.value);
                      setApproved(false);
                    }}
                  />
                </label>
                <label className="block text-sm">
                  Starting directory or company URLs (optional, one per line)
                  <textarea
                    className={input}
                    rows={3}
                    value={seeds}
                    onChange={(e) => {
                      setSeeds(e.target.value);
                      setApproved(false);
                    }}
                    placeholder="https://…"
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
                  Find starting websites using directories and Google Places
                </label>
                <label className="block text-sm">
                  Maximum pages
                  <select
                    className={input}
                    value={pages}
                    onChange={(e) => {
                      setPages(Number(e.target.value));
                      setApproved(false);
                    }}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
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
                  Extract sourced claims with AI
                </label>
                <p className="text-sm text-[var(--muted)]">
                  Up to {pages} crawl jobs, {Math.min(3, pages)} domains,{" "}
                  {useAi ? pages : 0} model calls and 10 minutes. Free-plan
                  quotas are shared across the account; usage beyond included
                  allowances may incur charges. Each model call uses at most
                  12,000 page characters and 1,200 output tokens.
                </p>
                <label className="flex items-start gap-3 text-sm">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={approved}
                    onChange={(e) => setApproved(e.target.checked)}
                  />
                  I approve sending these search terms to Google Places and
                  public URLs/page content to Cloudflare for this research. I
                  have removed confidential buyer details.
                </label>
                <button
                  className={button}
                  disabled={busy || !approved}
                  onClick={() =>
                    act({
                      requestId: crypto.randomUUID(),
                      seeds: seeds
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                      searchTerms: terms
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                      geography,
                      approved: true,
                      discover,
                      budget: {
                        maxPages: pages,
                        maxDomains: Math.min(3, pages),
                        maxMinutes: 10,
                        maxModelCalls: useAi ? pages : 0,
                      },
                    })
                  }
                >
                  Start research
                </button>
              </div>
            </details>
          )}
          <div className="space-y-3" aria-live="polite">
            {data.jobs.slice(0, 5).map((job) => (
              <article
                key={job.id}
                className="rounded-lg border border-[var(--border)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <strong className="capitalize">{job.status}</strong>
                  <span className="text-xs text-[var(--muted)]">
                    {job.pages}/{job.config.budget.maxPages} pages ·{" "}
                    {job.modelCalls}/{job.config.budget.maxModelCalls} model
                    calls
                  </span>
                </div>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {job.message}
                </p>
                {!terminalResearchStates.includes(job.status) && (
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
                )}
              </article>
            ))}
          </div>
          <ResearchFindings
            findings={data.findings}
            mandateId={mandateId}
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
  findings: Finding[];
  mandateId: string;
  onChanged: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  async function accept(f: Finding) {
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
    <div className="space-y-3">
      <h3 className="font-semibold">Source evidence to review</h3>
      {!findings.length && (
        <p className="text-sm text-[var(--muted)]">
          Evidence will appear here as pages are processed.
        </p>
      )}
      {findings.map((f) => (
        <article
          key={f.id}
          className="rounded-lg border border-[var(--border)] p-4"
        >
          <p className="text-xs uppercase text-[var(--muted)]">
            {f.evidence.kind} · Unverified claim ·{" "}
            {Math.round(f.confidence * 100)}% confidence
          </p>
          <h4 className="mt-2 font-medium">{f.evidence.name}</h4>
          <p className="mt-1 text-sm">{f.evidence.value}</p>
          <blockquote className="mt-3 border-l border-[var(--border)] pl-3 text-sm text-[var(--muted)]">
            {f.evidence.quote}
          </blockquote>
          <a
            className="mt-3 inline-block break-all text-xs underline"
            href={f.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Source · {new Date(f.observedAt).toLocaleDateString()}
          </a>
          {f.evidence.kind === "company" &&
            f.evidence.website &&
            !f.targetId && (
              <div className="mt-3">
                <button
                  className={button}
                  disabled={Boolean(busy)}
                  onClick={() => accept(f)}
                >
                  {busy === f.id ? "Adding…" : "Add company to targets"}
                </button>
              </div>
            )}
        </article>
      ))}
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
  const [findings, setFindings] = useState<Finding[]>([]);
  useEffect(() => {
    let current = true;
    request(`/api/mandates/${mandateId}/research`)
      .then((data: Data) => {
        if (current)
          setFindings(
            data.findings.filter(
              (f) =>
                f.targetId === targetId ||
                new URL(f.sourceUrl).hostname.replace(/^www\./, "") === domain,
            ),
          );
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [mandateId, targetId, domain]);
  if (!findings.length) return null;
  return (
    <ResearchFindings
      findings={findings}
      mandateId={mandateId}
      onChanged={() => {}}
    />
  );
}
