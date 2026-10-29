"use client";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import {providerNeutralText} from '@/domain/provider-display';
import { mandateCompaniesHref } from "@/domain/mandate-navigation";
import type { ResearchJob } from "./research-panel";
import {
  companyResearchProgressState,
  isCompanyPipeline,
  type CompanyResearchCoverage,
} from "./company-pipeline-state";
export function CompanyPipelineProgress({
  job,
  jobs = [],
  mandateId,
  detail: startupDetail,
  coverage,
  peopleSaved,
  showCompaniesLink = true,
}: {
  job?: ResearchJob;
  jobs?: ResearchJob[];
  mandateId?: string;
  detail?: string;
  coverage?: CompanyResearchCoverage;
  peopleSaved?: number;
  showCompaniesLink?: boolean;
}) {
  const state = job
    ? companyResearchProgressState(job, jobs, { coverage, peopleSaved })
    : {
        settled: false,
        companySettled: false,
        hasIssues: false,
        deadlineReached: false,
        lastUpdatedAt: 0,
        discovered: 0,
        processed: 0,
        companyQueued: 0,
        active: 0,
        headcounts: 0,
        revenueBands: 0,
        abns: 0,
        firmableAbns: 0,
        registryAbns: 0,
        abnActive: 0,
        abnQueued: 0,
        peopleSaved: 0,
        peopleActive: 0,
        peopleQueued: 0,
        peopleTotal: 0,
        peopleComplete: 0,
        peopleFailed: 0,
        peopleCancelled: 0,
        peopleUnattempted: 0,
        peopleSettled: false,
        backgroundTotal: 0,
        backgroundActive: 0,
        backgroundQueued: 0,
        backgroundComplete: 0,
        backgroundFailed: 0,
        savedIds: [],
      };
  const stopped = job?.status === "failed" || job?.status === "cancelled";
  const running =
    !stopped &&
    !state.settled &&
    (state.backgroundActive + state.backgroundQueued > 0 ||
      !state.deadlineReached ||
      state.active - state.companyQueued + state.peopleActive > 0);
  const complete =
    state.settled && job?.status === "complete" && !state.hasIssues;
  const [startedAt] = useState(Date.now),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const end = running
    ? now
    : Math.max(
        state.lastUpdatedAt || startedAt,
        state.deadlineReached
          ? Math.min(now, job?.config.automaticDeadline || now)
          : 0,
      );
  const seconds = Math.max(
    0,
    Math.floor(
      (end - (job ? new Date(job.createdAt).getTime() : startedAt)) / 1000,
    ),
  );
  const researching = state.processed > 0 || state.active > 0,
    continuation = Boolean(job?.config.companyContinuation);
  const includePeople =
    !job ||
    (isCompanyPipeline(job)
      ? job.config.includeCompanyPeople
      : job.config.findPeople !== false) ||
    state.peopleTotal > 0;
  const title = running
    ? state.companySettled
      ? "Completing research"
      : "Finding businesses"
    : complete
      ? "Research complete"
      : stopped
        ? `Research ${job?.status}`
        : state.deadlineReached
          ? "Research incomplete"
          : "Finished with issues";
  const detail =
    startupDetail ||
    (running
      ? job?.message?.startsWith("Waiting for Firmable")
        ? job.message
        : state.companySettled
          ? state.peopleSettled
            ? "Company profiles are ready. Company details are still being researched."
            : "Company profiles are ready. People and company details are still being researched."
          : researching
            ? "Finding headcounts, revenue bands, ABNs, people and email addresses for the businesses we discover."
            : "Searching for businesses that match your acquisition brief."
      : complete
        ? "All requested research has finished. Your results are ready to review."
        : state.deadlineReached
          ? "Time limit reached. Saved results are available; unfinished research is listed below."
          : stopped
            ? job?.message || "Research stopped. Saved results are available."
            : "Some research finished with issues. Review the saved results and incomplete work below.");
  const queueLabel = "queued";
  const summary = (parts: [number, string][]) =>
    parts
      .filter(([count]) => count > 0)
      .map(([count, label]) => `${count} ${label}`)
      .join(" · ");
  const stages = [
    {
      label: continuation
        ? "Saved businesses selected"
        : "Searching for businesses",
      count: state.discovered,
      suffix: continuation ? "selected" : "found",
      done: state.companySettled,
      active: running && !state.companySettled,
    },
    {
      label: "Finding headcounts",
      count: state.headcounts,
      suffix: "found",
      done: state.companySettled,
      active: running && !state.companySettled,
    },
    {
      label: "Finding revenue bands",
      count: state.revenueBands,
      suffix: "found",
      done: state.companySettled,
      active: running && !state.companySettled,
    },
    {
      label: "Finding ABNs",
      count: state.abns,
      suffix: "found",
      done: state.companySettled && state.abnActive + state.abnQueued === 0,
      active:
        running &&
        (!state.companySettled || state.abnActive + state.abnQueued > 0),
      detail: summary([
        [state.firmableAbns, "from company data"],
        [state.registryAbns, "registry matches"],
        [state.abnActive, "running"],
        [state.abnQueued, queueLabel],
      ]),
    },
    ...(includePeople
      ? [
          {
            label: "Finding people and emails",
            count: state.peopleSaved,
            suffix: "saved",
            done: state.peopleSettled,
            active: running && state.peopleActive + state.peopleQueued > 0,
            incomplete: state.peopleFailed + state.peopleCancelled > 0,
            detail: summary([
              [state.peopleComplete, "companies checked"],
              [state.peopleActive, "running"],
              [state.peopleQueued, queueLabel],
              [state.peopleFailed, "incomplete"],
              [state.peopleUnattempted, "not started"],
              [
                Math.max(0, state.peopleCancelled - state.peopleUnattempted),
                "cancelled",
              ],
            ]),
          },
        ]
      : []),
    ...(state.backgroundTotal
      ? [
          {
            label: "Company details",
            count: state.backgroundComplete,
            suffix: "completed",
            done: state.backgroundActive + state.backgroundQueued === 0,
            active:
              running && state.backgroundActive + state.backgroundQueued > 0,
            incomplete: state.backgroundFailed > 0,
            detail: summary([
              [state.backgroundActive, "running"],
              [state.backgroundQueued, queueLabel],
              [state.backgroundFailed, "incomplete"],
            ]),
          },
        ]
      : []),
    {
      label: "Saving company results",
      count: state.savedIds.length,
      suffix: "saved",
      done: state.companySettled,
      active: running && !state.companySettled,
    },
  ];
  return (
    <section className="mx-auto my-8 max-w-3xl rounded-[10px] border border-[#d8deeb] bg-white px-5 py-10 text-center text-[#20252f] sm:px-9">
      {running ? (
        <div
          aria-hidden="true"
          className="mx-auto mb-[18px] size-[31px] animate-spin rounded-full border-[3px] border-[#e2e3fb] border-t-[#3732a0] motion-reduce:animate-none"
        />
      ) : (
        <div
          aria-hidden="true"
          className={`mx-auto mb-[18px] flex size-[31px] items-center justify-center rounded-full ${complete ? "bg-[#e5f4eb] text-[#2c7958]" : "bg-amber-50 text-amber-800"}`}
        >
          {complete ? <Check size={18} /> : <span>!</span>}
        </div>
      )}
      <p className="text-[10px] font-extrabold tracking-[.1em] text-[#7d8aa0]">
        {complete
          ? "RESEARCH COMPLETE"
          : running
            ? "RESEARCH IN PROGRESS"
            : "RESEARCH INCOMPLETE"}
      </p>
      <h2 className="mt-2 text-[22px] font-bold leading-tight tracking-[-.04em]">
        {title}
      </h2>
      <p
        role="status"
        aria-live="polite"
        className="mt-[7px] text-[11px] text-[#637592]"
      >
        {providerNeutralText(detail)}
      </p>
      <div
        role="progressbar"
        aria-label="Company research progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={complete ? 100 : undefined}
        aria-valuetext={
          complete
            ? "Research complete"
            : running
              ? "Company research in progress"
              : title
        }
        className="mt-[22px] h-2 overflow-hidden rounded-full bg-[#e9ebf4]"
      >
        <div
          className={`h-full bg-[#3732a0] ${running ? "animate-pulse motion-reduce:animate-none" : ""}`}
          style={{ width: complete ? "100%" : researching ? "70%" : "30%" }}
        />
      </div>
      <div className="mt-[9px] flex flex-wrap justify-between gap-3 text-[10px] text-[#637592]">
        <span role="status" aria-live="polite">
          {complete ? "100% · " : running ? "In progress · " : ""}
          {state.discovered}{" "}
          {state.discovered === 1 ? "business" : "businesses"}{" "}
          {continuation ? "selected" : "found"}
        </span>
        <span>
          {state.processed} {state.processed === 1 ? "company" : "companies"}{" "}
          researched
        </span>
      </div>
      <ol className="mx-auto mt-[23px] grid max-w-[420px] gap-3 text-left">
        {stages.map((stage, index) => {
          const successful = stage.done && stage.count > 0 && !stage.incomplete;
          return (
            <li
              key={stage.label}
              className={`flex items-start gap-[9px] text-[11px] ${stage.incomplete ? "text-amber-800" : successful ? "text-[#2c7958]" : stage.active ? "font-bold text-[#4541cf]" : "text-[#8593aa]"}`}
            >
              <span
                aria-hidden="true"
                className={`flex size-[19px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${successful ? "bg-[#e5f4eb]" : stage.active ? "bg-[#e6e5ff]" : "bg-[#eceff5]"}`}
              >
                {successful ? (
                  <Check size={12} />
                ) : stage.incomplete ? (
                  "!"
                ) : (
                  index + 1
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex justify-between gap-4">
                  <span>{stage.label}</span>
                  <span className="shrink-0 text-[#637592]">
                    {stage.count} {stage.suffix}
                  </span>
                </span>
                {stage.detail && (
                  <span className="mt-1 block font-normal text-[#637592]">
                    {stage.detail}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {stopped && state.active > 0 && (
        <p className="mt-5 text-[11px] text-[#637592]">
          {state.active} company{" "}
          {state.active === 1 ? "request is" : "requests are"} still recorded as
          in progress.
        </p>
      )}
      <p className="mt-6 text-[11px] text-[#637592]">
        {state.savedIds.length}{" "}
        {state.savedIds.length === 1 ? "company" : "companies"} saved ·{" "}
        {Math.floor(seconds / 60)}m {seconds % 60}s
        {running ? " so far" : " elapsed"}
      </p>
      {showCompaniesLink && mandateId && state.savedIds.length > 0 && (
        <a
          href={mandateCompaniesHref(mandateId)}
          className="mt-5 inline-block rounded-md bg-[#3732a0] px-4 py-3 text-sm font-semibold text-white"
        >
          View companies
        </a>
      )}
    </section>
  );
}
