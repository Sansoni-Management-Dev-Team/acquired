import { adaptiveDiscovery, retryDiscovery, resolveDiscoveryBatch, type DiscoveryContext } from "./adaptive-discovery";
import { providerFailure, BrowserAdmissionDeferred } from "./research-provider-error";
import { missingResearchFields, fieldLabels, fieldCompletionMessage, type ResearchField } from "./research-objectives";
import { ResearchAiError } from "./research-ai-error";
import { targetedPlan, resolveTargetedChoice, fallbackTargetedChoice, nextTargetedAction, MAX_TARGETED_SEARCHES, type TargetedPlan } from "./targeted-research";
import { stripBoilerplate } from "./page-content";
import { directorySource, serviceBusinessDomain, unreadableDiscoverySource } from "./discovery-sources";
import { unusablePage } from "./page-quality";
import { businessPrompt, headingCompanyFinding, ownCompany, relevantBusiness, validateBusinessFindings } from "./business-research";
import { companyHeadcountPrompt, companyFactDiagnostics, observedCompanyFacts, companyFactLinks, orderCompanyFactQueue, modelHeadcountFinding } from "./company-facts";
import { peoplePrompt, validatePeopleFindings, peopleFollowUpLinks, orderPeopleQueue } from "./people-research";
import { sitemapDocument, sitemapMarkdown, sitemapUrls } from "./sitemap";
import { observedCompanyIdentifiers, abnFollowUpLinks } from './company-identifiers';
import { prioritiseResearchPages } from './research-page-priority';
import { extractionFailureReason, recoveryExtractionPrompt } from './research-extraction-recovery';
import {
  researchPerformanceFlags,
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
  do<T>(name: string, run: (context?: { reservation?: string }) => Promise<T>, retry?: boolean): Promise<T>;
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
  fanoutPages?(urls: string[]): Promise<void>;
  pageLookahead?: boolean;
  discoveryBatch?: boolean;
  diagnostic?(event: Record<string, unknown>): void;
  control(): Promise<ResearchControl>;
  discoveryContext?(): Promise<DiscoveryContext>;
  planDiscovery?(context: DiscoveryContext): Promise<unknown>;
  prepareDiscoverySources?(): Promise<{ pending: boolean }>;
  persistDiscoverySources?(): Promise<{ pending: boolean }>;
  discover(decision?: unknown, reservation?: string): Promise<{ seeds: string[]; warning?: string; peopleLeadCount?: number; skipDomains?: string[]; more?: boolean }>;
  progress(event: {
    revision: number;
    status: string;
    pages: number;
    modelCalls: number;
    message: string;
    crawlId?: string | null;
    page?: ResearchPage;
    runtime?: ResearchRuntime;
    enrichmentPendingFields?: ResearchField[];
    targetedSearchDeferred?: boolean;
    followupPlannerUsed?: boolean;
    followupExhaustedFields?: ResearchField[];
    followupSearchCounts?: Partial<Record<ResearchField, number>>;
    followupEmptySearchCounts?: Partial<Record<ResearchField, number>>;
  }): Promise<void>;
  submit(url: string): Promise<string>;
  poll(
    id: string,
  ): Promise<{
    status: string;
    page?: { url: string; markdown: string; title?: string; observedAt?: string };
    warning?: string;
    deferred?: boolean;
    retryAfterMs?: number;
  }>;
  cancel(id: string): Promise<void>;
  extract(messages: ReturnType<typeof extractionPrompt>): Promise<unknown>;
  extractHeadcount?(messages: ReturnType<typeof companyHeadcountPrompt>): Promise<unknown>;
  readPeoplePage?(url: string, reservation?: string): Promise<{ status: string; page?: { url: string; markdown: string; title?: string; observedAt?: string }; warning?: string }>;
  cachedPage?(url: string): Promise<Awaited<ReturnType<ResearchServices["poll"]>> | null>;
  readPage?(url: string, reservation?: string): ReturnType<ResearchServices["poll"]>;
  readSiteFile?(url: string, reservation?: string): ReturnType<ResearchServices["poll"]>;
  readFallbackPage?(url: string, reservation?: string): ReturnType<ResearchServices["poll"]>;
  peopleFollowup?(reservation?: string): Promise<{ seeds: string[]; legalEntity?: string; warning?: string }>;
  planFollowup?(plan: TargetedPlan): Promise<unknown>;
  targetedSearch?(field: ResearchField, round: number, reservation?: string): Promise<{ seeds: string[]; findings?: ResearchPage['findings']; warning?: string; exhausted?: boolean; failed?: boolean; retryable?: boolean; deferred?: boolean; retryAfterMs?: number }>;
  now(): number;
}
export async function runResearch(
  step: ResearchSteps,
  service: ResearchServices,
) {
  const permitArgs = (context?: { reservation?: string }): [] | [string] => context?.reservation ? [context.reservation] : [];
  let revision = 0,
    pages = 0,
    modelCalls = 0,
    activeCrawl: string | null = null;
  const warnings: string[] = [];
  // Diagnostics contain source locations and counts, never page text or model output.
  const source = (value: string) => { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return "invalid_url"; } };
  const trace = (event: string, details: Record<string, unknown>) => service.diagnostic?.({ event, ...details });
  let targetedSearchDeferred = false;
  let enrichmentPendingFields: ResearchField[] | undefined;
  let followupCheckpoint: (() => { followupPlannerUsed: boolean; followupExhaustedFields: ResearchField[]; followupSearchCounts: Partial<Record<ResearchField, number>>; followupEmptySearchCounts: Partial<Record<ResearchField, number>> }) | undefined;
  let runtime: ResearchRuntime = { remaining: [], visited: [], attempts: [] };
  let lastPublishAt = service.now();
  let coalesceProgress = false;
  // A host that returns no readable content is skipped for the rest of the job.
  const blockedDomains = new Set<string>();
  const publish = async (
    status: string,
    message: string,
    page?: ResearchPage,
  ) => {
    if (status === "complete") targetedSearchDeferred = false;
    const event = {
      targetedSearchDeferred,
      revision: ++revision,
      status,
      pages,
      modelCalls,
      message: message.slice(0, 1000),
      crawlId: activeCrawl,
      runtime: structuredClone(runtime),
      ...(page ? { page } : {}),
      ...(enrichmentPendingFields ? { enrichmentPendingFields: [...enrichmentPendingFields] } : {}),
      ...(followupCheckpoint ? followupCheckpoint() : {}),
    };
    await step.do(`progress-${revision}`, () => service.progress(event));
    lastPublishAt = service.now();
  };
  // Intermediate status text is a liveness heartbeat, not an event: it is
  // saved only when the last saved progress is older than the configured interval. Pages,
  // failures and terminal states always publish.
  const heartbeat = async (status: string, message: string) => {
    // Persist liveness at most once a minute. Control/cancellation checks run
    // independently before external work; frequent UI status saves do not make
    // those checks safer and multiply writes during admission/search waits.
    if (service.now() - lastPublishAt >= (coalesceProgress ? 60000 : 60001)) await publish(status, message);
  };
  const check = async (label: string) =>
    step.do(`control-${label}`, async () => {
      const data = await service.control();
      return { ...data, expired: service.now() >= data.deadline };
    });
  let activeSitemap: Promise<string[]> | undefined;
  let sitemapQueueMerge: ((links: string[]) => void | Promise<void>) | undefined;
  const settleSitemap = async () => {
    const pending = activeSitemap;
    const merge = sitemapQueueMerge;
    activeSitemap = undefined;
    sitemapQueueMerge = undefined;
    const links = pending ? await pending : [];
    await merge?.(links);
    return links;
  };
  let lookahead: { url: string; result: Promise<Awaited<ReturnType<ResearchServices["poll"]>>> } | undefined;
  // Always join speculative work before publishing/returning. This both avoids
  // dangling provider calls and makes checkpoint contents deterministic on replay.
  const settleLookahead = async () => {
    if (!lookahead) return;
    const result = await lookahead.result;
    if (result.status === "completed" && result.page && !unusablePage(result.page.markdown)) {
      runtime.bufferedPage = { url: lookahead.url, page: { ...result.page, markdown: result.page.markdown.slice(0, 30000), observedAt: result.page.observedAt || new Date(service.now()).toISOString() } };
    }
  };
  const discardLookahead = async () => {
    if (!lookahead) return;
    await settleLookahead();
    const result = await lookahead.result;
    // Even an unused read consumes this batch's page allowance. Its content is
    // retained separately from extracted pages for a subsequent continuation.
    runtime.attempts.push({ url: lookahead.url, status: result.page ? "read" : "pending", reason: "Lookahead read retained without extraction" });
    if (result.status === "completed" && result.page) pages++;
    trace("lookahead_retained", { source: source(lookahead.url), status: result.status, pages, attempts: runtime.attempts.length });
    lookahead = undefined;
  };
  try {
    const initial = await check("start");
    coalesceProgress = researchPerformanceFlags(initial.config).progressCoalescing;
    targetedSearchDeferred = Boolean(initial.config.targetedSearchDeferred);
    if (terminalResearchStates.includes(initial.status)) return;
    runtime = {
      remaining: initial.config.parallelDiscovery ? [] : [...(initial.config.runtime?.remaining || initial.seeds)],
      visited: [...(initial.config.runtime?.visited || [])],
      attempts: [],
      ...(initial.config.runtime?.pendingPage ? { pendingPage: initial.config.runtime.pendingPage } : {}),
      ...(initial.config.runtime?.bufferedPage ? { bufferedPage: initial.config.runtime.bufferedPage } : {}),
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
    if (initial.config.discover && initial.config.workflow === "business" && !initial.config.purpose && service.prepareDiscoverySources && service.persistDiscoverySources) {
      let sourceState = await step.do("discovery-sources", () => service.prepareDiscoverySources!());
      for (let batch = 0; sourceState.pending && batch < 20; batch++) {
        const current = await check(`discovery-persist-${batch}`);
        if (terminalResearchStates.includes(current.status)) return;
        if (current.expired) break;
        sourceState = await step.do(`discovery-persist-${batch}`, () => service.persistDiscoverySources!());
      }
      if (sourceState.pending) {
        await publish("partial", "Discovery candidates saved; remaining candidates will continue in the next run");
        return;
      }
    }
    const discoverRound = async (round: number) => {
      let decision: unknown;
      let attemptIndex: number | undefined;
      let batchContext: DiscoveryContext | undefined;
      if (adaptiveDiscovery(initial.config) && service.discoveryContext && service.planDiscovery) {
        const context = await step.do(`discovery-context-${round}`, () => service.discoveryContext!());
        attemptIndex = context.attempts.length;
        batchContext = context;
        if (context.remainingSearches > 0 && context.found < context.target && !retryDiscovery(context.attempts) && modelCalls < initial.config.budget.maxModelCalls) {
          const current = await check(`discovery-plan-${round}`);
          if (terminalResearchStates.includes(current.status) || current.expired) return { seeds: [], more: true };
          modelCalls++;
          try { decision = await step.do(`discovery-plan-${round}`, () => service.planDiscovery!(context), false); }
          catch (error) {
            if (error instanceof BrowserAdmissionDeferred) { modelCalls--; return { seeds: [], more: true }; }
            warnings.push("AI search planner unavailable; using scope-based searches");
          }
          await heartbeat("discovering", "Adapting search strategy from research results");
        }
      }
      if (service.discoveryBatch && batchContext) {
        const fallback = (batchContext.startingTerms.length ? batchContext.startingTerms : [batchContext.scope]).flatMap(term => batchContext!.regions.map(region => `${term} ${region}`));
        const batch = resolveDiscoveryBatch(decision, batchContext, fallback);
        if (batch.queries.length) {
          const startedAt = service.now();
          const settled = await Promise.allSettled(batch.queries.map(query => step.do(`discover-${round}-${query.queryId}`, context => service.discover(query, ...permitArgs(context)), false)));
          const results = settled.map(result => result.status === "fulfilled" ? result.value : { seeds: [], more: true, warning: "Discovery query failed; other batch results retained" });
          trace("discovery_batch", { round, queries: batch.queries.length, queryIds: batch.queries.map(query => query.queryId), durationMs: Math.max(0, service.now() - startedAt) });
          return { seeds: uniqueResearchUrls(results.flatMap(result => result.seeds)), warning: results.map(result => result.warning).filter(Boolean).join("; ") || undefined, more: results.some(result => result.more), skipDomains: [...new Set(results.flatMap(result => result.skipDomains || []))], peopleLeadCount: results.reduce((total, result) => total + (result.peopleLeadCount || 0), 0) };
        }
      }
      return step.do(round ? `discover-${round}` : "discover", (context) => service.discover(attemptIndex === undefined ? undefined : { planning: decision, attemptIndex }, ...permitArgs(context)));
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
      if (!initial.config.targetBusinesses || initial.config.purpose || initial.config.researchTask) return null;
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
    const sitemapChecked = new Set<string>();
    // Site files are static text: the run cache is consulted before any provider
    // admission so a second job on the same website never waits for a slot.
    const readSite = async (label: string, url: string) => {
      const cached = service.cachedPage ? await step.do(`cached-site-${label}`, () => service.cachedPage!(url), false) : null;
      return cached || step.do(`read-site-${label}`, async context => {
        const current = await service.control();
        if (terminalResearchStates.includes(current.status) || service.now() >= current.deadline) return { status: "failed", warning: "Site discovery stopped before reading" };
        return service.readSiteFile!(url, ...permitArgs(context));
      }, false);
    };
    const discoverSitemap = async (sourceUrl: string, attempt: number) => {
      if (!service.readSiteFile) return [];
      const domain = researchDomain(sourceUrl);
      if (sitemapChecked.has(domain)) return [];
      sitemapChecked.add(domain);
      const origin = new URL(sourceUrl).origin;
      const documents: string[] = [];
      const pages: string[] = [];
      try {
        const robotsUrl = new URL("/robots.txt", origin).href;
        const robots = await readSite(`robots-${attempt}`, robotsUrl);
        if (robots.status === "completed" && robots.page) documents.push(...sitemapUrls(robots.page.markdown, sourceUrl).filter(sitemapDocument));
      } catch { /* Missing or blocked robots.txt falls back to conventional sitemap paths. */ }
      if (!documents.length) documents.push(new URL("/sitemap.xml", origin).href);
      const seen = new Set<string>();
      const documentLimit = initial.config.researchTask === 'website' ? 20 : 3;
      for (let index = 0; index < documents.length && seen.size < documentLimit; index++) {
        const document = documents[index];
        if (seen.has(document)) continue;
        seen.add(document);
        try {
          const result = await readSite(`sitemap-${attempt}-${seen.size}`, document);
          if (result.status !== "completed" || !result.page) continue;
          const urls = sitemapUrls(result.page.markdown, sourceUrl);
          pages.push(...urls.filter(url => !sitemapDocument(url)));
          documents.push(...urls.filter(sitemapDocument));
        } catch { /* A missing sitemap must not prevent ordinary page research. */ }
      }
      const unique = uniqueResearchUrls(pages).slice(0, 500);
      trace("sitemap_discovery", { source: origin, documents: seen.size, urls: unique.length });
      return unique;
    };
    let priorityUrl: string | undefined;
    const collected: ResearchPage["findings"] = [...(initial.findings || []), ...(initial.config.inheritedFindings || [])].filter((finding, index, all) => all.findIndex(other => other.kind === finding.kind && other.name === finding.name && other.value === finding.value && other.website === finding.website) === index);
    if (initial.config.enrichmentPhase) enrichmentPendingFields = missingResearchFields(initial.config, collected);
    let peopleFollowupAttempted = Boolean(initial.config.peopleFollowupStarted || initial.config.targetedFollowup);
    // Missing-field follow-up runs in rounds: reading a page never consumes the
    // external search, and searching continues until evidence is found, the
    // query ladder is exhausted, or the page budget ends.
    const MAX_FOLLOWUP_ROUNDS = 28;
    const followup = { rounds: 0, searches: 0, afterAttempt: -1, readsSinceSearch: 0, searchesExhausted: !service.targetedSearch, plannerUsed: Boolean(initial.config.followupPlannerUsed) };
    const exhaustedFields = new Set<ResearchField>(initial.config.followupExhaustedFields || []);
    const fieldSearches: Partial<Record<ResearchField, number>> = { ...initial.config.followupSearchCounts };
    const fieldFailures: Partial<Record<ResearchField, number>> = {};
    const emptyFieldSearches: Partial<Record<ResearchField, number>> = { ...initial.config.followupEmptySearchCounts };
    if (initial.config.targetedFollowup) followupCheckpoint = () => ({ followupPlannerUsed: followup.plannerUsed, followupExhaustedFields: [...exhaustedFields], followupSearchCounts: { ...fieldSearches }, followupEmptySearchCounts: { ...emptyFieldSearches } });
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
          await heartbeat("extracting", `Researching the remaining gap: ${plan.missing}`);
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
              // Capacity contention is not a search outcome. Retry this same
              // semantic query a bounded number of times with distinct durable
              // step names, preserving all page/model/query allowances.
              const MAX_CAPACITY_RETRIES = 3;
              let result: Awaited<ReturnType<NonNullable<ResearchServices["targetedSearch"]>>> | undefined;
              for (let capacityRetry = 0; capacityRetry <= MAX_CAPACITY_RETRIES; capacityRetry++) {
                if (capacityRetry) {
                  const resumed = await check(`targeted-capacity-retry-${round}-${capacityRetry}`);
                  if (terminalResearchStates.includes(resumed.status)) return;
                  if (resumed.expired) {
                    await publish("partial", resumed.stopReason || "Time limit reached while waiting for targeted search capacity; remaining research retained");
                    return;
                  }
                }
                const label = capacityRetry ? `targeted-search-${round}-capacity-${capacityRetry}` : `targeted-search-${round}`;
                result = await step.do(label, context => service.targetedSearch!(field, round, ...permitArgs(context)), false).catch(error => {
                  if (error instanceof BrowserAdmissionDeferred) return { seeds: [], deferred: true, retryable: true, retryAfterMs: 3000, warning: error.message };
                  throw error;
                });
                if (!result.deferred) { targetedSearchDeferred = false; break; }
                trace("targeted_search_capacity_deferred", { field, round, capacityRetry, retryAfterMs: result.retryAfterMs, reason: "capacity_contention" });
                const waiting = await check(`targeted-capacity-wait-${round}-${capacityRetry}`);
                if (terminalResearchStates.includes(waiting.status)) return;
                if (waiting.expired) {
                  await publish("partial", waiting.stopReason || "Time limit reached while waiting for targeted search capacity; remaining research retained");
                  return;
                }
                if (capacityRetry === MAX_CAPACITY_RETRIES || result.warning?.startsWith("Worker request budget reached")) {
                  targetedSearchDeferred = true;
                  await publish("partial", result.warning?.startsWith("Worker request budget reached") ? result.warning : "Browser admission deferred; targeted search capacity remains busy; retry remaining research");
                  return;
                }
                const requestedWait = Number.isFinite(result.retryAfterMs) ? result.retryAfterMs! : 3000;
                await heartbeat("extracting", `Waiting for targeted search capacity for ${fieldLabels[field]}`);
                const waitMs = Math.min(Math.max(1000, requestedWait), 15000, Math.max(0, waiting.deadline - service.now()));
                if (waitMs <= 0) {
                  await publish("partial", waiting.stopReason || "Time limit reached while waiting for targeted search capacity; remaining research retained");
                  return;
                }
                await step.sleep(`wait-targeted-capacity-${round}-${capacityRetry}`, waitMs);
              }
              if (!result || result.deferred) throw new BrowserAdmissionDeferred("Targeted search capacity deferred");
              // A sibling website/page job may have sourced this objective since
              // our initial control snapshot. Reuse its validated DB evidence.
              if (result.findings) {
                collected.push(...result.findings);
                if (initial.config.enrichmentPhase) enrichmentPendingFields = missingResearchFields(initial.config, collected);
              }
              const knownSources = new Set([...runtime.visited, ...runtime.remaining].map(researchUrlKey));
              const newSources = uniqueResearchUrls(result.seeds).filter(seed => !knownSources.has(researchUrlKey(seed))).length;
              trace("targeted_search_result", { round, field, seeds: result.seeds.length, exhausted: Boolean(result.exhausted), sources: result.seeds.slice(0, 20).map(source), warning: Boolean(result.warning) });
              runtime.remaining = uniqueResearchUrls([...result.seeds, ...runtime.remaining]);
              if (result.warning) warnings.push(result.warning);
              if (result.failed) fieldFailures[field] = (fieldFailures[field] || 0) + 1;
              else {
                fieldSearches[field] = (fieldSearches[field] || 0) + 1;
                emptyFieldSearches[field] = newSources ? 0 : (emptyFieldSearches[field] || 0) + 1;
                const limit = initial.config.enrichmentPhase === "deep" ? initial.config.diminishingReturnsSearches : undefined;
                if (limit && (emptyFieldSearches[field] || 0) >= Math.max(2, limit)) {
                  exhaustedFields.add(field);
                  warnings.push(`${fieldLabels[field]} deferred after ${emptyFieldSearches[field]} successful searches returned no new sources; evidence remains pending`);
                  trace("field_research_deferred", { field, reason: "diminishing_returns", successfulEmptySearches: emptyFieldSearches[field], providerFailures: fieldFailures[field] || 0, newSources });
                }
              }
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
        const followup = await step.do("people-followup", (context) => service.peopleFollowup!(...permitArgs(context)), false);
        if (followup.warning) warnings.push(followup.warning);
        runtime.remaining = uniqueResearchUrls([...followup.seeds, ...runtime.remaining]).slice(0, 1000);
      }
      const beforeOrder = [...runtime.remaining];
      runtime.remaining = orderResearchQueue(runtime.remaining,runtime.visited,initial.config.strategy,runtime.attempts.map(a=>a.url));
      // Discovery never re-reads businesses already attached to the mandate.
      if (!initial.config.purpose) runtime.remaining = runtime.remaining.filter(u => !skipDomains.has(researchDomain(u)) && !unreadableDiscoverySource(u) && !serviceBusinessDomain(u));
      if (initial.config.discoveryCandidate && !directorySource(initial.seeds[0] || "")) runtime.remaining = runtime.remaining.filter(u => researchDomain(u) === initial.config.companyDomain);
      if (initial.config.purpose === "people") runtime.remaining = orderPeopleQueue(runtime.remaining, runtime.visited, initial.config.companyDomain!);
      if (initial.config.purpose === "firmographics") runtime.remaining = (initial.config.researchField === 'abn' ? runtime.remaining.filter(u => publicResearchUrl(u)) : orderCompanyFactQueue(runtime.remaining, initial.config)).filter(u => !blockedDomains.has(researchDomain(u)));
      trace("source_queue", { before: beforeOrder.length, after: runtime.remaining.length, excluded: beforeOrder.filter(u => !runtime.remaining.includes(u)).slice(0, 20).map(source), next: runtime.remaining.slice(0, 5).map(source), reason: "visited_and_purpose_source_filters" });
      if (priorityUrl) {
        runtime.remaining = [priorityUrl, ...runtime.remaining.filter(u=>u!==priorityUrl)];
        priorityUrl = undefined;
      }
      // Consume the already reserved read before opening another page slot. The
      // follow-up decision still persists new sources for subsequent iterations.
      if (lookahead && runtime.remaining.includes(lookahead.url)) runtime.remaining = [lookahead.url, ...runtime.remaining.filter(u => u !== lookahead!.url)];
      else if (lookahead) {
        await discardLookahead();
        if (runtime.attempts.length >= budget.maxPages) break;
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
      // The first page announces the wait; later pages only refresh liveness.
      if (attempt === 1 && !coalesceProgress) await publish("crawling", `Waiting for browser slot — website ${domains.size}, page attempt ${attempt} of ${budget.maxPages}`);
      else await heartbeat("crawling", `Waiting for browser slot — website ${domains.size}, page attempt ${attempt} of ${budget.maxPages}`);
      try {
        let result: Awaited<ReturnType<ResearchServices["poll"]>> | undefined;
        const directReader = service.readPage || (["people", "firmographics"].includes(initial.config.purpose || "") ? service.readPeoplePage : undefined);
        if (runtime.pendingPage?.url === url) {
          result = { status: "completed", page: runtime.pendingPage.page };
        } else if (lookahead?.url === url) {
          result = await lookahead.result;
          lookahead = undefined;
          delete runtime.bufferedPage;
          trace("lookahead_consumed", { source: source(url), attempt });
        } else if (runtime.bufferedPage?.url === url) {
          result = { status: "completed", page: runtime.bufferedPage.page };
          delete runtime.bufferedPage;
        } else if (directReader) {
          result = service.cachedPage ? await step.do(`cached-read-${attempt}`, () => service.cachedPage!(url), false) || undefined : undefined;
          if (!result) {
          if (!service.readPage) await step.sleep(`people-reader-spacing-${attempt}`, 21000);
          result = await step.do(`read-people-${attempt}`, async (context) => {
            const current = await service.control();
            if (terminalResearchStates.includes(current.status) || service.now() >= current.deadline) throw new Error("Stopped before reading");
            try { return await directReader(url, ...permitArgs(context)); }
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
            result = await step.do(`fallback-${attempt}`, (context) => service.readFallbackPage!(url, ...permitArgs(context)), false);
            trace("fallback_result", { source: source(url), status: result.status, deferred: Boolean(result.deferred) });
          }
        }
        if (result.deferred) {
          const current = await check(`fallback-wait-${attempt}`);
          if (terminalResearchStates.includes(current.status)) return;
          const waitMs = Math.min(result.retryAfterMs || 3000, 60000, Math.max(0, current.deadline - service.now()));
          if (waitMs > 0) await step.sleep(`fallback-backoff-${attempt}`, waitMs);
          deferPage("Fallback reader admission deferred; continue with a fresh request budget");
          break;
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
        // Broad search coordination preserves its request budget. A bounded candidate
        // investigation and its paired company/people enrichment use the sitemap.
      const firstParty = Boolean(initial.config.researchTask !== 'page' && initial.config.researchTask !== 'field' && (initial.config.purpose || initial.config.discoveryCandidate) && initial.config.companyDomain && researchDomain(sourceUrl) === initial.config.companyDomain);
        // Static site discovery and page extraction are independent. Keep its
        // result buffered until the serial queue merge below.
        const siteDiscovery = firstParty ? discoverSitemap(sourceUrl, attempt) : Promise.resolve<string[]>([]);
        const sitemapTask = initial.config.researchTask === 'website' ? siteDiscovery.then(async links => {
          if (initial.config.researchTask === 'website' && service.fanoutPages) {
            const navigation = followUpLinks(result.page!.markdown, sourceUrl, initial.config.searchTerms, runtime.visited);
            const urls = prioritiseResearchPages([...navigation, ...links]).filter(url => researchDomain(url) === initial.config.companyDomain && researchUrlKey(url) !== researchUrlKey(sourceUrl)).slice(0, 1000);
            // Start page Workflows while homepage extraction is still running.
            await step.do(`fanout-pages-${attempt}`, () => service.fanoutPages!(urls));
          }
          return links;
        }) : siteDiscovery;
        activeSitemap = sitemapTask;
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
        const queuePageLinks = (navigation: string) => { runtime.remaining = orderResearchQueue(
          [
            ...runtime.remaining,
            ...(initial.config.purpose === "firmographics" ? companyFactLinks(navigation, sourceUrl, initial.config, runtime.visited) : initial.config.purpose === "people" ? peopleFollowUpLinks(navigation, sourceUrl, runtime.visited, initial.config) : followUpLinks(
              navigation,
              sourceUrl,
              initial.config.searchTerms,
              runtime.visited,
              { external: directorySource(sourceUrl, markdown) },
            )),
          ],
          runtime.visited,
        ).slice(0, 1000); };
        if (initial.config.researchTask !== 'page') queuePageLinks(markdown);
        if (initial.config.researchField === 'abn' && initial.config.companyDomain) runtime.remaining = uniqueResearchUrls([...abnFollowUpLinks(markdown, sourceUrl, initial.config.companyDomain), ...runtime.remaining]).filter(url => !runtime.visited.some(v => researchUrlKey(v) === researchUrlKey(url))).slice(0, 1000);
        sitemapQueueMerge = async links => {
          if (initial.config.researchTask === 'website' && service.fanoutPages) {
            runtime.remaining = [];
          } else if (links.length && initial.config.researchTask !== 'page') queuePageLinks(`${markdown}\n${sitemapMarkdown(links)}`);
        };
        let findings: ResearchPage["findings"] = [];
        const directPeople = initial.config.purpose === "people" || initial.config.purpose === "firmographics" ? validatePeopleFindings([], markdown, sourceUrl, initial.config) : [];
        const directIdentity = initial.config.purpose === "firmographics" ? headingCompanyFinding(markdown, sourceUrl) : null;
        const directlyObserved = initial.config.purpose === "firmographics" ? [...observedCompanyFacts(markdown, sourceUrl, initial.config), ...observedCompanyIdentifiers(markdown, sourceUrl, initial.config)] : directPeople;
        if (directIdentity && !ownCompany([...collected, ...directlyObserved], sourceUrl)) directlyObserved.push(directIdentity);
        // One known, same-company page may read while this page's AI runs. No
        // extraction, queue writes or second same-host read runs concurrently.
        const needsModel = initial.config.purpose === "firmographics"
          ? (initial.config.mode === "automatic" && !ownCompany([...collected, ...directlyObserved], sourceUrl)) || Boolean(service.extractHeadcount && ![...collected, ...directlyObserved].some(f => f.kind === "headcount") && companyFactDiagnostics(markdown, sourceUrl, initial.config).employmentLanguage)
          : initial.config.purpose === "people" ? !directPeople.some(f => f.kind === "person") : Boolean(initial.config.discoveryCandidate && initial.config.workflow === "business");
        if (service.pageLookahead && service.readPage && !lookahead && needsModel && modelCalls < budget.maxModelCalls && runtime.attempts.length < budget.maxPages && (!initial.config.purpose || missingResearchFields(initial.config, [...collected, ...directlyObserved]).length)) {
          const ordered = initial.config.purpose === "firmographics" ? orderCompanyFactQueue(runtime.remaining, initial.config) : initial.config.purpose === "people" ? orderPeopleQueue(runtime.remaining, runtime.visited, initial.config.companyDomain!) : orderResearchQueue(runtime.remaining, runtime.visited, initial.config.strategy, runtime.attempts.map(a => a.url));
          const nextUrl = ordered.find(next => researchDomain(next) === researchDomain(sourceUrl) && attemptsOn(researchDomain(next)) < perDomainCap && !blockedDomains.has(researchDomain(next)));
          if (nextUrl) {
            const startedAt = service.now();
            lookahead = { url: nextUrl, result: sitemapTask.then(() => step.do(`lookahead-read-${attempt + 1}`, async context => {
              const current = await service.control();
              if (terminalResearchStates.includes(current.status) || service.now() >= current.deadline) return { status: "failed", deferred: true, warning: "Stopped before lookahead read" };
              try { return await service.readPage!(nextUrl, ...permitArgs(context)); }
              catch (error) { return { status: "failed", warning: providerFailure(error).message, deferred: error instanceof BrowserAdmissionDeferred }; }
            }, false)).catch(error => ({ status: "failed", warning: providerFailure(error).message, deferred: error instanceof BrowserAdmissionDeferred })).then(result => {
              trace("lookahead_read", { source: source(nextUrl), status: result.status, durationMs: Math.max(0, service.now() - startedAt), deferred: Boolean(result.deferred) });
              return result;
            }) };
          }
        }
        if (initial.config.purpose === "firmographics") {
          findings = directlyObserved;
          if (!initial.config.researchField && initial.config.mode === "automatic" && researchDomain(sourceUrl) === initial.config.companyDomain && !ownCompany([...collected, ...findings], sourceUrl) && modelCalls < budget.maxModelCalls) {
            modelCalls++;
            await heartbeat("extracting", "Checking company identity and products alongside company details");
            try {
              const business = await step.do(`company-identity-${attempt}`, async () => {
                const current = await service.control();
                if (terminalResearchStates.includes(current.status) || service.now() >= current.deadline) return { findings: [], deferred: current.stopReason || "Time limit reached" };
                return { findings: validateBusinessFindings(await service.extract(businessPrompt(markdown, initial.config.searchTerms, sourceUrl, false, initial.config)), markdown, sourceUrl, initial.config) };
              }, false);
              findings.push(...business.findings);
              if (business.deferred) { extractionDeferred = business.deferred; modelCalls--; }
            } catch (error) {
              if (error instanceof BrowserAdmissionDeferred) { extractionDeferred = error.message; modelCalls--; }
              else warnings.push("Company identity extraction unavailable; directly observed facts retained");
            }
          }
          // A labelled count is preferred. Otherwise the model may locate a statement on an
          // identity-matched page; the statement is re-derived verbatim before it is kept.
          const diagnostics = companyFactDiagnostics(markdown, sourceUrl, initial.config);
          if ((!initial.config.researchField || initial.config.researchField === 'size') && !extractionDeferred && ![...collected, ...findings].some(f => f.kind === "headcount") && diagnostics.eligibleSource && diagnostics.employmentLanguage && service.extractHeadcount && modelCalls < budget.maxModelCalls) {
            modelCalls++;
            await heartbeat("extracting", `Checking ${new URL(sourceUrl).hostname} for a stated headcount`);
            try {
              const located = await step.do(`headcount-${attempt}`, async () => {
                const current = await service.control();
                if (terminalResearchStates.includes(current.status) || service.now() >= current.deadline) return { finding: null, deferred: current.stopReason || "Time limit reached" };
                return { finding: modelHeadcountFinding(await service.extractHeadcount!(companyHeadcountPrompt(markdown, sourceUrl, initial.config)), markdown, sourceUrl, initial.config) };
              }, false);
              trace("headcount_model_result", { source: source(sourceUrl), accepted: Boolean(located.finding) });
              if (located.finding) findings.push(located.finding);
              if (located.deferred) { extractionDeferred = located.deferred; modelCalls--; }
            } catch (error) {
              if (error instanceof BrowserAdmissionDeferred) { extractionDeferred = error.message; modelCalls--; }
              else warnings.push("Headcount extraction unavailable; labelled facts retained");
            }
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
          await heartbeat(
            "extracting",
            initial.config.purpose === "people" ? `Looking for named decision-makers on website ${domains.size}` : `Assessing products and business role on website ${domains.size}`,
          );
          let extracted: { findings: ResearchPage['findings']; warning: string; deferred?: string; failureReason?: string } = { findings: [], warning: '' };
          let extractionAttempts = 0;
          for (let recovery = 0; recovery < 2; recovery++) {
            if (recovery) modelCalls++;
            extractionAttempts++;
            extracted = await step.do(
            `extract-${attempt}${recovery ? "-recovery" : ""}`,
            async () => {
              const current = await service.control();
              if (
                terminalResearchStates.includes(current.status) ||
                service.now() >= current.deadline
              )
                return { findings: [], warning: "Extraction deferred", deferred: current.stopReason || "Time limit reached" };
              try {
                const peopleConfig = { ...current.config, legalEntity: collected.find(f => f.kind === "identifier" && f.name === "Legal entity")?.value || current.config.legalEntity };
                const messages = initial.config.purpose === "people" ? peoplePrompt(markdown, sourceUrl, peopleConfig) : initial.config.workflow === "business" ? businessPrompt(markdown, initial.config.searchTerms, sourceUrl, Boolean(initial.config.findPeople), initial.config) : extractionPrompt(markdown, initial.config.searchTerms, sourceUrl);
                const raw = await service.extract(recovery ? recoveryExtractionPrompt(messages) : messages);
                const rejected: Record<string, number> = {};
                const accepted = (initial.config.purpose === "people" ? (input: unknown, markdown: string, source: string) => validatePeopleFindings(input, markdown, source, peopleConfig, reason => { rejected[reason] = (rejected[reason] || 0) + 1; }) : initial.config.workflow === "business" ? (input: unknown, markdown: string, source: string) => validateBusinessFindings(input, markdown, source, current.config) : validateFindings)(
                    raw, markdown, sourceUrl, initial.config.searchTerms,
                  );
                trace("extraction_result", { source: source(sourceUrl), method: "model", rejected, candidates: Array.isArray(raw) ? raw.length : null, accepted: accepted.length, kinds: accepted.map(f => f.kind), reason: !Array.isArray(raw) ? "invalid_candidate_shape" : !raw.length ? "model_returned_no_evidence" : !accepted.length ? "candidates_failed_evidence_validation" : "supported_facts" });
                return { findings: accepted, warning: "" };
              } catch (error) {
                if (error instanceof BrowserAdmissionDeferred) return { findings: [], warning: "Extraction admission deferred", deferred: error.message };
                return {
                  findings: [],
                  failureReason: extractionFailureReason(error),
                  warning: error instanceof ResearchAiError ? `Evidence extraction failed: ${error.message}; page read successfully` : "Evidence extraction failed; page read successfully",
                };
              }
            },
            false,
          ).catch(error => {
            if (error instanceof BrowserAdmissionDeferred) return { findings: [], warning: "Extraction admission deferred", deferred: error.message };
            throw error;
          });
            if (!extracted.failureReason || extracted.failureReason === 'request_rejected' || extracted.failureReason === 'extraction_error' || extracted.deferred || modelCalls >= budget.maxModelCalls) break;
            trace('extraction_retry', { source: source(sourceUrl), reason: extracted.failureReason, attempt: extractionAttempts });
          }
          entry.extraction = { status: extracted.deferred ? 'deferred' : extracted.warning ? 'failed' : 'completed', attempts: extractionAttempts, ...(extracted.failureReason ? { reason: extracted.failureReason } : {}) };
          findings = extracted.findings;
          if (extracted.deferred) { extractionDeferred = extracted.deferred; modelCalls--; }
          if (extracted.warning) warnings.push(extracted.warning);
          entry.reason =
            extracted.warning ||
            (initial.config.purpose === "people" ? `${findings.filter(f => f.kind === "person").length} sourced people leads${findings.some(f => f.kind === "identifier") ? "; legal operator identified" : ""}; role currency and email remain unverified` : `${findings.length} supported claims; financial fit remains unknown`);
        } else { entry.reason = "Read without AI extraction (model limit)"; }
        await settleSitemap();
        await settleLookahead();
        if (extractionDeferred) {
          await discardLookahead();
          deferPage(`${extractionDeferred}; page retained for extraction`);
          break;
        }
        delete runtime.pendingPage;
        targetedSearchDeferred = false;
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
        if (initial.config.researchTask === 'website' || initial.config.researchTask === 'page') findings.push(...observedCompanyFacts(markdown, sourceUrl, initial.config), ...validatePeopleFindings([], markdown, sourceUrl, initial.config).filter(f => f.kind === 'person'));
        findings = [...findings, ...catalogue].slice(0, initial.config.purpose === "firmographics" || initial.config.researchTask ? 12 : 4);
        if (catalogue.length) entry.reason = `${findings.length} supported claims including directly observed website evidence; financial fit remains unknown`;
        findings.push(...observedCompanyIdentifiers(markdown, sourceUrl, initial.config).filter(f => !findings.some(other => other.kind === f.kind && other.name === f.name && other.value === f.value)));
        const learnedLegalEntity = findings.some(f => f.kind === "identifier" && f.name === "Legal entity") && !collected.some(f => f.kind === "identifier" && f.name === "Legal entity");
        collected.push(...findings);
        if (initial.config.enrichmentPhase) enrichmentPendingFields = missingResearchFields(initial.config, collected);
        // A newly evidenced operator unlocks a different directory/search ladder.
        if (learnedLegalEntity && initial.config.purpose === "people" && (fieldSearches.people || 0) < MAX_TARGETED_SEARCHES.people) {
          exhaustedFields.delete("people");
          emptyFieldSearches.people = 0;
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
          await discardLookahead();
          await publish("complete", "Business identified; company details and people research queued");
          return;
        }
      } catch (error) {
        await settleSitemap();
        await discardLookahead();
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
    await discardLookahead();
    if (initial.config.mode === "automatic" && initial.config.purpose && fieldFound()) {
      trace("run_finished", { pages, modelCalls, reason: "requested_evidence_found", purpose: initial.config.purpose });
      await publish("complete", initial.config.researchField ? fieldCompletionMessage(initial.config.researchField) : initial.config.purpose === "people" ? "Sourced owner or director candidate and published email found; verify ownership and sale authority before outreach." : "Sourced headcount and revenue found; company evidence is ready for review.");
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
    if (initial.config.enrichmentPhase === "initial" && enrichmentPendingFields?.length) {
      trace("run_finished", { pages, modelCalls, reason: "initial_coverage_finished", pendingFields: enrichmentPendingFields });
      await publish("partial", "Initial coverage finished; deeper research pending for " + enrichmentPendingFields.map(field => fieldLabels[field]).join(", "));
      return;
    }
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
    await settleSitemap();
    await discardLookahead();
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
  } finally {
    // Cancellation may return from an intermediate control check. Join and
    // account its reserved read even when no terminal status write is permitted.
    await settleSitemap();
    await discardLookahead();
  }
}
