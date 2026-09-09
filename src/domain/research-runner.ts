import { ResearchAiError } from "./research-ai-error";
import { targetedPlan, resolveTargetedChoice, fallbackTargetedChoice, type TargetedPlan } from "./targeted-research";
import { unusablePage } from "./page-quality";
import { businessPrompt, ownCompany, validateBusinessFindings } from "./business-research";
import { companyHeadcountPrompt, companyFactDiagnostics, observedCompanyFacts, companyFactLinks, orderCompanyFactQueue } from "./company-facts";
import { peoplePrompt, validatePeopleFindings, peopleFollowUpLinks, orderPeopleQueue } from "./people-research";
import {
  extractionPrompt,
  catalogueProductFindings,
  statedSupplyFindings,
  followUpLinks,
  publicResearchUrl,
  terminalResearchStates,
  validateFindings,
  orderResearchQueue,
  researchDomain,
  uniqueResearchUrls,
  type ResearchConfig,
  type ResearchPage,
  type ResearchRuntime,
} from "./research";
export interface ResearchSteps {
  do<T>(name: string, run: () => Promise<T>, retry?: boolean): Promise<T>;
  sleep(name: string, milliseconds: number): Promise<void>;
}
export type ResearchControl = {
  status: string;
  config: ResearchConfig;
  seeds: string[];
  deadline: number;
  stopReason?: string;
};
export interface ResearchServices {
  diagnostic?(event: Record<string, unknown>): void;
  control(): Promise<ResearchControl>;
  discover(): Promise<{ seeds: string[]; warning?: string; peopleLeadCount?: number }>;
  progress(event: {
    revision: number;
    status: string;
    pages: number;
    modelCalls: number;
    message: string;
    crawlId?: string | null;
    page?: ResearchPage;
    runtime?: ResearchRuntime;
  }): Promise<void>;
  submit(url: string): Promise<string>;
  poll(
    id: string,
  ): Promise<{
    status: string;
    page?: { url: string; markdown: string; title?: string };
    warning?: string;
  }>;
  cancel(id: string): Promise<void>;
  extract(messages: ReturnType<typeof extractionPrompt>): Promise<unknown>;
  extractHeadcount?(messages: ReturnType<typeof companyHeadcountPrompt>): Promise<unknown>;
  readPeoplePage?(url: string): Promise<{ status: string; page?: { url: string; markdown: string; title?: string }; warning?: string }>;
  readPage?(url: string): ReturnType<ResearchServices["poll"]>;
  readFallbackPage?(url: string): ReturnType<ResearchServices["poll"]>;
  peopleFollowup?(): Promise<{ seeds: string[]; legalEntity?: string; warning?: string }>;
  planFollowup?(plan: TargetedPlan): Promise<unknown>;
  targetedSearch?(field: "size" | "people"): Promise<{ seeds: string[]; warning?: string }>;
  now(): number;
}
export async function runResearch(
  step: ResearchSteps,
  service: ResearchServices,
) {
  let revision = 0,
    pages = 0,
    modelCalls = 0,
    activeCrawl: string | null = null;
  const warnings: string[] = [];
  // Diagnostics contain source locations and counts, never page text or model output.
  const source = (value: string) => { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return "invalid_url"; } };
  const trace = (event: string, details: Record<string, unknown>) => service.diagnostic?.({ event, ...details });
  let runtime: ResearchRuntime = { remaining: [], visited: [], attempts: [] };
  const publish = async (
    status: string,
    message: string,
    page?: ResearchPage,
  ) => {
    const event = {
      revision: ++revision,
      status,
      pages,
      modelCalls,
      message: message.slice(0, 1000),
      crawlId: activeCrawl,
      runtime: structuredClone(runtime),
      ...(page ? { page } : {}),
    };
    await step.do(`progress-${revision}`, () => service.progress(event));
  };
  const check = async (label: string) =>
    step.do(`control-${label}`, async () => {
      const data = await service.control();
      return { ...data, expired: service.now() >= data.deadline };
    });
  try {
    const initial = await check("start");
    if (terminalResearchStates.includes(initial.status)) return;
    runtime = {
      remaining: [...(initial.config.runtime?.remaining || initial.seeds)],
      visited: [...(initial.config.runtime?.visited || [])],
      attempts: [],
    };
    if (initial.expired) {
      await publish("partial", "Job time budget elapsed before starting");
      return;
    }
    await publish(
      "discovering",
      initial.config.discover
        ? "Finding starting websites"
        : "Resuming approved websites",
    );
    const discovered = await step.do("discover", () => service.discover());
    trace("discovery_result", { purpose: initial.config.purpose || "business", seeds: discovered.seeds.length, warning: Boolean(discovered.warning), budget: initial.config.budget });
    if (discovered.warning) warnings.push(discovered.warning);
    runtime.remaining = orderResearchQueue(
      [...runtime.remaining, ...discovered.seeds],
      runtime.visited,
    ).slice(0, 1000);
    const goalProgress = async (label: string) => {
      if (!initial.config.targetBusinesses || initial.config.purpose) return null;
      const current = await check(label);
      return { count: new Set(current.config.newBusinessIds || []).size, target: initial.config.targetBusinesses };
    };
    const finishAtGoal = async (label: string) => {
      const goal = await goalProgress(label);
      if (!goal || goal.count < goal.target) return false;
      await publish("complete", `${goal.count} of ${goal.target} new businesses found — target reached. Saved businesses remain available for review.`);
      return true;
    };
    if (await finishAtGoal("discovery-goal")) return;
    const domains = new Set<string>(initial.config.autoDomains || []),
      budget = initial.config.budget;
    let targetedAttempted = Boolean(initial.config.targetedFollowupStarted);
    let priorityUrl: string | undefined;
    const collected: ResearchPage["findings"] = [];
    let peopleFollowupAttempted = Boolean(initial.config.peopleFollowupStarted || initial.config.targetedFollowup);
    while (
      (runtime.remaining.length || (initial.config.targetedFollowup && !targetedAttempted && Boolean(service.planFollowup)) || (!peopleFollowupAttempted && initial.config.purpose === "people" && initial.config.maxPeopleSearches === 2 && Boolean(service.peopleFollowup))) &&
      runtime.attempts.length < budget.maxPages
    ) {
      if (initial.config.mode === "automatic" && initial.config.purpose && collected.some(f => initial.config.purpose === "people" ? f.kind === "person" : f.kind === "headcount")) break;
      if (await finishAtGoal(`goal-${runtime.attempts.length}`)) return;
      if (initial.config.targetedFollowup && !targetedAttempted && service.planFollowup && runtime.attempts.length > 0 && (runtime.attempts.length >= Math.min(2, budget.maxPages - 1, initial.config.purpose === "people" ? Math.max(1, budget.maxModelCalls - 2) : 2) || (!runtime.remaining.length && runtime.attempts.length > 0))) {
        targetedAttempted = true;
        const plan = targetedPlan(initial.config, collected, runtime.remaining, runtime.visited);
        if (plan && modelCalls < budget.maxModelCalls) {
          const current = await check("targeted-followup");
          if (terminalResearchStates.includes(current.status)) return;
          if (current.expired) { warnings.push("Time limit reached before targeted follow-up"); break; }
          modelCalls++;
          await publish("extracting", `Researching the remaining gap: ${plan.missing}`);
          let choice = fallbackTargetedChoice(plan);
          try {
            const output = await step.do("targeted-plan", () => service.planFollowup!(plan), false);
            choice = resolveTargetedChoice(output, plan);
          } catch { warnings.push("AI planner unavailable; using a predefined company follow-up"); }
          trace("followup_choice", { choice: choice.id, actions: plan.actions.map(a => ({ id: a.id, kind: a.kind, ...(a.kind === "read" ? { source: source(a.url) } : {}) })) });
          if (choice.kind === "stop") { warnings.push("No useful targeted follow-up selected; remaining sources retained"); break; }
          if (choice.kind === "read") priorityUrl = choice.url;
          if (choice.kind === "search" && service.targetedSearch) {
            await step.sleep("targeted-search-spacing", 21000);
            const beforeSearch = await check("targeted-search");
            if (terminalResearchStates.includes(beforeSearch.status)) return;
            if (beforeSearch.expired) { warnings.push("Time limit reached before targeted search"); break; }
            const field = choice.field;
            try {
              const result = await step.do("targeted-search", () => service.targetedSearch!(field), false);
              trace("targeted_search_result", { field, seeds: result.seeds.length, sources: result.seeds.slice(0, 20).map(source), warning: Boolean(result.warning) });
              runtime.remaining = uniqueResearchUrls([...result.seeds, ...runtime.remaining]);
              if (result.warning) warnings.push(result.warning);
            } catch { warnings.push("Targeted search unavailable; existing sources retained"); }
          }
        }
      }
      if (!peopleFollowupAttempted && runtime.attempts.length && initial.config.purpose === "people" && initial.config.maxPeopleSearches === 2 && service.peopleFollowup && ((discovered.peopleLeadCount || initial.config.peopleSearchLeads?.length || 0) > 0 || runtime.attempts.some(a => a.reason.includes("legal operator")) || runtime.attempts.length >= Math.min(3, budget.maxPages - 1) || !runtime.remaining.length)) {
        await step.sleep("people-search-spacing", 21000);
        const current = await check(`people-followup-${runtime.attempts.length}`);
        if (terminalResearchStates.includes(current.status)) return;
        if (current.expired) { warnings.push(current.stopReason || "Time limit reached"); break; }
        peopleFollowupAttempted = true;
        const followup = await step.do("people-followup", () => service.peopleFollowup!(), false);
        if (followup.warning) warnings.push(followup.warning);
        runtime.remaining = uniqueResearchUrls([...followup.seeds, ...runtime.remaining]).slice(0, 1000);
      }
      const beforeOrder = [...runtime.remaining];
      runtime.remaining = orderResearchQueue(runtime.remaining,runtime.visited,initial.config.strategy,runtime.attempts.map(a=>a.url));
      if (initial.config.purpose === "people") runtime.remaining = orderPeopleQueue(runtime.remaining, runtime.visited, initial.config.companyDomain!);
      if (initial.config.purpose === "firmographics") runtime.remaining = orderCompanyFactQueue(runtime.remaining, initial.config);
      trace("source_queue", { before: beforeOrder.length, after: runtime.remaining.length, excluded: beforeOrder.filter(u => !runtime.remaining.includes(u)).slice(0, 20).map(source), next: runtime.remaining.slice(0, 5).map(source), reason: "visited_and_purpose_source_filters" });
      if (priorityUrl) {
        runtime.remaining = [priorityUrl, ...runtime.remaining.filter(u=>u!==priorityUrl)];
        priorityUrl = undefined;
      }
      if (!runtime.remaining.length) break;
      const index = runtime.remaining.findIndex(
        (u) =>
          domains.has(researchDomain(u)) || domains.size < budget.maxDomains,
      );
      if (index < 0) {
        warnings.push("Domain limit reached");
        break;
      }
      const control = await check(`page-${runtime.attempts.length}`);
      if (terminalResearchStates.includes(control.status)) return;
      if (control.expired) {
        warnings.push(control.stopReason || "Time limit reached");
        break;
      }
      const url = runtime.remaining.splice(index, 1)[0],
        attempt = runtime.attempts.length + 1;
      trace("page_selected", { source: source(url), purpose: initial.config.purpose || "business", attempt, pageLimit: budget.maxPages, remaining: runtime.remaining.length });
      domains.add(researchDomain(url));
      runtime.visited = uniqueResearchUrls([...runtime.visited, url]).slice(
        -1000,
      );
      const entry: ResearchRuntime["attempts"][number] = {
        url,
        status: "pending",
        reason: "Submission pending",
      };
      runtime.attempts.push(entry);
      await publish(
        "crawling",
        `Reading website ${domains.size}, page attempt ${attempt} of ${budget.maxPages}`,
      );
      try {
        let result: Awaited<ReturnType<ResearchServices["poll"]>> | undefined;
        const directReader = service.readPage || (["people", "firmographics"].includes(initial.config.purpose || "") ? service.readPeoplePage : undefined);
        if (directReader) {
          if (!service.readPage) await step.sleep(`people-reader-spacing-${attempt}`, 21000);
          result = await step.do(`read-people-${attempt}`, async () => {
            const current = await service.control();
            if (terminalResearchStates.includes(current.status) || service.now() >= current.deadline) throw new Error("Stopped before reading");
            try { return await directReader(url); }
            catch { return { status: "failed", warning: "Primary page reader unavailable" }; }
          }, false);
        } else {
          activeCrawl = await step.do(
            `submit-${attempt}`,
            async () => {
              const current = await service.control();
              if (
                terminalResearchStates.includes(current.status) ||
                service.now() >= current.deadline
              )
                throw new Error("Stopped before submission");
              return service.submit(url);
            },
            false,
          );
          entry.crawlId = activeCrawl;
          entry.reason = "Waiting for crawler";
          await publish("crawling", `Waiting for ${new URL(url).hostname}`);
          for (let poll = 0; poll < 30; poll++) {
            await step.sleep(`sleep-${attempt}-${poll}`, 11000);
            const current = await check(`poll-${attempt}-${poll}`);
            if (
              terminalResearchStates.includes(current.status) ||
              current.expired
            ) {
              try {
                await step.do(`cancel-${attempt}`, () => service.cancel(activeCrawl!), false);
              } catch { /* A completed or unavailable crawl must not prevent saving the continuation. */ }
              activeCrawl = null;
              entry.status = "failed";
              entry.reason = "Stopped while waiting for crawler";
              if (!terminalResearchStates.includes(current.status))
                await publish(
                  "partial",
                  current.stopReason || "Time limit reached; unfinished crawl cancelled",
                );
              return;
            }
            result = await step.do(`poll-${attempt}-${poll}`, () =>
              service.poll(activeCrawl!),
            );
            if (result.status !== "running") break;
          }
        }
        if (!result || result.status === "running") {
          await step.do(`cancel-timeout-${attempt}`, () =>
            service.cancel(activeCrawl!),
          );
          activeCrawl = null;
          entry.status = "failed";
          entry.reason = "Crawler polling timed out";
          warnings.push(entry.reason);
          await publish("crawling", entry.reason);
          continue;
        }
        activeCrawl = null;
        const quality = result.page ? unusablePage(result.page.markdown) : "No page content";
        if ((result.status !== "completed" || quality) && service.readFallbackPage) {
          const current = await check(`fallback-${attempt}`);
          if (terminalResearchStates.includes(current.status)) return;
          if (!current.expired) {
            result = await step.do(`fallback-${attempt}`, () => service.readFallbackPage!(url), false);
          }
        }
        const finalQuality = result.page ? unusablePage(result.page.markdown) : null;
        if (finalQuality) result = { status: "failed", warning: finalQuality };
        trace("page_read", { source: source(url), status: result.status, quality: finalQuality || (result.page ? "usable" : "missing_content"), characters: result.page?.markdown.length || 0 });
        if (result.status !== "completed" || !result.page) {
          entry.status = "failed";
          entry.reason = (
            result.warning || `Crawler status: ${result.status}`
          ).slice(0, 300);
          warnings.push("Some pages could not be read; see page details");
          await publish("crawling", entry.reason);
          continue;
        }
        const sourceUrl = publicResearchUrl(result.page.url);
        if (!sourceUrl) {
          entry.status = "failed";
          entry.reason = "Unsupported redirect URL";
          await publish("crawling", entry.reason);
          continue;
        }
        pages++;
        entry.status = "read";
        entry.finalUrl = sourceUrl;
        entry.reason = "Read; no supported claims extracted yet";
        runtime.visited = uniqueResearchUrls([
          ...runtime.visited,
          sourceUrl,
        ]).slice(-1000);
        const markdown = `${result.page.title ? `# ${result.page.title}\n\n` : ""}${result.page.markdown}`.slice(0, 24000);
        runtime.remaining = orderResearchQueue(
          [
            ...runtime.remaining,
            ...(initial.config.purpose === "firmographics" ? companyFactLinks(markdown, sourceUrl, initial.config, runtime.visited) : initial.config.purpose === "people" ? peopleFollowUpLinks(markdown, sourceUrl, runtime.visited, initial.config) : followUpLinks(
              markdown,
              sourceUrl,
              initial.config.searchTerms,
              runtime.visited,
            )),
          ],
          runtime.visited,
        ).slice(0, 1000);
        let findings: ResearchPage["findings"] = [];
        const directPeople = initial.config.purpose === "people" ? validatePeopleFindings([], markdown, sourceUrl, initial.config) : [];
        if (initial.config.purpose === "firmographics") {
          findings = observedCompanyFacts(markdown, sourceUrl, initial.config);
          if (initial.config.mode === "automatic" && researchDomain(sourceUrl) === initial.config.companyDomain && !ownCompany(collected, sourceUrl) && modelCalls < budget.maxModelCalls) {
            modelCalls++;
            await publish("extracting", "Checking company identity and products alongside company details");
            try {
              const business = await step.do(`company-identity-${attempt}`, async () => {
                const current = await service.control();
                if (terminalResearchStates.includes(current.status) || service.now() >= current.deadline) return [];
                return validateBusinessFindings(await service.extract(businessPrompt(markdown, initial.config.searchTerms, sourceUrl, false)), markdown, sourceUrl, initial.config);
              }, false);
              findings.push(...business);
            } catch { warnings.push("Company identity extraction unavailable; directly observed facts retained"); }
          }
          trace("extraction_result", { source: source(sourceUrl), method: "observed_company_facts", accepted: findings.length, kinds: findings.map(f => f.kind), headcountFound: findings.some(f => f.kind === "headcount"), ...companyFactDiagnostics(markdown, sourceUrl, initial.config), reason: findings.length ? "supported_facts" : "no_supported_company_fact_pattern" });
          entry.reason = `${findings.length} sourced company facts; estimates and scope require review`;
        } else if (directPeople.some(f=>f.kind === "person")) {
          findings = directPeople;
          entry.reason = "Named role directly supported by company page; no AI extraction needed";
        } else if (modelCalls < budget.maxModelCalls) {
          modelCalls++;
          await publish(
            "extracting",
            initial.config.purpose === "people" ? `Looking for named decision-makers on website ${domains.size}` : `Assessing products and business role on website ${domains.size}`,
          );
          const extracted = await step.do(
            `extract-${attempt}`,
            async () => {
              const current = await service.control();
              if (
                terminalResearchStates.includes(current.status) ||
                service.now() >= current.deadline
              )
                return { findings: [], warning: "Extraction stopped" };
              try {
                const raw = await service.extract(initial.config.purpose === "people" ? peoplePrompt(markdown, sourceUrl, current.config) : initial.config.workflow === "business" ? businessPrompt(markdown, initial.config.searchTerms, sourceUrl, Boolean(initial.config.findPeople)) : extractionPrompt(markdown, initial.config.searchTerms, sourceUrl));
                const rejected: Record<string, number> = {};
                const accepted = (initial.config.purpose === "people" ? (input: unknown, markdown: string, source: string) => validatePeopleFindings(input, markdown, source, current.config, reason => { rejected[reason] = (rejected[reason] || 0) + 1; }) : initial.config.workflow === "business" ? (input: unknown, markdown: string, source: string) => validateBusinessFindings(input, markdown, source, current.config) : validateFindings)(
                    raw, markdown, sourceUrl, initial.config.searchTerms,
                  );
                trace("extraction_result", { source: source(sourceUrl), method: "model", rejected, candidates: Array.isArray(raw) ? raw.length : null, accepted: accepted.length, kinds: accepted.map(f => f.kind), reason: !Array.isArray(raw) ? "invalid_candidate_shape" : !raw.length ? "model_returned_no_evidence" : !accepted.length ? "candidates_failed_evidence_validation" : "supported_facts" });
                return { findings: accepted, warning: "" };
              } catch (error) {
                return {
                  findings: [],
                  warning: error instanceof ResearchAiError ? `Evidence extraction failed: ${error.message}; page read successfully` : "Evidence extraction failed; page read successfully",
                };
              }
            },
            false,
          );
          findings = extracted.findings;
          if (extracted.warning) warnings.push(extracted.warning);
          entry.reason =
            extracted.warning ||
            (initial.config.purpose === "people" ? `${findings.filter(f => f.kind === "person").length} sourced people leads${findings.some(f => f.kind === "identifier") ? "; legal operator identified" : ""}; role currency and email remain unverified` : `${findings.length} supported claims; financial fit remains unknown`);
        } else { entry.reason = "Read without AI extraction (model limit)"; }
        if (initial.config.purpose === "people") {
          // Keep directly observed team evidence even when the model failed or its allowance ended.
          findings.push(...directPeople.filter(f=>!findings.some(v=>v.kind===f.kind && v.name===f.name && v.value===f.value)));
        }
        const catalogue = initial.config.purpose ? [] : [...statedSupplyFindings(markdown, sourceUrl, initial.config.searchTerms), ...catalogueProductFindings(markdown, sourceUrl, initial.config.searchTerms)]
          .filter(c => !findings.some(f => f.kind === c.kind && f.value === c.value));
        findings = [...findings, ...catalogue].slice(0, initial.config.purpose === "firmographics" ? 8 : 4);
        if (catalogue.length) entry.reason = `${findings.length} supported claims including directly observed website evidence; financial fit remains unknown`;
        collected.push(...findings);
        const observedAt = await step.do(`observed-${attempt}`, async () =>
          new Date(service.now()).toISOString(),
        );
        await publish(
          "crawling",
          `${pages} pages read across ${domains.size} websites`,
          {
            url: sourceUrl,
            markdown,
            observedAt,
            findings,
            truncated: result.page.markdown.length > 24000,
          },
        );
      } catch {
        if (activeCrawl) {
          try {
            await step.do(`cancel-error-${attempt}`, () =>
              service.cancel(activeCrawl!),
            );
          } catch {
            /* best effort cleanup */
          }
        }
        activeCrawl = null;
        entry.status = "failed";
        entry.reason =
          "Provider request failed or timed out; not automatically retried to avoid duplicate charges";
        warnings.push("Some pages could not be read; see page details");
        await publish("crawling", entry.reason);
      }
    }
    if (initial.config.mode === "automatic" && initial.config.purpose && collected.some(f => initial.config.purpose === "people" ? f.kind === "person" : f.kind === "headcount")) {
      trace("run_finished", { pages, modelCalls, reason: "requested_evidence_found", purpose: initial.config.purpose });
      await publish("complete", initial.config.purpose === "people" ? "Sourced decision-maker found; review role and contact evidence before outreach." : "Sourced headcount found; company evidence is ready for review.");
      return;
    }
    if (await finishAtGoal("final-goal")) return;
    const goal = await goalProgress("final-count");
    if (goal) warnings.push(`${goal.count} of ${goal.target} new businesses found — ${runtime.remaining.length ? "research budget reached" : "available search results exhausted"}`);
    if (runtime.remaining.length)
      warnings.push(
        `${runtime.remaining.length} URLs remain; continue research with a fresh budget`,
      );
    if (initial.config.targetedFollowup && initial.config.purpose && !collected.some(f=>initial.config.purpose === "people" ? f.kind === "person" : f.kind === "headcount")) warnings.push(initial.config.purpose === "people" ? "Named decision-maker remains unknown; available sources retained" : "Headcount remains unknown; available sources retained");
    trace("run_finished", { pages, attempts: runtime.attempts.length, modelCalls, remaining: runtime.remaining.length, findings: collected.length, kinds: [...new Set(collected.map(f => f.kind))], reason: runtime.attempts.length >= budget.maxPages ? "page_budget_reached" : "sources_exhausted_or_followup_stopped" });
    if (!pages) warnings.push("No pages could be read");
    await publish(
      warnings.length ? "partial" : "complete",
      [
        `${pages} pages read across ${domains.size} websites.`,
        ...new Set(warnings),
      ].join(" "),
    );
  } catch {
    if (activeCrawl) {
      try {
        await step.do("cancel-failed-workflow", () =>
          service.cancel(activeCrawl!),
        );
      } catch {
        /* report failure even if provider unavailable */
      }
    }
    await publish(
      pages ? "partial" : "failed",
      "Research interrupted; saved progress retained. Continue remaining URLs with a fresh budget.",
    );
  }
}
