import { automaticCompanySearch } from "@/adapters/automatic-company-search";
import { dispatchAutomaticEnrichment } from "@/lib/automatic-enrichment";
import { targetedQueries, MAX_TARGETED_SEARCHES } from "@/domain/targeted-research";
import { snippetSizeEstimates, isSearchSnippet } from "@/domain/snippet-estimates";
import { researchDomain } from "@/domain/research";
import { companyFactSearchQuery } from "@/domain/company-facts";
import { mergePeopleSearchLeads, peopleFollowupQuery, cleanLegalEntity, type PeopleSearchLead } from "@/domain/people-search-results";
import { dispatchContinuation } from "@/lib/research-continuation";
import { companyResultMatches } from "@/domain/company-research-routing";
import { cloudflareSearchResults } from "@/adapters/cloudflare-web-search";
import { businessWebSeeds } from "@/adapters/business-web-search";
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
  const config = job.config as ResearchConfig;
  const root = config.researchRunId && config.researchRunId !== job.id ? await new ResearchRepository(job.organizationId).get(config.researchRunId) : job;
  return Response.json(
    {
      status: root?.status === "cancelled" ? "cancelled" : job.status,
      crawlId: job.crawlId,
      config,
      seeds: job.seeds,
      deadline: Math.min(job.createdAt.getTime() + config.budget.maxMinutes * 60000, (root?.config as ResearchConfig | undefined)?.automaticDeadline || Infinity),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
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
  if (payload?.action === "targeted-followup") {
    const config = job.config as ResearchConfig;
    const field = config.purpose === "firmographics" ? "size" : "people";
    if (!config.targetedFollowup || !config.purpose || payload.field !== field || (field === "people" && config.maxPeopleSearches !== 2) || terminalResearchStates.includes(job.status)) return Response.json({ seeds: [], exhausted: true });
    const evidence = await requireDb().select().from(researchFindings).where(and(eq(researchFindings.jobId, job.id), eq(researchFindings.organizationId, job.organizationId)));
    const facts = evidence.map(f=>f.evidence as {kind?:string;name?:string;value?:string;factMetadata?:{basis?:string}});
    if (facts.some(f=>field === "people" ? f.kind === "person" : f.kind === "headcount" && !isSearchSnippet(f))) return Response.json({ seeds: [], exhausted: true });
    const legalEntity = facts.find(f=>f.kind === "identifier" && f.name === "Legal entity")?.value || config.legalEntity;
    // Each query in the ladder runs once per job; a page read never consumes a search.
    const executed = config.targetedSearches || [];
    const ladder = targetedQueries(field, { ...config, legalEntity });
    const query = ladder.find(q => !executed.includes(q));
    if (!query || executed.length >= MAX_TARGETED_SEARCHES[field]) return Response.json({ seeds: [], exhausted: true });
    const claimed = await requireDb().update(researchJobs).set({config:sql`jsonb_set(jsonb_set(${researchJobs.config}, '{targetedSearches}', COALESCE(${researchJobs.config}->'targetedSearches', '[]'::jsonb) || ${JSON.stringify([query])}::jsonb), '{legalEntity}', ${JSON.stringify(legalEntity || "")}::jsonb)`})
      .where(and(eq(researchJobs.id, job.id), sql`NOT (COALESCE(${researchJobs.config}->'targetedSearches', '[]'::jsonb) ? ${query})`, notInArray(researchJobs.status, terminalResearchStates))).returning({id:researchJobs.id});
    if (!claimed.length) return Response.json({seeds:[], exhausted: executed.length + 1 >= Math.min(ladder.length, MAX_TARGETED_SEARCHES[field])});
    const exhausted = executed.length + 1 >= Math.min(ladder.length, MAX_TARGETED_SEARCHES[field]);
    try {
      if (field === "people") {
        const result = await peopleWebSearch(config.companyName!, config.companyDomain!, fetch, query, legalEntity, job.id);
        await saveSearchLeads(job.id, config.peopleSearchLeads || [], result.leads);
        const seeds = result.seeds.length || config.mode !== "automatic" ? result.seeds : await automaticCompanySearch({ ...config, legalEntity }, field, job.id);
        return Response.json({seeds, query, exhausted});
      }
      const results = await cloudflareSearchResults(query, fetch, job.id);
      const estimates = await repo.saveSnippetEstimates(job.id, snippetSizeEstimates(results, { ...config, legalEntity }));
      let seeds = results.filter(r=>companyResultMatches(r,config.companyName!,config.companyDomain!,legalEntity)).map(r=>r.url);
      if (!seeds.length && config.mode === "automatic" && !executed.length) seeds = await automaticCompanySearch({ ...config, legalEntity }, field, job.id);
      console.info("research-diagnostic", JSON.stringify({ timestamp: new Date().toISOString(), jobId: job.id, event: "targeted_search_executed", field, round: executed.length + 1, candidates: results.length, accepted: seeds.length, snippetEstimates: estimates, exhausted }));
      return Response.json({seeds, query, exhausted});
    } catch { return Response.json({seeds:[],warning:"Targeted search unavailable; existing evidence retained", exhausted}); }
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
      const result = await peopleWebSearch(config.companyName!, config.companyDomain!, fetch, query, legalEntity, job.id);
      await saveSearchLeads(job.id, config.peopleSearchLeads || [], result.leads);
      return Response.json({ seeds: result.seeds });
    }
    catch (error) { return Response.json({ seeds: [], warning: `${error instanceof Error ? error.message : "Targeted people follow-up search unavailable"}; saved website research retained.` }); }
  }
  if (payload?.action === "discover") {
    if (terminalResearchStates.includes(job.status))
      return Response.json({ seeds: job.seeds, stopped: true });
    if (!(await repo.claimDiscovery(jobId)))
      return Response.json({
        seeds: job.seeds,
        warning: "Discovery already attempted; existing seeds reused.",
      });
    const config = job.config as ResearchConfig;
    let seeds = (config.runtime?.remaining || config.seeds)
      .map(publicResearchUrl)
      .filter((s): s is string => Boolean(s));
    let warning = "";
    let peopleLeadCount = config.peopleSearchLeads?.length || 0;
    if (config.purpose === "firmographics" && config.discover && !config.targetedFollowup) {
      try { const profileResults = await cloudflareSearchResults(companyFactSearchQuery(config.companyName!, config.companyDomain!), fetch, job.id); await repo.saveSnippetEstimates(job.id, snippetSizeEstimates(profileResults, config)); seeds.push(...profileResults.filter(r => companyResultMatches(r, config.companyName!, config.companyDomain!, config.legalEntity)).map(r => r.url)); }
      catch { warning = "Public profile search unavailable; company website research continues."; }
    } else if (config.purpose === "people" && config.discover) {
      try {
        const result = await peopleWebSearch(config.companyName!, config.companyDomain!, fetch, undefined, undefined, job.id);
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
    if (config.workflow === "business" && config.discover && (!config.targetBusinesses || new Set(afterDiscovery?.newBusinessIds || []).size < config.targetBusinesses)) {
      const skip = new Set(afterDiscovery?.skipDomains || []);
      try { const web = await businessWebSeeds(config.searchTerms, config.geography, fetch, job.id); web.seeds = web.seeds.filter(url => !skip.has(researchDomain(url))); seeds = Array.from({ length: Math.max(seeds.length, web.seeds.length) }, (_, i) => [seeds[i], web.seeds[i]].filter((url): url is string => Boolean(url))).flat(); if (web.warning) warning = [warning, web.warning].filter(Boolean).join(" "); }
      catch { warning = [warning, "Public web discovery unavailable; directory and supplied websites retained."].filter(Boolean).join(" "); }
    }
    seeds = [...new Set(seeds)].slice(0, 100);
    await repo.seeds(jobId, seeds, warning || "Discovery complete");
    return Response.json({ seeds, warning, peopleLeadCount });
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
      if (event.data.page || ["complete", "partial", "failed"].includes(event.data.status)) await dispatchAutomaticEnrichment(job.organizationId, jobId);
    } else if (["complete", "partial", "failed"].includes(event.data.status) && !await dispatchContinuation(job.organizationId, jobId)) await dispatchBusinessPeople(job.organizationId, jobId);
  } catch (error) {
    console.info("research-diagnostic", JSON.stringify({ timestamp: new Date().toISOString(), jobId, event: "dispatch_deferred", reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
  }
  return Response.json({ ok: true });
}
