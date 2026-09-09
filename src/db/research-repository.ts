import { validateCompanyFacts } from "@/domain/company-facts";
import { ownCompany, validateBusinessFindings } from "@/domain/business-research";
import { AcquisitionRepository } from "./acquisition-repository";
import { OrganizationRepository } from "./repositories";
import { mapGooglePlace } from "@/adapters/firmable-mapper";
import { briefToMandate } from "@/domain/acquisition";
import { rankTarget } from "@/domain/scoring";
import { peopleFollowUpLinks, validatePeopleFindings } from "@/domain/people-research";
import { createHash } from "node:crypto";
import { and, desc, eq, lt, notInArray, sql } from "drizzle-orm";
import { requireDb } from "./client";
import {
  researchJobs,
  researchFindings,
  targets,
  mandateTargets,
} from "./schema";
import {
  type ResearchConfig,
  progressSchema,
  terminalResearchStates,
  validateFindings,
  publicResearchUrl,
} from "@/domain/research";
import type { z } from "zod";
export class ResearchRepository {
  constructor(
    private org: string,
    private db = requireDb(),
  ) {}
  async get(id: string) {
    return (
      await this.db
        .select()
        .from(researchJobs)
        .where(
          and(
            eq(researchJobs.id, id),
            eq(researchJobs.organizationId, this.org),
          ),
        )
        .limit(1)
    )[0];
  }
  list(mandateId: string) {
    return this.db
      .select()
      .from(researchJobs)
      .where(
        and(
          eq(researchJobs.organizationId, this.org),
          eq(researchJobs.mandateId, mandateId),
        ),
      )
      .orderBy(desc(researchJobs.createdAt))
      .limit(20);
  }
  findings(mandateId: string) {
    return this.db
      .select()
      .from(researchFindings)
      .where(
        and(
          eq(researchFindings.organizationId, this.org),
          eq(researchFindings.mandateId, mandateId),
          sql`${researchFindings.jobId} NOT IN (SELECT ${researchJobs.id} FROM ${researchJobs} WHERE ${researchJobs.config}->>'purpose' IN ('people', 'firmographics'))`,
        ),
      )
      .orderBy(desc(researchFindings.observedAt))
      .limit(100);
  }
  resultCounts(mandateId: string) {
    return this.db.select({
      jobId: researchFindings.jobId,
      added: sql<number>`count(distinct case when ${targets.createdAt} >= ${researchJobs.createdAt} then ${targets.id} end)::int`,
      updated: sql<number>`count(distinct case when ${targets.createdAt} < ${researchJobs.createdAt} then ${targets.id} end)::int`,
      people: sql<number>`count(distinct case when ${researchFindings.evidence}->>'kind' = 'person' then lower(${researchFindings.evidence}->>'name') end)::int`,
    }).from(researchFindings)
      .innerJoin(researchJobs, eq(researchJobs.id, researchFindings.jobId))
      .leftJoin(targets, and(eq(targets.id, researchFindings.targetId), eq(targets.organizationId, this.org)))
      .where(and(eq(researchFindings.organizationId, this.org), eq(researchFindings.mandateId, mandateId)))
      .groupBy(researchFindings.jobId);
  }
  async recordNewBusiness(id: string, targetId: string) {
    const job = await this.get(id);
    if (!job) return;
    const config = job.config as ResearchConfig;
    if (!config.targetBusinesses || config.purpose) return;
    const [target] = await this.db.select({ createdAt: targets.createdAt }).from(targets)
      .where(and(eq(targets.id, targetId), eq(targets.organizationId, this.org))).limit(1);
    if (!target || target.createdAt.getTime() < new Date(config.businessTargetStartedAt || job.createdAt).getTime()) return;
    await this.db.update(researchJobs).set({ config: sql`jsonb_set(${researchJobs.config}, '{newBusinessIds}', (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(COALESCE(${researchJobs.config}->'newBusinessIds', '[]'::jsonb) || ${JSON.stringify([targetId])}::jsonb)))` })
      .where(and(eq(researchJobs.id, id), eq(researchJobs.organizationId, this.org)));
  }
  async create(
    id: string,
    mandateId: string,
    createdBy: string,
    config: ResearchConfig,
  ) {
    await this.db
      .insert(researchJobs)
      .values({
        id,
        mandateId,
        createdBy,
        organizationId: this.org,
        config: config.targetBusinesses ? { ...config, businessTargetStartedAt: config.businessTargetStartedAt || new Date().toISOString() } : config,
        seeds: config.seeds.map(publicResearchUrl).filter(Boolean),
      })
      .onConflictDoNothing();
    const job = await this.get(id);
    if (!job || job.mandateId !== mandateId)
      throw new Error(
        "Another research job is active. Wait for it to finish or cancel it.",
      );
    return job;
  }
  async recoverStopped(id: string, revision: number, pages: number) {
    await this.db.update(researchJobs).set({ status: pages ? "partial" : "failed", message: "Worker stopped unexpectedly; saved evidence retained. Start a new run or continue remaining URLs.", updatedAt: new Date() }).where(and(eq(researchJobs.id, id), eq(researchJobs.organizationId, this.org), eq(researchJobs.revision, revision), notInArray(researchJobs.status, terminalResearchStates)));
  }
  async cancel(id: string) {
    await this.db
      .update(researchJobs)
      .set({
        status: "cancelled",
        message: "Cancelled; saved evidence retained",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(researchJobs.id, id),
          eq(researchJobs.organizationId, this.org),
          notInArray(researchJobs.status, terminalResearchStates),
        ),
      );
    return this.get(id);
  }
  async claimDiscovery(id: string) {
    return (
      (
        await this.db
          .update(researchJobs)
          .set({
            discoveryStarted: true,
            status: "discovering",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(researchJobs.id, id),
              eq(researchJobs.organizationId, this.org),
              eq(researchJobs.discoveryStarted, false),
              notInArray(researchJobs.status, terminalResearchStates),
            ),
          )
          .returning()
      ).length > 0
    );
  }
  async seeds(id: string, seeds: string[], message: string) {
    await this.db
      .update(researchJobs)
      .set({ seeds, message, updatedAt: new Date() })
      .where(
        and(
          eq(researchJobs.id, id),
          eq(researchJobs.organizationId, this.org),
          notInArray(researchJobs.status, terminalResearchStates),
        ),
      );
  }
  async progress(id: string, event: z.infer<typeof progressSchema>) {
    const job = await this.get(id);
    if (
      !job ||
      terminalResearchStates.includes(job.status) ||
      event.revision <= job.revision
    )
      return;
    const config = job.config as ResearchConfig;
    if (
      event.pages > config.budget.maxPages ||
      event.modelCalls > config.budget.maxModelCalls ||
      (event.runtime?.attempts.length ?? 0) > config.budget.maxPages
    )
      throw new Error("Research budget exceeded");
    if (event.page && publicResearchUrl(event.page.url)) {
      const sourceUrl = publicResearchUrl(event.page.url)!;
      const findings = (config.purpose === "firmographics" ? (input: unknown, markdown: string, source: string) => validateCompanyFacts(input, markdown, source, config) : config.purpose === "people" ? (input: unknown, markdown: string, source: string) => validatePeopleFindings(input, markdown, source, config) : config.workflow === "business" ? (input: unknown, markdown: string, source: string) => validateBusinessFindings(input, markdown, source, config) : validateFindings)(
        event.page.findings,
        event.page.markdown,
        sourceUrl,
        config.searchTerms,
      );
      const domain = new URL(sourceUrl).hostname.replace(/^www\./, "");
      const linked = await this.db
        .select({ id: targets.id })
        .from(targets)
        .innerJoin(
          mandateTargets,
          and(
            eq(mandateTargets.targetId, targets.id),
            eq(mandateTargets.mandateId, job.mandateId),
            eq(mandateTargets.organizationId, this.org),
          ),
        )
        .where(
          and(eq(targets.organizationId, this.org), eq(targets.domain, config.purpose === "firmographics" ? config.companyDomain! : domain), ...(config.purpose === "firmographics" ? [eq(targets.id, config.targetId!)] : [])),
        )
        .limit(1);
      // Only a literal first-party company assertion may create a new business.
      let targetId = config.purpose === "people" ? config.targetId : linked[0]?.id;
      const company = ownCompany(findings, sourceUrl);
      if (!targetId && config.workflow === "business" && company && (!config.targetBusinesses || new Set(config.newBusinessIds || []).size < config.targetBusinesses)) {
        const acquisition = new AcquisitionRepository(this.org, this.db);
        const mandate = await acquisition.getMandate(job.mandateId);
        if (mandate) {
          const filters = briefToMandate(mandate.brief);
          const candidate = mapGooglePlace({ id: domain, name: company.name, website: `https://${domain}/`, formattedAddress: "Unknown", discoverySource: "manufacturing-directory", manufacturingDirectory: { recordId: domain, name: company.name, website: `https://${domain}/`, description: company.quote, categories: [], keywords: [], capabilities: [], sourceRecords: [{ source: "Public website research", sourceId: domain, sourceUrl }] } }, filters, this.org, "Website identity observed; review financial fit");
          const saved = await new OrganizationRepository(this.db, this.org).upsertEnrichedTarget({ target: rankTarget(candidate, filters), mandateId: job.mandateId, actorId: job.createdBy });
          if (saved) { await acquisition.attach(job.mandateId, saved.id); targetId = saved.id; }
        }
      }
      if (targetId) await this.recordNewBusiness(id, targetId);
      if (targetId && ((config.workflow === "business" && config.findPeople) || (config.purpose === "firmographics" && config.parentJobId))) {
        const links = peopleFollowUpLinks(event.page.markdown, sourceUrl, [], config.purpose ? config : undefined).filter(url => new URL(url).hostname.replace(/^www\./, "") === domain).slice(0, 8);
        const ownerJob = config.purpose === "firmographics" ? config.parentJobId! : id;
        // Preserve earlier team links when later pages add contact/about links.
        if (links.length) await this.db.update(researchJobs).set({ config: sql`jsonb_set(${researchJobs.config}, '{peopleLinks}', jsonb_set(COALESCE(${researchJobs.config}->'peopleLinks', '{}'::jsonb), ARRAY[${targetId}]::text[], COALESCE(${researchJobs.config}->'peopleLinks'->${targetId}, '[]'::jsonb) || ${JSON.stringify(links)}::jsonb))` }).where(and(eq(researchJobs.id, ownerJob), eq(researchJobs.organizationId, this.org)));
      }
      for (const evidence of (config.purpose === "firmographics" && !targetId ? [] : findings)) {
        const evidenceKey = createHash("sha256")
          .update(
            JSON.stringify([
              sourceUrl,
              evidence.kind,
              evidence.name,
              evidence.value,
              evidence.quote,
            ]),
          )
          .digest("hex");
        await this.db
          .insert(researchFindings)
          .values({
            jobId: id,
            organizationId: this.org,
            mandateId: job.mandateId,
            targetId,
            evidenceKey,
            sourceUrl,
            observedAt: new Date(event.page.observedAt),
            evidence: {
              ...evidence,
              source: config.purpose === "firmographics" ? "Public web research — validated source statement" : ["Catalogue product listing", "Stated supply activity", "Stated product supply"].includes(evidence.name) ? "Cloudflare Browser Run — directly observed website evidence" : "Cloudflare Browser Run + Workers AI",
              status: "unverified",
              truncated: event.page.truncated,
            },
            confidence: evidence.factMetadata?.basis === "third_party_estimate" ? 0.3 : 0.5,
          })
          .onConflictDoNothing();
      }
    }
    await this.db
      .update(researchJobs)
      .set({
        status: event.status,
        revision: event.revision,
        pages: sql`greatest(${researchJobs.pages}, ${event.pages})`,
        modelCalls: sql`greatest(${researchJobs.modelCalls}, ${event.modelCalls})`,
        message: event.message,
        ...(event.crawlId !== undefined ? { crawlId: event.crawlId } : {}),
        ...(event.runtime
          ? {
              config: sql`jsonb_set(${researchJobs.config}, '{runtime}', ${JSON.stringify(event.runtime)}::jsonb)`,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(researchJobs.id, id),
          eq(researchJobs.organizationId, this.org),
          lt(researchJobs.revision, event.revision),
          notInArray(researchJobs.status, terminalResearchStates),
        ),
      );
  }
}
