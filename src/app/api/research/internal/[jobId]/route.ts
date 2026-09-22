import { adaptiveDiscovery, discoveryLimit, discoveryRegions, resolveDiscoveryDecision, type DiscoveryContext, type DiscoveryAttempt } from "@/domain/adaptive-discovery";
import { dispatchDiscoveryCandidates } from "@/lib/automatic-discovery";
import { coolDownResearchBrowser, reserveResearchProvider, releaseResearchProvider } from "@/lib/research-provider-queue";
import { researchBrowserPermit } from "@/lib/research-browser-permit";
import { objectiveFields, fieldSatisfied, nextSearchQuery, type ResearchField } from "@/domain/research-objectives";
import { dispatchAutomaticEnrichment } from "@/lib/automatic-enrichment";
import { targetedQueries } from "@/domain/targeted-research";
import { snippetSizeEstimates } from "@/domain/snippet-estimates";
import { researchDomain } from "@/domain/research";
import { companyFactSearchQuery } from "@/domain/company-facts";
import { mergePeopleSearchLeads, peopleFollowupQuery, cleanLegalEntity, type PeopleSearchLead } from "@/domain/people-search-results";
import { dispatchContinuation } from "@/lib/research-continuation";
import { companyResultMatches } from "@/domain/company-research-routing";
import { cloudflareSearchResults } from "@/adapters/cloudflare-web-search";
import { discoveryQueryPlan, runDiscoveryQueries } from "@/adapters/business-web-search";
import { dispatchBusinessPeople } from "@/lib/business-research-people";
import { peopleWebSearch } from "@/adapters/people-web-search";
import { after } from "next/server";
import { z } from "zod";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { requireDb } from "@/db/client";
import { directorySource } from "@/domain/discovery-sources";
import { mandateTargets, researchJobs, researchFindings, targets } from "@/db/schema";
import { ResearchRepository } from "@/db/research-repository";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { OrganizationRepository } from "@/db/repositories";
import { createTargetDataProvider } from "@/adapters/provider-mode";
import { discoverMandate } from "@/adapters/mandate-discovery";
import { briefToMandate } from "@/domain/acquisition";
import { rankTarget } from "@/domain/scoring";
import {
  progressSchema,
  researchQueries,
  publicResearchUrl,
  terminalResearchStates,
  type ResearchConfig,
} from "@/domain/research";
import {
  researchEnabled,
  researchServiceAuthorized,
} from "@/lib/research-service";
export const maxDuration = 60;
const DISCOVERY_PERSIST_BATCH = 8;
async function getJob(request: Request, jobId: string) {
  if (!researchServiceAuthorized(request) || !researchEnabled()) return null;
  if (!z.string().uuid().safeParse(jobId).success) return null;
  return (
    await requireDb()
      .select()
      .from(researchJobs)
      .where(eq(researchJobs.id, jobId))
      .limit(1)
  )[0];
}
export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = await getJob(request, jobId);
  if (!job) return Response.json({ error: "Not available" }, { status: 403 });
  return Response.json(await controlSnapshot(job, true), { headers: { "Cache-Control": "no-store" } });
}
async function runEvidence(job: NonNullable<Awaited<ReturnType<typeof getJob>>>) {
  const config = job.config as ResearchConfig;
  const rootId = config.researchRunId || job.id;
  return requireDb().select().from(researchFindings).where(and(eq(researchFindings.organizationId, job.organizationId), config.targetId ? and(eq(researchFindings.targetId, config.targetId), sql`${researchFindings.jobId} IN (SELECT id FROM research_jobs WHERE id = ${rootId} OR config->>'researchRunId' = ${rootId})`) : eq(researchFindings.jobId, job.id)));
}
async function controlSnapshot(job: NonNullable<Awaited<ReturnType<typeof getJob>>>, includeFindings = false) {
  const config = job.config as ResearchConfig;
  const root = config.researchRunId && config.researchRunId !== job.id ? await new ResearchRepository(job.organizationId).get(config.researchRunId) : job;
  return {
    status: root?.status === "cancelled" ? "cancelled" : job.status,
    updatedAt: job.updatedAt.toISOString(), crawlId: job.crawlId, config: config.discoveryCandidate || config.parallelDiscovery ? { ...config, newBusinessIds: (root?.config as ResearchConfig | undefined)?.newBusinessIds || [] } : config, seeds: job.seeds,
    deadline: Math.min(job.createdAt.getTime() + config.budget.maxMinutes * 60000, (root?.config as ResearchConfig | undefined)?.automaticDeadline || Infinity),
    ...(includeFindings && config.targetId ? { findings: (await runEvidence(job)).map(f => f.evidence) } : {}),
  };
}

async function discoveryContext(job: NonNullable<Awaited<ReturnType<typeof getJob>>>): Promise<DiscoveryContext> {
  const config = job.config as ResearchConfig;
  const rootId = config.researchRunId || job.id;
  const jobs = (await new ResearchRepository(job.organizationId).list(job.mandateId)).filter(j => j.id === rootId || (j.config as ResearchConfig).researchRunId === rootId);
  const attempts = config.discoveryAttempts || [];
  const stopped = jobs.some(j => j.status === "cancelled") || Boolean(config.discoveryStopReason) || Date.now() >= (config.automaticDeadline || Infinity);
  return {
    scope: config.researchScope || config.searchTerms.join("; "), startingTerms: config.searchTerms,
    regions: discoveryRegions(config.geography), target: config.targetBusinesses || 20,
    found: new Set(jobs.flatMap(j => (j.config as ResearchConfig).newBusinessIds || [])).size,
    remainingSearches: stopped ? 0 : Math.max(0, discoveryLimit(config) - attempts.length), attempts,
    knownDomains: [...new Set(jobs.flatMap(j => (j.seeds as string[]).map(researchDomain)))].slice(0, 1000),
    candidates: jobs.filter(j => (j.config as ResearchConfig).discoveryCandidate).slice(0, 100).map(j => ({ domain: (j.config as ResearchConfig).companyDomain || "", status: j.status, relevant: Boolean((j.config as ResearchConfig).newBusinessIds?.length) })),
  };
}

async function saveSearchLeads(jobId: string, previous: PeopleSearchLead[], leads: PeopleSearchLead[]) {
  await requireDb().update(researchJobs).set({ config: sql`jsonb_set(${researchJobs.config}, '{peopleSearchLeads}', ${JSON.stringify(mergePeopleSearchLeads([...leads, ...previous]))}::jsonb)` }).where(and(eq(researchJobs.id, jobId), notInArray(researchJobs.status, terminalResearchStates)));
}
export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = await getJob(request, jobId);
  if (!job) return Response.json({ error: "Not available" }, { status: 403 });
  const payload = await request.json().catch(() => null);
  const repo = new ResearchRepository(job.organizationId);
  if (payload?.action === "provider-reserve") {
    if (terminalResearchStates.includes(job.status) || !['page', 'search', 'ai'].includes(payload.provider) || typeof payload.token !== 'string' || payload.token.length > 160) return Response.json({ granted: false, retryAfterMs: 1000 });
    const reservation = await reserveResearchProvider(jobId, payload.token, payload.provider, undefined, payload.policy === "paid-v1");
    // A durable queue wait is live work, not an unresponsive provider step.
    await requireDb().update(researchJobs).set({ updatedAt: new Date(), message: `Waiting for ${payload.provider === "ai" ? "AI" : "browser"} slot` }).where(and(eq(researchJobs.id, jobId), notInArray(researchJobs.status, terminalResearchStates)));
    return Response.json(reservation);
  }
  if (payload?.action === "browser-cooldown") {
    const delay = Number(payload.retryAfterMs);
    if (!Number.isFinite(delay) || delay < 0) return Response.json({ error: "Invalid delay" }, { status: 400 });
    await coolDownResearchBrowser(delay);
    return Response.json({ ok: true });
  }
  if (payload?.action === "provider-release") {
    if (typeof payload.token !== 'string' || payload.token.length > 160) return Response.json({ error: "Invalid token" }, { status: 400 });
    await releaseResearchProvider(jobId, payload.token);
    return Response.json({ ok: true });
  }
  if (payload?.action === "browser-permit") {
    const permit = await researchBrowserPermit(jobId, typeof payload.token === 'string' ? payload.token : undefined, typeof payload.url === "string" ? researchDomain(payload.url) || undefined : undefined);
    if (permit.granted) await requireDb().update(researchJobs).set({ updatedAt: new Date(), message: job.status === "discovering" ? "Searching the web" : "Reading website" }).where(and(eq(researchJobs.id, jobId), notInArray(researchJobs.status, terminalResearchStates)));
    return Response.json(permit);
  }
  // Pass the reserved search slot through the existing provider adapter. It is
  // consumed atomically by /search, never trusted merely because a header exists.
  const searchFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (typeof payload?.browserReservation === 'string') headers.set('x-research-browser-reservation', payload.browserReservation);
    return fetch(input, { ...init, headers });
  };
  if (payload?.action === "discovery-context") {
    return Response.json(await discoveryContext(job));
  }
  if (payload?.action === "targeted-followup") {
    const config = job.config as ResearchConfig;
    const field = payload.field as ResearchField;
    if (!config.targetedFollowup || !objectiveFields(config).includes(field) || ((field === "people" || field === "email") && config.maxPeopleSearches !== 2) || terminalResearchStates.includes(job.status)) return Response.json({ seeds: [], exhausted: true });
    const evidence = await runEvidence(job);
    const facts = evidence.map(f => f.evidence as import("@/domain/research").ResearchFinding);
    if (fieldSatisfied(field, facts)) return Response.json({ seeds: [], exhausted: true });
    const legalEntity = facts.find(f => f.kind === "identifier" && f.name === "Legal entity")?.value || config.legalEntity;
    const completed = config.targetedSearches || [], attempts = config.targetedSearchAttempts || [];
    const ladder = targetedQueries(field, { ...config, legalEntity }, facts);
    const query = nextSearchQuery(ladder, completed, attempts);
    if (!query) return Response.json({ seeds: [], exhausted: true });
    const lease = crypto.randomUUID();
    const claimed = await requireDb().update(researchJobs).set({ config: sql`jsonb_set(${researchJobs.config}, '{targetedSearchLease}', ${JSON.stringify({ id: lease, until: Date.now() + 65000 })}::jsonb)` })
      .where(and(eq(researchJobs.id, job.id), sql`COALESCE((${researchJobs.config}->'targetedSearchLease'->>'until')::bigint, 0) < ${Date.now()}`, sql`NOT (COALESCE(${researchJobs.config}->'targetedSearches', '[]'::jsonb) ? ${query})`, notInArray(researchJobs.status, terminalResearchStates))).returning({ id: researchJobs.id });
    if (!claimed.length) return Response.json({ seeds: [], failed: true, warning: "Search already in progress; retrying within the job budget" });
    const saveAttempt = async (status: 'succeeded' | 'failed', category?: string) => {
      const attempt = { query, field, status, ...(category ? { category } : {}) };
      const base = sql`jsonb_set(${researchJobs.config} - 'targetedSearchLease', '{targetedSearchAttempts}', COALESCE(${researchJobs.config}->'targetedSearchAttempts', '[]'::jsonb) || ${JSON.stringify([attempt])}::jsonb)`;
      await requireDb().update(researchJobs).set({ config: status === 'succeeded' ? sql`jsonb_set(${base}, '{targetedSearches}', COALESCE(${researchJobs.config}->'targetedSearches', '[]'::jsonb) || ${JSON.stringify([query])}::jsonb)` : base })
        .where(and(eq(researchJobs.id, job.id), sql`${researchJobs.config}->'targetedSearchLease'->>'id' = ${lease}`));
      return !nextSearchQuery(ladder, status === 'succeeded' ? [...completed, query] : completed, [...attempts, attempt]);
    };
    try {
      let seeds: string[];
      if (field === "people" || field === "email") {
        const result = await peopleWebSearch(config.companyName!, config.companyDomain!, searchFetch, query, legalEntity, job.id);
        await saveSearchLeads(job.id, config.peopleSearchLeads || [], result.leads);
        seeds = result.seeds;
      } else {
        const results = await cloudflareSearchResults(query, searchFetch, job.id);
        await repo.saveSnippetEstimates(job.id, snippetSizeEstimates(results, { ...config, legalEntity }));
        seeds = results.filter(r => companyResultMatches(r, config.companyName!, config.companyDomain!, legalEntity)).map(r => r.url);
      }
      const exhausted = await saveAttempt('succeeded');
      return Response.json({ seeds, query, exhausted });
    } catch (error) {
      const category = error instanceof Error && 'category' in error ? String(error.category) : 'provider_unavailable';
      const exhausted = await saveAttempt('failed', category);
      return Response.json({ seeds: [], query, failed: true, exhausted, warning: `Search for ${field} failed (${category}); existing evidence retained` });
    }
  }
  if (payload?.action === "people-followup") {
    const config = job.config as ResearchConfig;
    if (config.purpose !== "people" || config.maxPeopleSearches !== 2 || terminalResearchStates.includes(job.status)) return Response.json({ seeds: [] });
    const findings = await requireDb().select().from(researchFindings).where(and(eq(researchFindings.jobId, job.id), eq(researchFindings.organizationId, job.organizationId)));
    const candidate = findings.map(f => f.evidence as { kind?: string; name?: string; value?: string }).find(f => f.kind === "identifier" && f.name === "Legal entity");
    const legalEntity = candidate?.value ? cleanLegalEntity(candidate.value) : config.legalEntity;
    const query = peopleFollowupQuery(config.companyName!, config.peopleSearchLeads || [], legalEntity, config.companyDomain);
    if (!query) return Response.json({ seeds: [] });
    const claimed = await requireDb().update(researchJobs).set({ config: sql`jsonb_set(jsonb_set(${researchJobs.config}, '{peopleFollowupStarted}', 'true'::jsonb), '{legalEntity}', ${JSON.stringify(legalEntity || "")}::jsonb)` }).where(and(eq(researchJobs.id, job.id), sql`COALESCE(${researchJobs.config}->>'peopleFollowupStarted', 'false') = 'false'`, notInArray(researchJobs.status, terminalResearchStates))).returning({ id: researchJobs.id });
    if (!claimed.length) return Response.json({ seeds: [] });
    try {
      const result = await peopleWebSearch(config.companyName!, config.companyDomain!, searchFetch, query, legalEntity, job.id);
      await saveSearchLeads(job.id, config.peopleSearchLeads || [], result.leads);
      return Response.json({ seeds: result.seeds });
    }
    catch (error) { return Response.json({ seeds: [], warning: `${error instanceof Error ? error.message : "Targeted people follow-up search unavailable"}; saved website research retained.` }); }
  }
  if (payload?.action === "discovery-sources") {
    const config = job.config as ResearchConfig;
    if (terminalResearchStates.includes(job.status) || config.purpose || config.workflow !== "business" || !config.discover)
      return Response.json({ pending: false });
    if (config.discoverySourcesPrepared)
      return Response.json({ pending: !config.discoverySourceCoverageRecorded || (config.discoverySourceCursor || 0) < (config.discoverySourceCandidates?.length || 0) });
    const mandate = await new AcquisitionRepository(job.organizationId).getMandate(job.mandateId);
    if (!mandate) return Response.json({ error: "Mandate unavailable" }, { status: 409 });
    const filters = briefToMandate(mandate.brief);
    const provider = createTargetDataProvider();
    const discovery = await discoverMandate({
      interleavePlaces: true,
      directory: {
        search: () => provider.manufacturingDirectory.search(
          { ...filters, sectors: researchQueries(config.searchTerms) },
          Number.MAX_SAFE_INTEGER,
        ),
      },
      places: provider.places,
      mandate: {
        ...filters,
        sectors: researchQueries(config.searchTerms),
        locations: [/^national$/i.test(config.geography) ? "Australia" : config.geography],
      },
      organizationId: job.organizationId,
    });
    const linkedTargets = await requireDb().select({ domain: targets.domain }).from(targets).innerJoin(mandateTargets, and(eq(mandateTargets.targetId, targets.id), eq(mandateTargets.organizationId, job.organizationId), eq(mandateTargets.mandateId, job.mandateId))).where(eq(targets.organizationId, job.organizationId));
    const skipDomains = [...new Set(linkedTargets.flatMap(target => target.domain ? [target.domain.toLowerCase().replace(/^www\./, "")] : []))];
    const urls = discovery.targets.flatMap(target => {
      const url = target.domain && publicResearchUrl(`https://${target.domain}/`);
      return url && !skipDomains.includes(researchDomain(url)) ? [url] : [];
    });
    // Google listing content remains transient. Only public URLs and sourced
    // directory records are staged for resumable persistence.
    const candidates = discovery.targets.slice(0, 100).flatMap(target => target.sourceData?.manufacturingDirectory ? [{
      ...target,
      sourceData: { manufacturingDirectory: target.sourceData.manufacturingDirectory },
    }] : []);
    const nextConfig: ResearchConfig = {
      ...config,
      discoverySourcesPrepared: true,
      discoverySourceCandidates: candidates,
      discoverySourceCursor: 0,
      discoverySourceCoverage: discovery.sources,
      discoverySourceCoverageRecorded: false,
      skipDomains,
    };
    const prepared = await requireDb().update(researchJobs).set({
      discoveryStarted: true,
      status: "discovering",
      seeds: [...new Set([...(job.seeds as string[]), ...urls])].slice(0, 1000),
      config: nextConfig,
      message: candidates.length ? "Saving discovered businesses" : "Discovery sources searched",
      updatedAt: new Date(),
    }).where(and(eq(researchJobs.id, jobId), eq(researchJobs.organizationId, job.organizationId), notInArray(researchJobs.status, terminalResearchStates), eq(researchJobs.discoveryStarted, false))).returning({ id: researchJobs.id });
    if (!prepared.length) {
      const current = await repo.get(jobId);
      const currentConfig = current?.config as ResearchConfig | undefined;
      return Response.json({ pending: Boolean(currentConfig?.discoverySourcesPrepared && (!currentConfig.discoverySourceCoverageRecorded || (currentConfig.discoverySourceCursor || 0) < (currentConfig.discoverySourceCandidates?.length || 0))) });
    }
    return Response.json({ pending: true });
  }
  if (payload?.action === "discovery-persist") {
    const config = job.config as ResearchConfig;
    if (terminalResearchStates.includes(job.status) || !config.discoverySourcesPrepared) return Response.json({ pending: false });
    const candidates = config.discoverySourceCandidates || [];
    const cursor = config.discoverySourceCursor || 0;
    const batch = candidates.slice(cursor, cursor + DISCOVERY_PERSIST_BATCH);
    const mandate = await new AcquisitionRepository(job.organizationId).getMandate(job.mandateId);
    if (!mandate) return Response.json({ error: "Mandate unavailable" }, { status: 409 });
    const filters = briefToMandate(mandate.brief);
    const next = cursor + batch.length;
    let advanced = false;
    await requireDb().transaction(async tx => {
      const companies = new OrganizationRepository(tx, job.organizationId);
      const acquisition = new AcquisitionRepository(job.organizationId, tx);
      const savedIds: string[] = [];
      for (const target of batch) {
        const saved = await companies.upsertEnrichedTarget({ target: rankTarget(target, filters), mandateId: job.mandateId, actorId: job.createdBy });
        if (saved) savedIds.push(saved.id);
      }
      await acquisition.attachMany(job.mandateId, savedIds);
      const rows = await tx.update(researchJobs).set({
        config: sql`jsonb_set(${researchJobs.config}, '{discoverySourceCursor}', ${String(next)}::jsonb)`,
        message: next < candidates.length ? `Saving discovered businesses (${next}/${candidates.length})` : "Discovered businesses saved",
        updatedAt: new Date(),
      }).where(and(eq(researchJobs.id, jobId), eq(researchJobs.organizationId, job.organizationId), notInArray(researchJobs.status, terminalResearchStates), sql`COALESCE((${researchJobs.config}->>'discoverySourceCursor')::int, 0) = ${cursor}`)).returning({ id: researchJobs.id });
      if (!rows.length) return;
      advanced = true;
      if (next >= candidates.length && !config.discoverySourceCoverageRecorded) {
        await acquisition.recordCoverage(job.mandateId, config.discoverySourceCoverage || []);
        await tx.update(researchJobs).set({
          config: sql`jsonb_set(${researchJobs.config} - 'discoverySourceCandidates' - 'discoverySourceCoverage', '{discoverySourceCoverageRecorded}', 'true'::jsonb)`,
          updatedAt: new Date(),
        }).where(and(eq(researchJobs.id, jobId), eq(researchJobs.organizationId, job.organizationId), notInArray(researchJobs.status, terminalResearchStates)));
      }
    });
    if (!advanced) {
      const current = await repo.get(jobId);
      const currentConfig = current?.config as ResearchConfig | undefined;
      return Response.json({ pending: Boolean(current && !terminalResearchStates.includes(current.status) && (currentConfig?.discoverySourceCursor || 0) < (currentConfig?.discoverySourceCandidates?.length || 0)) });
    }
    return Response.json({ pending: next < candidates.length });
  }
  if (payload?.action === "discover") {
    if (terminalResearchStates.includes(job.status))
      return Response.json({ seeds: job.seeds, stopped: true });
    const config = job.config as ResearchConfig;
    const control = await controlSnapshot(job);
    if (control.status === "cancelled" || Date.now() >= control.deadline) return Response.json({ seeds: [], stopped: true, more: false });
    // Web discovery runs in slices: the first call claims discovery and runs the fast
    // sources; each call then runs a few searches and reports whether more remain.
    const sourcesPrepared = config.discoverySourcesPrepared === true;
    const continuing = typeof config.discoveryCursor === "number";
    if (!sourcesPrepared && !continuing && !(await repo.claimDiscovery(jobId)))
      return Response.json({
        seeds: job.seeds,
        warning: "Discovery already attempted; existing seeds reused.",
      });
    let seeds = (sourcesPrepared || continuing ? (job.seeds as string[]) : (config.runtime?.remaining || config.seeds))
      .map(publicResearchUrl)
      .filter((s): s is string => Boolean(s));
    let warning = "";
    let peopleLeadCount = config.peopleSearchLeads?.length || 0;
    if (sourcesPrepared || continuing) { /* durable source discovery already ran */ }
    else if (config.purpose === "firmographics" && config.discover && !config.targetedFollowup) {
      try { const profileResults = await cloudflareSearchResults(companyFactSearchQuery(config.companyName!, config.companyDomain!), searchFetch, job.id); await repo.saveSnippetEstimates(job.id, snippetSizeEstimates(profileResults, config)); seeds.push(...profileResults.filter(r => companyResultMatches(r, config.companyName!, config.companyDomain!, config.legalEntity)).map(r => r.url)); }
      catch { warning = "Public profile search unavailable; company website research continues."; }
    } else if (config.purpose === "people" && config.discover && !config.targetedFollowup) {
      try {
        const result = await peopleWebSearch(config.companyName!, config.companyDomain!, searchFetch, undefined, undefined, job.id);
        seeds.push(...result.seeds);
        peopleLeadCount = result.leads.length;
        await saveSearchLeads(job.id, config.peopleSearchLeads || [], result.leads);
      }
      catch (error) { warning = `${error instanceof Error ? error.message : "Public web search unavailable"}; company website research continues.`; }
    } else if (config.discover && !config.purpose) {
      try {
        const mandate = await new AcquisitionRepository(
          job.organizationId,
        ).getMandate(job.mandateId);
        if (!mandate) throw new Error("Mandate unavailable");
        const filters = briefToMandate(mandate.brief);
        const provider = createTargetDataProvider();
        // Only explicitly approved search terms/geography reach Google.
        const discovery = await discoverMandate({
          interleavePlaces: true,
          directory: {
            search: () =>
              provider.manufacturingDirectory.search(
                { ...filters, sectors: researchQueries(config.searchTerms) },
                Number.MAX_SAFE_INTEGER,
              ),
          },
          places: provider.places,
          mandate: {
            ...filters,
            sectors: researchQueries(config.searchTerms),
            locations: [
              /^national$/i.test(config.geography)
                ? "Australia"
                : config.geography,
            ],
          },
          organizationId: job.organizationId,
        });
        const companies = new OrganizationRepository(
          requireDb(),
          job.organizationId,
        );
        const acquisition = new AcquisitionRepository(job.organizationId);
        // Businesses already attached to the mandate are enriched separately; discovery skips their websites.
        const skipDomains = [...new Set((await acquisition.memberships(job.mandateId)).flatMap(m => m.target.domain ? [m.target.domain.toLowerCase().replace(/^www\./, "")] : []))];
        if (skipDomains.length) await requireDb().update(researchJobs).set({ config: sql`jsonb_set(${researchJobs.config}, '{skipDomains}', ${JSON.stringify(skipDomains)}::jsonb)` }).where(eq(researchJobs.id, jobId));
        seeds = seeds.filter(url => !skipDomains.includes(researchDomain(url)));
        // Prefer exact directory searches for separate capabilities; existing company identities are reused.
        for (const target of discovery.targets.slice(0, 100)) {
          const latest = (await repo.get(jobId))?.config as ResearchConfig | undefined;
          if (config.targetBusinesses && new Set(latest?.newBusinessIds || []).size >= config.targetBusinesses) break;
          const saved = await companies.upsertEnrichedTarget({
            target: rankTarget(target, filters),
            mandateId: job.mandateId,
            actorId: job.createdBy,
          });
          // Directory and map listings are discovery sources. A business counts toward
          // the target only once its own website shows mandate-relevant evidence.
          if (saved) await acquisition.attach(job.mandateId, saved.id);
          const url = target.domain
            ? publicResearchUrl(`https://${target.domain}/`)
            : null;
          if (url) seeds.push(url);
        }
        await acquisition.recordCoverage(job.mandateId, discovery.sources);
        if (discovery.sources.some((s) => s.status === "failed"))
          warning = "Some discovery sources failed; available seeds retained.";
      } catch {
        warning =
          "Discovery interrupted; supplied seeds retained. Retry discovery separately if needed.";
      }
    }
    const afterDiscovery = (await repo.get(jobId))?.config as ResearchConfig | undefined;
    let more = false;
    let admissionDeferred = false;
    if (config.workflow === "business" && config.discover && (!config.targetBusinesses || new Set(afterDiscovery?.newBusinessIds || []).size < config.targetBusinesses)) {
      const skip = new Set(afterDiscovery?.skipDomains || []);
      if (adaptiveDiscovery(config)) {
        const latest = await repo.get(jobId);
        const context = await discoveryContext(latest || job);
        // A workflow callback can be replayed after its result was committed.
        // Reuse the committed attempt instead of charging for the same search again.
        if (typeof payload.decision?.attemptIndex === "number" && payload.decision.attemptIndex !== context.attempts.length) return Response.json({ seeds: config.parallelDiscovery ? [] : latest?.seeds || [], more: Boolean((latest?.config as ResearchConfig | undefined)?.discoveryPending) });
        const lease = crypto.randomUUID();
        const claimed = await requireDb().update(researchJobs).set({ config: sql`jsonb_set(${researchJobs.config}, '{discoveryLease}', ${JSON.stringify({ id: lease, until: Date.now() + 65000 })}::jsonb)` }).where(and(eq(researchJobs.id, jobId), notInArray(researchJobs.status, terminalResearchStates), sql`jsonb_array_length(COALESCE(${researchJobs.config}->'discoveryAttempts', '[]'::jsonb)) = ${context.attempts.length}`, sql`COALESCE((${researchJobs.config}->'discoveryLease'->>'until')::bigint, 0) < ${Date.now()}`)).returning({ id: researchJobs.id });
        if (!claimed.length) return Response.json({ seeds: [], more: true, deferred: true });
        const decision = resolveDiscoveryDecision(payload.decision?.planning, context, discoveryQueryPlan(config.searchTerms, config.geography).map(p => p.query));
        let attempt: DiscoveryAttempt | undefined;
        if (decision.query) {
          try {
            // Queries are discovery leads. Semantic relevance is checked against the
            // original scope on the company page, never by matching seed keywords.
            const results = await cloudflareSearchResults(decision.query, searchFetch, job.id);
            const known = new Set([...seeds.map(researchDomain), ...(context.knownDomains || []), ...context.candidates.map(c => c.domain), ...skip]);
            const safe = results.flatMap(r => { const url = publicResearchUrl(r.url); return url ? [{ ...r, url }] : []; });
            const fresh = safe.filter(r => !known.has(researchDomain(r.url)));
            attempt = { query: decision.query, reason: decision.reason, status: "succeeded", resultCount: safe.length, newDomains: new Set(fresh.map(r => researchDomain(r.url))).size, results: safe.slice(0, 8).map(r => ({ url: r.url, title: r.title.slice(0, 180), snippet: r.snippet.slice(0, 400) })) };
            seeds.push(...safe.filter(r => !skip.has(researchDomain(r.url))).map(r => r.url));
          } catch (error) {
            const category = error instanceof Error && "category" in error ? String(error.category) : "provider_error";
            admissionDeferred = category === "browser_admission";
            if (!admissionDeferred) attempt = { query: decision.query, reason: decision.reason, status: "failed", category };
            warning = "Web search temporarily unavailable; saved sources retained.";
          }
        }
        const attempts = [...context.attempts, ...(attempt ? [attempt] : [])];
        more = !decision.stop && attempts.length < discoveryLimit(config);
        const stopReason = decision.stop ? decision.reason : !more ? "Search budget reached." : "";
        await requireDb().update(researchJobs).set({ seeds: [...new Set(seeds)].filter(url => !skip.has(researchDomain(url))).slice(0, 1000), config: sql`jsonb_set(jsonb_set(jsonb_set(jsonb_set(${researchJobs.config} - 'discoveryLease', '{discoveryCursor}', ${String(attempts.length)}::jsonb), '{discoveryPending}', ${JSON.stringify(more)}::jsonb), '{discoveryAttempts}', ${JSON.stringify(attempts)}::jsonb), '{discoveryStopReason}', ${JSON.stringify(stopReason)}::jsonb)` }).where(and(eq(researchJobs.id, jobId), sql`${researchJobs.config}->'discoveryLease'->>'id' = ${lease}`, notInArray(researchJobs.status, terminalResearchStates)));
      } else {
        const plan = discoveryQueryPlan(config.searchTerms, config.geography);
        const cursor = afterDiscovery?.discoveryCursor || 0;
        const slice = plan.slice(cursor, cursor + 1);
        const attempts = afterDiscovery?.discoveryAttempts || [];
        let newAttempts: NonNullable<ResearchConfig['discoveryAttempts']> = [];
        try {
          const web = await runDiscoveryQueries(slice, config.searchTerms, searchFetch, job.id);
          newAttempts = web.attempts;
          const fresh = web.seeds.filter(url => !skip.has(researchDomain(url)));
          seeds = Array.from({ length: Math.max(seeds.length, fresh.length) }, (_, i) => [seeds[i], fresh[i]].filter((url): url is string => Boolean(url))).flat();
          if (web.warning) warning = [warning, web.warning].filter(Boolean).join(" ");
        } catch {
          newAttempts = slice.map(({ query }) => ({ query, status: "failed", category: "provider_error" }));
          warning = [warning, "Public web discovery unavailable; directory and supplied websites retained."].filter(Boolean).join(" ");
        }
        admissionDeferred = newAttempts.some(a => a.category === "browser_admission");
        if (admissionDeferred) newAttempts = [];
        const failed = newAttempts.some(a => a.status === "failed");
        const retry = failed && !attempts.some(a => a.query === slice[0]?.query && a.status === "failed");
        const next = cursor + (retry || admissionDeferred ? 0 : slice.length);
        more = next < plan.length;
        await requireDb().update(researchJobs).set({ config: sql`jsonb_set(jsonb_set(jsonb_set(${researchJobs.config}, '{discoveryCursor}', ${String(next)}::jsonb), '{discoveryPending}', ${JSON.stringify(more)}::jsonb), '{discoveryAttempts}', COALESCE(${researchJobs.config}->'discoveryAttempts', '[]'::jsonb) || ${JSON.stringify(newAttempts)}::jsonb)` }).where(eq(researchJobs.id, jobId));
      }
    }
    const finalSkip = new Set(((await repo.get(jobId))?.config as ResearchConfig | undefined)?.skipDomains || []);
    seeds = [...new Set(seeds)].filter(url => !finalSkip.has(researchDomain(url))).slice(0, config.adaptiveDiscovery ? 1000 : 100);
    await repo.seeds(jobId, seeds, warning || (seeds.length ? "Website search finished; researching candidate businesses" : "Website search finished; no candidate websites found in this batch"));
    if (config.parallelDiscovery) await dispatchDiscoveryCandidates(job.organizationId, jobId);
    return Response.json({ seeds: config.parallelDiscovery ? [] : seeds, deferred: admissionDeferred, warning, peopleLeadCount, skipDomains: [...finalSkip], more });
  }
  const event = progressSchema.safeParse(payload);
  if (!event.success)
    return Response.json({ error: "Invalid progress event" }, { status: 400 });
  try {
    await repo.progress(jobId, event.data);
  } catch {
    return Response.json(
      { error: "Unable to record progress" },
      { status: 409 },
    );
  }
  // Progress is saved above. Queue refills run after the response so the
  // Workflow is not held for coordination queries. A dispatch failure must not
  // make the worker retry and then fail a healthy run; the next callback or
  // poll refills the queue.
  const status = event.data.status, page = event.data.page;
  // Refill work only when a page produced evidence or directory links, or the job ended;
  // status-only heartbeats must stay cheap.
  const pageMatters = Boolean(page && (page.findings.length > 0 || directorySource(page.url, page.markdown)));
  const terminal = ["complete", "partial", "failed"].includes(status);
  if (pageMatters || terminal) after(async () => {
    try {
      if ((job.config as ResearchConfig).mode === "automatic") {
        if (["complete", "partial"].includes(status)) await dispatchContinuation(job.organizationId, jobId);
        await dispatchDiscoveryCandidates(job.organizationId, jobId);
        await dispatchAutomaticEnrichment(job.organizationId, jobId);
      } else if (terminal && !await dispatchContinuation(job.organizationId, jobId)) await dispatchBusinessPeople(job.organizationId, jobId);
    } catch (error) {
      console.info("research-diagnostic", JSON.stringify({ timestamp: new Date().toISOString(), jobId, event: "dispatch_deferred", reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
    }
  });
  const saved = await repo.get(jobId);
  return Response.json({ ok: true, ...(saved ? { control: await controlSnapshot(saved) } : {}) });
}
