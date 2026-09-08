import { cloudflareWebSearch } from "@/adapters/cloudflare-web-search";
import { businessWebSeeds } from "@/adapters/business-web-search";
import { dispatchBusinessPeople } from "@/lib/business-research-people";
import { peopleWebSeeds } from "@/adapters/people-web-search";
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
  return Response.json(
    {
      status: job.status,
      crawlId: job.crawlId,
      config,
      seeds: job.seeds,
      deadline: job.createdAt.getTime() + config.budget.maxMinutes * 60000,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
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
  if (payload?.action === "people-followup") {
    const config = job.config as ResearchConfig;
    if (config.purpose !== "people" || config.maxPeopleSearches !== 2 || terminalResearchStates.includes(job.status)) return Response.json({ seeds: [] });
    const findings = await requireDb().select().from(researchFindings).where(and(eq(researchFindings.jobId, job.id), eq(researchFindings.organizationId, job.organizationId)));
    const candidate = findings.map(f => f.evidence as { kind?: string; name?: string; value?: string }).find(f => f.kind === "identifier" && f.name === "Legal entity");
    if (!candidate?.value) return Response.json({ seeds: [] });
    const claimed = await requireDb().update(researchJobs).set({ config: sql`jsonb_set(jsonb_set(${researchJobs.config}, '{peopleFollowupStarted}', 'true'::jsonb), '{legalEntity}', ${JSON.stringify(candidate.value)}::jsonb)` }).where(and(eq(researchJobs.id, job.id), sql`COALESCE(${researchJobs.config}->>'peopleFollowupStarted', 'false') = 'false'`, notInArray(researchJobs.status, terminalResearchStates))).returning({ id: researchJobs.id });
    if (!claimed.length) return Response.json({ seeds: [] });
    try { return Response.json({ seeds: await peopleWebSeeds(config.companyName!, config.companyDomain!, fetch, candidate.value) }); }
    catch { return Response.json({ seeds: [], warning: "Legal-entity follow-up search unavailable; saved website research retained." }); }
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
    if (config.purpose === "firmographics" && config.discover) {
      try { seeds.push(...await cloudflareWebSearch(`"${config.companyName}" ${config.companyDomain} LinkedIn company size employees`)); }
      catch { warning = "Public profile search unavailable; company website research continues."; }
    } else if (config.purpose === "people" && config.discover) {
      try { seeds.push(...await peopleWebSeeds(config.companyName!, config.companyDomain!)); }
      catch { warning = "Public web search unavailable; company website research continues."; }
    } else if (config.discover) {
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
        // Prefer exact directory searches for separate capabilities; existing company identities are reused.
        for (const target of discovery.targets.slice(0, 100)) {
          const saved = await companies.upsertEnrichedTarget({
            target: rankTarget(target, filters),
            mandateId: job.mandateId,
            actorId: job.createdBy,
          });
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
    if (config.workflow === "business" && config.discover) {
      try { const web = await businessWebSeeds(config.searchTerms, config.geography); seeds = Array.from({ length: Math.max(seeds.length, web.seeds.length) }, (_, i) => [seeds[i], web.seeds[i]].filter((url): url is string => Boolean(url))).flat(); if (web.warning) warning = [warning, web.warning].filter(Boolean).join(" "); }
      catch { warning = [warning, "Public web discovery unavailable; directory and supplied websites retained."].filter(Boolean).join(" "); }
    }
    seeds = [...new Set(seeds)].slice(0, 100);
    await repo.seeds(jobId, seeds, warning || "Discovery complete");
    return Response.json({ seeds, warning });
  }
  const event = progressSchema.safeParse(payload);
  if (!event.success)
    return Response.json({ error: "Invalid progress event" }, { status: 400 });
  try {
    await repo.progress(jobId, event.data);
    if (["complete", "partial", "failed"].includes(event.data.status)) await dispatchBusinessPeople(job.organizationId, jobId);
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Unable to record progress" },
      { status: 409 },
    );
  }
}
