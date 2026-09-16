import { adaptiveDiscovery, retryDiscovery, type DiscoveryContext } from "./adaptive-discovery";
import { providerFailure, BrowserAdmissionDeferred } from "./research-provider-error";
import { missingResearchFields, fieldLabels, type ResearchField } from "./research-objectives";
import { ResearchAiError } from "./research-ai-error";
import { targetedPlan, resolveTargetedChoice, fallbackTargetedChoice, nextTargetedAction, MAX_TARGETED_SEARCHES, type TargetedPlan } from "./targeted-research";
import { stripBoilerplate } from "./page-content";
import { directorySource, serviceBusinessDomain, unreadableDiscoverySource } from "./discovery-sources";
import { unusablePage } from "./page-quality";
import { businessPrompt, headingCompanyFinding, ownCompany, relevantBusiness, validateBusinessFindings } from "./business-research";
import { companyHeadcountPrompt, companyFactDiagnostics, observedCompanyFacts, companyFactLinks, orderCompanyFactQueue, modelHeadcountFinding } from "./company-facts";
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
  researchUrlKey,
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
  findings?: ResearchPage["findings"];
};
export interface ResearchServices {
  diagnostic?(event: Record<string, unknown>): void;
  control(): Promise<ResearchControl>;
  discoveryContext?(): Promise<DiscoveryContext>;
  planDiscovery?(context: DiscoveryContext): Promise<unknown>;
  discover(decision?: unknown): Promise<{ seeds: string[]; warning?: string; peopleLeadCount?: number; skipDomains?: string[]; more?: boolean }>;
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
    page?: { url: string; markdown: string; title?: string; observedAt?: string };
    warning?: string;
    deferred?: boolean;
  }>;
  cancel(id: string): Promise<void>;
  extract(messages: ReturnType<typeof extractionPrompt>): Promise<unknown>;
  extractHeadcount?(messages: ReturnType<typeof companyHeadcountPrompt>): Promise<unknown>;
  readPeoplePage?(url: string): Promise<{ status: string; page?: { url: string; markdown: string; title?: string; observedAt?: string }; warning?: string }>;
  cachedPage?(url: string): Promise<Awaited<ReturnType<ResearchServices["poll"]>> | null>;
  readPage?(url: string): ReturnType<ResearchServices["poll"]>;
  readFallbackPage?(url: string): ReturnType<ResearchServices["poll"]>;
  peopleFollowup?(): Promise<{ seeds: string[]; legalEntity?: string; warning?: string }>;
  planFollowup?(plan: TargetedPlan): Promise<unknown>;
  targetedSearch?(field: ResearchField, round: number): Promise<{ seeds: string[]; warning?: string; exhausted?: boolean; failed?: boolean; retryable?: boolean }>;
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
  // A host that returns no readable content is skipped for the rest of the job.
  const blockedDomains = new Set<string>();
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
      remaining: initial.config.parallelDiscovery ? [] : [...(initial.config.runtime?.remaining || initial.seeds)],
      visited: [...(initial.config.runtime?.visited || [])],
      attempts: [],
      ...(initial.config.runtime?.pendingPage ? { pendingPage: initial.config.runtime.pendingPage } : {}),
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
    const discoverRound = async (round: number) => {
      let decision: unknown;
      let attemptIndex: number | undefined;
      if (adaptiveDiscovery(initial.config) && service.discoveryContext && service.planDiscovery) {
        const context = await step.do(`discovery-context-${round}`, () => service.discoveryContext!());
        attemptIndex = context.attempts.length;
        if (context.remainingSearches > 0 && context.found < context.target && !retryDiscovery(context.attempts) && modelCalls < initial.config.budget.maxModelCalls) {
          const current = await check(`discovery-plan-${round}`);
          if (terminalResearchStates.includes(current.status) || current.expired) return { seeds: [], more: true };
          modelCalls++;
          try { decision = await step.do(`discovery-plan-${round}`, () => service.planDiscovery!(context), false); }
          catch (error) {
            if (error instanceof BrowserAdmissionDeferred) { modelCalls--; return { seeds: [], more: true }; }
            warnings.push("AI search planner unavailable; using scope-based searches");
          }
          await publish("discovering", "Adapting search strategy from research results");
        }
      }
      return step.do(round ? `discover-${round}` : "discover", () => service.discover(attemptIndex === undefined ? undefined : { planning: decision, attemptIndex }));
    };
    let discovered = await discoverRound(0);
    // Web discovery is delivered in slices so no single callback outlives the worker's request limit.
    for (let round = 1; discovered.more && round < 6; round++) {
      const current = await check(`discover-${round}`);
      if (terminalResearchStates.includes(current.status)) return;
      if (current.expired) break;
      const next = await discoverRound(round);
      discovered = { ...next, seeds: uniqueResearchUrls([...discovered.seeds, ...next.seeds]), warning: next.warning || discovered.warning, skipDomains: next.skipDomains || discovered.skipDomains, peopleLeadCount: next.peopleLeadCount ?? discovered.peopleLeadCount };
    }
    trace("discovery_result", { purpose: initial.config.purpose || "business", seeds: discovered.seeds.length, warning: Boolean(discovered.warning), budget: initial.config.budget });
    if (discovered.warning) warnings.push(discovered.warning);
    if (discovered.more) warnings.push("More discovery queries remain for the next batch");
    const skipDomains = new Set([...(initial.config.skipDomains || []), ...(discovered.skipDomains || [])]);
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
    let priorityUrl: string | undefined;
    const collected: ResearchPage["findings"] = [...(initial.findings || [])];
    let peopleFollowupAttempted = Boolean(initial.config.peopleFollowupStarted || initial.config.targetedFollowup);
    // Missing-field follow-up runs in rounds: reading a page never consumes the
    // external search, and searching continues until evidence is found, the
    // query ladder is exhausted, or the page budget ends.
    const MAX_FOLLOWUP_ROUNDS = 28;
    const followup = { rounds: 0, searches: 0, afterAttempt: -1, readsSinceSearch: 0, searchesExhausted: !service.targetedSearch, plannerUsed: false };
    const exhaustedFields = new Set<ResearchField>();
    const fieldSearches: Partial<Record<ResearchField, number>> = {};
    const fieldFailures: Partial<Record<ResearchField, number>> = {};
    const fieldFound = () => missingResearchFields(initial.config, collected).length === 0;
    const availableField = () => missingResearchFields(initial.config, collected).find(f => !exhaustedFields.has(f));
    const followupPossible = () => Boolean(initial.config.targetedFollowup && initial.config.purpose && followup.rounds < MAX_FOLLOWUP_ROUNDS && !fieldFound());
    const followupThreshold = Math.min(2, budget.maxPages - 1, initial.config.purpose === "people" ? Math.max(1, budget.maxModelCalls - 2) : 2);
    // Due after new page evidence, or whenever the queue is empty and a search remains.
    // A resumed job can have visited pages but zero attempts in this execution.
    const followupDue = () => followupPossible() && (runtime.attempts.length > 0 || !runtime.remaining.length) && ((runtime.attempts.length !== followup.afterAttempt && (runtime.attempts.length >= followupThreshold || !runtime.remaining.length)) || (!runtime.remaining.length && !followup.searchesExhausted));
    while (
      (runtime.remaining.length || (followupPossible() && !followup.searchesExhausted) || (!peopleFollowupAttempted && initial.config.purpose === "people" && initial.config.maxPeopleSearches === 2 && Boolean(service.peopleFollowup))) &&
      runtime.attempts.length < budget.maxPages
    ) {
      if (initial.config.mode === "automatic" && initial.config.purpose && fieldFound()) break;
      if (await finishAtGoal(`goal-${runtime.attempts.length}`)) return;
      if (followupDue()) {
        followup.rounds++;
        followup.afterAttempt = runtime.attempts.length;
        followup.searchesExhausted = !service.targetedSearch || !availableField();
        const plan = targetedPlan(initial.config, collected, runtime.remaining, runtime.visited, !followup.searchesExhausted, availableField());
        if (!plan) { if (!runtime.remaining.length) break; }
        else {
          const current = await check(`targeted-followup-${followup.rounds}`);
          if (terminalResearchStates.includes(current.status)) return;
          if (current.expired) { warnings.push(current.stopReason || "Time limit reached before targeted follow-up"); break; }
          await publish("extracting", `Researching the remaining gap: ${plan.missing}`);
          let choice = nextTargetedAction(plan, { readsSinceSearch: followup.readsSinceSearch, searchAvailable: !followup.searchesExhausted });
          if (!followup.plannerUsed && service.planFollowup && modelCalls < budget.maxModelCalls) {
            followup.plannerUsed = true;
            modelCalls++;
            try {
              const output = await step.do("targeted-plan", () => service.planFollowup!(plan), false);
              choice = resolveTargetedChoice(output, plan);
            } catch { warnings.push("AI planner unavailable; using a predefined company follow-up"); choice = fallbackTargetedChoice(plan); }
          }
          // A stop is accepted only once external searches are exhausted.
          const search = plan.actions.find(a => a.kind === "search");
          if (choice.kind === "stop" && search && !followup.searchesExhausted) choice = search;
          trace("followup_choice", { round: followup.rounds, choice: choice.id, actions: plan.actions.map(a => ({ id: a.id, kind: a.kind, ...(a.kind === "read" ? { source: source(a.url) } : {}) })) });
          if (choice.kind === "stop") { warnings.push("No useful targeted follow-up selected; remaining sources retained"); break; }
          if (choice.kind === "read") { priorityUrl = choice.url; followup.readsSinceSearch++; }
          if (choice.kind === "search" && service.targetedSearch) {
            followup.readsSinceSearch = 0;
            const beforeSearch = await check(`targeted-search-${followup.rounds}`);
            if (terminalResearchStates.includes(beforeSearch.status)) return;
            if (beforeSearch.expired) { warnings.push(beforeSearch.stopReason || "Time limit reached before targeted search"); break; }
            const field = choice.field, round = ++followup.searches;
            try {
              const result = await step.do(`targeted-search-${round}`, () => service.targetedSearch!(field, round), false);
              trace("targeted_search_result", { round, field, seeds: result.seeds.length, exhausted: Boolean(result.exhausted), sources: result.seeds.slice(0, 20).map(source), warning: Boolean(result.warning) });
              runtime.remaining = uniqueResearchUrls([...result.seeds, ...runtime.remaining]);
              if (result.warning) warnings.push(result.warning);
              if (result.failed) fieldFailures[field] = (fieldFailures[field] || 0) + 1;
              else fieldSearches[field] = (fieldSearches[field] || 0) + 1;
              if (result.exhausted || (fieldSearches[field] || 0) >= MAX_TARGETED_SEARCHES[field] || (fieldFailures[field] || 0) >= MAX_TARGETED_SEARCHES[field] * 2) exhaustedFields.add(field);
              followup.searchesExhausted = !availableField();
            } catch { warnings.push(`Search for ${fieldLabels[field]} unavailable; existing sources retained`); exhaustedFields.add(field); followup.searchesExhausted = !availableField(); }
          }
        }
      }
      if (!peopleFollowupAttempted && runtime.attempts.length && initial.config.purpose === "people" && initial.config.maxPeopleSearches === 2 && service.peopleFollowup && ((discovered.peopleLeadCount || initial.config.peopleSearchLeads?.length || 0) > 0 || runtime.attempts.some(a => a.reason.includes("legal operator")) || runtime.attempts.length >= Math.min(3, budget.maxPages - 1) || !runtime.remaining.length)) {
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
      // Discovery never re-reads businesses already attached to the mandate.
      if (!initial.config.purpose) runtime.remaining = runtime.remaining.filter(u => !skipDomains.has(researchDomain(u)) && !unreadableDiscoverySource(u) && !serviceBusinessDomain(u));
      if (initial.config.discoveryCandidate && !directorySource(initial.seeds[0] || "")) runtime.remaining = runtime.remaining.filter(u => researchDomain(u) === initial.config.companyDomain);
      if (initial.config.purpose === "people") runtime.remaining = orderPeopleQueue(runtime.remaining, runtime.visited, initial.config.companyDomain!);
      if (initial.config.purpose === "firmographics") runtime.remaining = orderCompanyFactQueue(runtime.remaining, initial.config).filter(u => !blockedDomains.has(researchDomain(u)));
      trace("source_queue", { before: beforeOrder.length, after: runtime.remaining.length, excluded: beforeOrder.filter(u => !runtime.remaining.includes(u)).slice(0, 20).map(source), next: runtime.remaining.slice(0, 5).map(source), reason: "visited_and_purpose_source_filters" });
      if (priorityUrl) {
        runtime.remaining = [priorityUrl, ...runtime.remaining.filter(u=>u!==priorityUrl)];
        priorityUrl = undefined;
      }
      if (!runtime.remaining.length) {
        // An empty queue with searches remaining returns to the follow-up ladder.
        if (followupPossible() && !followup.searchesExhausted) continue;
        break;
      }
      // In discovery, one website may take at most two page attempts per batch so a
      // single catalogue or blog cannot absorb the budget; the rest wait for a later batch.
      const perDomainCap = initial.config.purpose ? Infinity : 2;
      const attemptsOn = (domain: string) => runtime.attempts.filter(a => researchDomain(a.url) === domain).length;
      const index = runtime.remaining.findIndex(
        (u) =>
          (domains.has(researchDomain(u)) || domains.size < budget.maxDomains) && attemptsOn(researchDomain(u)) < perDomainCap,
      );
      if (index < 0) {
        warnings.push(runtime.remaining.every(u => attemptsOn(researchDomain(u)) >= perDomainCap) ? "Per-website page limit reached for this batch; remaining pages continue next batch" : "Domain limit reached");
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
      const deferPage = (reason: string) => {
        entry.status = "pending";
        entry.reason = reason.slice(0, 300);
        const keys = new Set([url, entry.finalUrl].filter((u): u is string => Boolean(u)).map(researchUrlKey));
        runtime.visited = runtime.visited.filter(u => !keys.has(researchUrlKey(u)));
        runtime.remaining = uniqueResearchUrls([url, ...runtime.remaining]).slice(0, 1000);
        warnings.push(reason);
      };
      await publish(
        "crawling",
        `Waiting for browser slot — website ${domains.size}, page attempt ${attempt} of ${budget.maxPages}`,
      );
      try {
        let result: Awaited<ReturnType<ResearchServices["poll"]>> | undefined;
        const directReader = service.readPage || (["people", "firmographics"].includes(initial.config.purpose || "") ? service.readPeoplePage : undefined);
        if (runtime.pendingPage?.url === url) {
          result = { status: "completed", page: runtime.pendingPage.page };
        } else if (directReader) {
          result = service.cachedPage ? await step.do(`cached-read-${attempt}`, () => service.cachedPage!(url), false) || undefined : undefined;
          if (!result) {
          if (!service.readPage) await step.sleep(`people-reader-spacing-${attempt}`, 21000);
          result = await step.do(`read-people-${attempt}`, async () => {
            const current = await service.control();
            if (terminalResearchStates.includes(current.status) || service.now() >= current.deadline) throw new Error("Stopped before reading");
            try { return await directReader(url); }
            catch (error) { return { status: "failed", warning: providerFailure(error).message, deferred: error instanceof BrowserAdmissionDeferred }; }
          }, false);
          }
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
        if (result.deferred) {
          deferPage("Browser admission deferred; continue with a fresh request budget");
          break;
        }
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
          if (researchDomain(url) !== initial.config.companyDomain) {
            blockedDomains.add(researchDomain(url));
            runtime.remaining = runtime.remaining.filter(u => !blockedDomains.has(researchDomain(u)));
          }
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
        runtime.pendingPage = { url, page: { ...result.page, markdown: result.page.markdown.slice(0, 30000), observedAt: result.page.observedAt || new Date(service.now()).toISOString() } };
        let extractionDeferred: string | undefined;
        runtime.visited = uniqueResearchUrls([
          ...runtime.visited,
          sourceUrl,
        ]).slice(-1000);
        // Drop navigation runs and form scaffolding before the saved-page limit so evidence sections survive.
        const markdown = `${result.page.title ? `# ${result.page.title}\n\n` : ""}${stripBoilerplate(result.page.markdown, { keepImages: true })}`.slice(0, 24000);
        runtime.remaining = orderResearchQueue(
          [
            ...runtime.remaining,
            ...(initial.config.purpose === "firmographics" ? companyFactLinks(markdown, sourceUrl, initial.config, runtime.visited) : initial.config.purpose === "people" ? peopleFollowUpLinks(markdown, sourceUrl, runtime.visited, initial.config) : followUpLinks(
              markdown,
              sourceUrl,
              initial.config.searchTerms,
              runtime.visited,
              { external: directorySource(sourceUrl, markdown) },
            )),
          ],
          runtime.visited,
        ).slice(0, 1000);
        let findings: ResearchPage["findings"] = [];
        const directPeople = initial.config.purpose === "people" || initial.config.purpose === "firmographics" ? validatePeopleFindings([], markdown, sourceUrl, initial.config) : [];
        if (initial.config.purpose === "firmographics") {
          findings = observedCompanyFacts(markdown, sourceUrl, initial.config);
          if (initial.config.mode === "automatic" && researchDomain(sourceUrl) === initial.config.companyDomain && !ownCompany(collected, sourceUrl) && modelCalls < budget.maxModelCalls) {
            modelCalls++;
            await publish("extracting", "Checking company identity and products alongside company details");
            try {
              const business = await step.do(`company-identity-${attempt}`, async () => {
                const current = await service.control();
                if (terminalResearchStates.includes(current.status) || service.now() >= current.deadline) return { findings: [], deferred: current.stopReason || "Time limit reached" };
                return { findings: validateBusinessFindings(await service.extract(businessPrompt(markdown, initial.config.searchTerms, sourceUrl, false, initial.config)), markdown, sourceUrl, initial.config) };
              }, false);
              findings.push(...business.findings);
              if (business.deferred) { extractionDeferred = business.deferred; modelCalls--; }
            } catch { warnings.push("Company identity extraction unavailable; directly observed facts retained"); }
          }
          // A labelled count is preferred. Otherwise the model may locate a statement on an
          // identity-matched page; the statement is re-derived verbatim before it is kept.
          const diagnostics = companyFactDiagnostics(markdown, sourceUrl, initial.config);
          if (!extractionDeferred && !findings.some(f => f.kind === "headcount") && diagnostics.eligibleSource && diagnostics.employmentLanguage && service.extractHeadcount && modelCalls < budget.maxModelCalls) {
            modelCalls++;
            await publish("extracting", `Checking ${new URL(sourceUrl).hostname} for a stated headcount`);
            try {
              const located = await step.do(`headcount-${attempt}`, async () => {
                const current = await service.control();
                if (terminalResearchStates.includes(current.status) || service.now() >= current.deadline) return { finding: null, deferred: current.stopReason || "Time limit reached" };
                return { finding: modelHeadcountFinding(await service.extractHeadcount!(companyHeadcountPrompt(markdown, sourceUrl, initial.config)), markdown, sourceUrl, initial.config) };
              }, false);
              trace("headcount_model_result", { source: source(sourceUrl), accepted: Boolean(located.finding) });
              if (located.finding) findings.push(located.finding);
              if (located.deferred) { extractionDeferred = located.deferred; modelCalls--; }
            } catch { warnings.push("Headcount extraction unavailable; labelled facts retained"); }
          }
          // Named leaders and published work emails on pages already read are kept; deeper people research is queued only for remaining gaps.
          findings = [...directPeople.filter(f => f.kind === "person"), ...findings];
          trace("extraction_result", { source: source(sourceUrl), method: "observed_company_facts", accepted: findings.length, kinds: findings.map(f => f.kind), headcountFound: findings.some(f => f.kind === "headcount"), people: directPeople.filter(f => f.kind === "person").length, ...companyFactDiagnostics(markdown, sourceUrl, initial.config), reason: findings.length ? "supported_facts" : "no_supported_company_fact_pattern" });
          entry.reason = `${findings.length} sourced company facts${directPeople.some(f => f.kind === "person") ? " including named leaders" : ""}; estimates and scope require review`;
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
                return { findings: [], warning: "Extraction deferred", deferred: current.stopReason || "Time limit reached" };
              try {
                const peopleConfig = { ...current.config, legalEntity: collected.find(f => f.kind === "identifier" && f.name === "Legal entity")?.value || current.config.legalEntity };
                const raw = await service.extract(initial.config.purpose === "people" ? peoplePrompt(markdown, sourceUrl, peopleConfig) : initial.config.workflow === "business" ? businessPrompt(markdown, initial.config.searchTerms, sourceUrl, Boolean(initial.config.findPeople), initial.config) : extractionPrompt(markdown, initial.config.searchTerms, sourceUrl));
                const rejected: Record<string, number> = {};
                const accepted = (initial.config.purpose === "people" ? (input: unknown, markdown: string, source: string) => validatePeopleFindings(input, markdown, source, peopleConfig, reason => { rejected[reason] = (rejected[reason] || 0) + 1; }) : initial.config.workflow === "business" ? (input: unknown, markdown: string, source: string) => validateBusinessFindings(input, markdown, source, current.config) : validateFindings)(
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
          if (extracted.deferred) { extractionDeferred = extracted.deferred; modelCalls--; }
          if (extracted.warning) warnings.push(extracted.warning);
          entry.reason =
            extracted.warning ||
            (initial.config.purpose === "people" ? `${findings.filter(f => f.kind === "person").length} sourced people leads${findings.some(f => f.kind === "identifier") ? "; legal operator identified" : ""}; role currency and email remain unverified` : `${findings.length} supported claims; financial fit remains unknown`);
        } else { entry.reason = "Read without AI extraction (model limit)"; }
        if (extractionDeferred) {
          deferPage(`${extractionDeferred}; page retained for extraction`);
          break;
        }
        delete runtime.pendingPage;
        if (initial.config.purpose === "people") {
          findings.push(...observedCompanyFacts(markdown, sourceUrl, initial.config));
          // Keep directly observed team evidence even when the model failed or its allowance ended.
          findings.push(...directPeople.filter(f=>!findings.some(v=>v.kind===f.kind && v.name===f.name && v.value===f.value)));
        }
        const catalogue = initial.config.purpose ? [] : [...statedSupplyFindings(markdown, sourceUrl, initial.config.searchTerms), ...catalogueProductFindings(markdown, sourceUrl, initial.config.searchTerms)]
          .filter(c => !findings.some(f => f.kind === c.kind && f.value === c.value));
        // Relevant product evidence must belong to a business; take the identity from the site heading when the model omitted it.
        if (!initial.config.purpose && !ownCompany(findings, sourceUrl) && findings.some(f => ["product", "capability", "customer"].includes(f.kind))) {
          const heading = headingCompanyFinding(markdown, sourceUrl);
          if (heading) findings = [heading, ...findings];
        }
        findings = [...findings, ...catalogue].slice(0, initial.config.purpose === "firmographics" ? 12 : 4);
        if (catalogue.length) entry.reason = `${findings.length} supported claims including directly observed website evidence; financial fit remains unknown`;
        const learnedLegalEntity = findings.some(f => f.kind === "identifier" && f.name === "Legal entity") && !collected.some(f => f.kind === "identifier" && f.name === "Legal entity");
        collected.push(...findings);
        // A newly evidenced operator unlocks a different directory/search ladder.
        if (learnedLegalEntity && initial.config.purpose === "people" && (fieldSearches.people || 0) < MAX_TARGETED_SEARCHES.people) {
          exhaustedFields.delete("people");
          followup.searchesExhausted = !service.targetedSearch || !availableField();
        }
        // A website whose pages have produced no company or product evidence by the cap is dropped for this job.
        if (!initial.config.purpose && perDomainCap !== Infinity && attemptsOn(researchDomain(url)) >= perDomainCap && !collected.some(f => ["company", "product", "capability", "customer"].includes(f.kind) && researchDomain(publicResearchUrl(f.website) || sourceUrl) === researchDomain(sourceUrl))) {
          runtime.remaining = runtime.remaining.filter(u => researchDomain(u) !== researchDomain(sourceUrl));
        }
        const observedAt = await step.do(`observed-${attempt}`, async () =>
          result.page?.observedAt || new Date(service.now()).toISOString(),
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
        if (initial.config.discoveryCandidate && ownCompany(findings, sourceUrl) && relevantBusiness(findings)) {
          await publish("complete", "Business identified; company details and people research queued");
          return;
        }
      } catch (error) {
        if (error instanceof BrowserAdmissionDeferred) {
          deferPage(error.message.startsWith("Worker request budget reached") ? error.message : "Browser admission deferred; saved page and remaining sources retained");
          break;
        }
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
    if (initial.config.mode === "automatic" && initial.config.purpose && fieldFound()) {
      trace("run_finished", { pages, modelCalls, reason: "requested_evidence_found", purpose: initial.config.purpose });
      await publish("complete", initial.config.purpose === "people" ? "Sourced owner or director candidate and published email found; verify ownership and sale authority before outreach." : "Sourced headcount and revenue found; company evidence is ready for review.");
      return;
    }
    if (await finishAtGoal("final-goal")) return;
    if (initial.config.parallelDiscovery) {
      await publish(discovered.more ? "partial" : "complete", discovered.more ? "More website searches remain; candidate businesses are being researched in parallel" : "Website searches finished; candidate businesses are being researched in parallel");
      return;
    }
    const goal = await goalProgress("final-count");
    if (goal) warnings.push(`${goal.count} of ${goal.target} new businesses found — ${runtime.remaining.length ? "research budget reached" : "available search results exhausted"}`);
    if (runtime.remaining.length)
      warnings.push(
        `${runtime.remaining.length} URLs remain; continue research with a fresh budget`,
      );
    if (initial.config.targetedFollowup && initial.config.purpose) for (const field of missingResearchFields(initial.config, collected)) warnings.push(`${fieldLabels[field]} remains unknown; available sources retained`);
    trace("run_finished", { pages, attempts: runtime.attempts.length, modelCalls, remaining: runtime.remaining.length, findings: collected.length, kinds: [...new Set(collected.map(f => f.kind))], reason: runtime.attempts.length >= budget.maxPages ? "page_budget_reached" : "sources_exhausted_or_followup_stopped" });
    if (!pages) warnings.push("No pages could be read");
    await publish(
      warnings.length ? "partial" : "complete",
      [
        `${pages} pages read across ${domains.size} websites.`,
        ...new Set(warnings),
      ].join(" "),
    );
  } catch (error) {
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
      error instanceof BrowserAdmissionDeferred || pages ? "partial" : "failed",
      error instanceof BrowserAdmissionDeferred ? (error.message.startsWith("Worker request budget reached") ? error.message : "Browser admission deferred; remaining research retained") : "Research interrupted; saved progress retained. Continue remaining URLs with a fresh budget.",
    );
  }
}
