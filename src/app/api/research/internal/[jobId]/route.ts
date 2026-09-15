import { dispatchDiscoveryCandidates } from "@/lib/automatic-discovery";
import { reserveResearchProvider } from "@/lib/research-provider-queue";
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
import { z } from "zod";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { requireDb } from "@/db/client";
import { researchJobs, researchFindings } from "@/db/schema";
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
    const reservation = await reserveResearchProvider(jobId, payload.token, payload.provider);
    // A durable queue wait is live work, not an unresponsive provider step.
    await requireDb().update(researchJobs).set({ updatedAt: new Date() }).where(and(eq(researchJobs.id, jobId), notInArray(researchJobs.status, terminalResearchStates)));
    return Response.json(reservation);
  }
  if (payload?.action === "browser-permit") return Response.json(await researchBrowserPermit(jobId, typeof payload.token === 'string' ? payload.token : undefined));
  // Pass the reserved search slot through the existing provider adapter. It is
  // consumed atomically by /search, never trusted merely because a header exists.
  const searchFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (typeof payload?.browserReservation === 'string') headers.set('x-research-browser-reservation', payload.browserReservation);
    return fetch(input, { ...init, headers });
  };
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
  if (payload?.action === "discover") {
    if (terminalResearchStates.includes(job.status))
      return Response.json({ seeds: job.seeds, stopped: true });
    const config = job.config as ResearchConfig;
    // Web discovery runs in slices: the first call claims discovery and runs the fast
    // sources; each call then runs a few searches and reports whether more remain.
    const continuing = typeof config.discoveryCursor === "number";
    if (!continuing && !(await repo.claimDiscovery(jobId)))
      return Response.json({
        seeds: job.seeds,
        warning: "Discovery already attempted; existing seeds reused.",
      });
    let seeds = (continuing ? (job.seeds as string[]) : (config.runtime?.remaining || config.seeds))
      .map(publicResearchUrl)
      .filter((s): s is string => Boolean(s));
    let warning = "";
    let peopleLeadCount = config.peopleSearchLeads?.length || 0;
    if (continuing) { /* fast sources ran on the first call */ }
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
    if (config.workflow === "business" && config.discover && (!config.targetBusinesses || new Set(afterDiscovery?.newBusinessIds || []).size < config.targetBusinesses)) {
      const skip = new Set(afterDiscovery?.skipDomains || []);
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
      const failed = newAttempts.some(a => a.status === "failed");
      const retry = failed && !attempts.some(a => a.query === slice[0]?.query && a.status === "failed");
      const next = cursor + (retry ? 0 : slice.length);
      more = next < plan.length;
      await requireDb().update(researchJobs).set({ config: sql`jsonb_set(jsonb_set(jsonb_set(${researchJobs.config}, '{discoveryCursor}', ${String(next)}::jsonb), '{discoveryPending}', ${JSON.stringify(more)}::jsonb), '{discoveryAttempts}', COALESCE(${researchJobs.config}->'discoveryAttempts', '[]'::jsonb) || ${JSON.stringify(newAttempts)}::jsonb)` }).where(eq(researchJobs.id, jobId));
    }
    const finalSkip = new Set(((await repo.get(jobId))?.config as ResearchConfig | undefined)?.skipDomains || []);
    seeds = [...new Set(seeds)].filter(url => !finalSkip.has(researchDomain(url))).slice(0, 100);
    await repo.seeds(jobId, seeds, warning || (seeds.length ? "Website search finished; researching candidate businesses" : "Website search finished; no candidate websites found in this batch"));
    if (config.parallelDiscovery) await dispatchDiscoveryCandidates(job.organizationId, jobId);
    return Response.json({ seeds: config.parallelDiscovery ? [] : seeds, warning, peopleLeadCount, skipDomains: [...finalSkip], more });
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
  // Progress is saved above. A dispatch failure must not make the worker retry
  // and then fail a healthy run; the next callback or poll refills the queue.
  try {
    if ((job.config as ResearchConfig).mode === "automatic") {
      if (["complete", "partial"].includes(event.data.status)) await dispatchContinuation(job.organizationId, jobId);
      if (event.data.page || ["complete", "partial", "failed"].includes(event.data.status)) {
        await dispatchDiscoveryCandidates(job.organizationId, jobId);
        await dispatchAutomaticEnrichment(job.organizationId, jobId);
      }
    } else if (["complete", "partial", "failed"].includes(event.data.status) && !await dispatchContinuation(job.organizationId, jobId)) await dispatchBusinessPeople(job.organizationId, jobId);
  } catch (error) {
    console.info("research-diagnostic", JSON.stringify({ timestamp: new Date().toISOString(), jobId, event: "dispatch_deferred", reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
  }
  const saved = await repo.get(jobId);
  return Response.json({ ok: true, ...(saved ? { control: await controlSnapshot(saved) } : {}) });
}
