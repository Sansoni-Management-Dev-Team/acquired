import { compactResearchTimingQuery } from './research-timing-summary';
import type { CompactResearchTimingRun } from '@/domain/research-timing';
import { measureResearchSegment } from '@/lib/research-segment-timing';
import { validateCompanyIdentifiers } from '@/domain/company-identifiers';
import { researchTargetId } from './research-persistence-id';
import { saveResearchContact } from "./research-contacts";
import { reconcileResearchTarget } from './research-reconciliation';
import { mandateResearchSlot } from "@/domain/automatic-research";
import { modelHeadcountFinding, validateCompanyFacts } from "@/domain/company-facts";
import { ownCompany, relevantBusiness, validateBusinessFindings } from "@/domain/business-research";
import { directorySource } from "@/domain/discovery-sources";
import { AcquisitionRepository } from "./acquisition-repository";
import { OrganizationRepository } from "./repositories";
import { mapGooglePlace } from "@/adapters/firmable-mapper";
import { briefToMandate } from "@/domain/acquisition";
import { rankTarget } from "@/domain/scoring";
import { peopleFollowUpLinks, validatePeopleFindings } from "@/domain/people-research";
import { createHash } from "node:crypto";
import { and, desc, eq, getTableColumns, lt, notInArray, sql } from "drizzle-orm";
import { requireDb } from "./client";
import {
  researchJobs,
  researchFindings,
  targets,
  mandateTargets,
} from "./schema";
import {
  type ResearchConfig,
  type ResearchFinding,
  progressSchema,
  terminalResearchStates,
  validateFindings,
  publicResearchUrl,
} from "@/domain/research";
import type { z } from "zod";
export type ResearchJobRow = typeof researchJobs.$inferSelect;
export const researchExecutionSelection = { ...getTableColumns(researchJobs), config: sql<ResearchJobRow['config']>`${researchJobs.config} - 'pipelineTiming' - 'scheduling'` };
export const researchControlConfig = sql<ResearchJobRow['config']>`jsonb_build_object('researchRunId', ${researchJobs.config}->'researchRunId', 'budget', ${researchJobs.config}->'budget', 'automaticDeadline', ${researchJobs.config}->'automaticDeadline', 'newBusinessIds', ${researchJobs.config}->'newBusinessIds', 'performanceFlags', ${researchJobs.config}->'performanceFlags')`;
// Review screens need retry attempts and remaining URLs, but never saved HTML/markdown.
const researchReviewConfig = sql`CASE WHEN ${researchJobs.config} ? 'runtime' THEN jsonb_set(${researchJobs.config} - 'scheduling' - 'discoverySourceCandidates' - 'pipelineTiming', '{runtime}', (${researchJobs.config}->'runtime') - 'pendingPage' - 'bufferedPage') ELSE ${researchJobs.config} - 'scheduling' - 'discoverySourceCandidates' - 'pipelineTiming' END`;
// Search-history display uses query, reason and counts. Raw result snippets are
// planner input, retained in execution reads; they need not cross the DB boundary
// on every review poll. Keep timing samples intact for exact percentile parity.
export const researchReviewSelection = { ...getTableColumns(researchJobs), config: sql<ResearchJobRow['config']>`CASE WHEN jsonb_typeof(${researchJobs.config}->'discoveryAttempts') = 'array' THEN jsonb_set(${researchReviewConfig}, '{discoveryAttempts}', COALESCE((SELECT jsonb_agg(CASE WHEN jsonb_typeof(attempt) = 'object' THEN attempt - 'results' ELSE attempt END ORDER BY position) FROM jsonb_array_elements(${researchJobs.config}->'discoveryAttempts') WITH ORDINALITY AS history(attempt, position)), '[]'::jsonb)) ELSE ${researchReviewConfig} END` };
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
  async getExecution(id: string) {
    return (await this.db.select(researchExecutionSelection).from(researchJobs)
      .where(and(eq(researchJobs.id, id), eq(researchJobs.organizationId, this.org))).limit(1))[0];
  }
  async getControl(id: string) {
    return (await this.db.select({ id: researchJobs.id, organizationId: researchJobs.organizationId,
      status: researchJobs.status, revision: researchJobs.revision, updatedAt: researchJobs.updatedAt,
      createdAt: researchJobs.createdAt, crawlId: researchJobs.crawlId,
      config: researchControlConfig,
    }).from(researchJobs).where(and(eq(researchJobs.id, id), eq(researchJobs.organizationId, this.org))).limit(1))[0];
  }
  async concurrentResearchReady() {
    const result = await this.db.execute(sql`SELECT to_regclass('public.research_jobs_active_slot_idx') IS NOT NULL AS ready`);
    return (result as { rows?: { ready: boolean }[] }).rows?.[0]?.ready === true;
  }
  async hasOtherActive(id: string, mandateId: string) {
    const rows = await this.db.select({ id: researchJobs.id }).from(researchJobs).where(and(eq(researchJobs.organizationId, this.org), eq(researchJobs.mandateId, mandateId), sql`${researchJobs.id} <> ${id}`, notInArray(researchJobs.status, terminalResearchStates))).limit(1);
    return rows.length > 0;
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
      .limit(1000);
  }
  // Discovery planners need only candidates and goal progress from this run.
  // Filter before transferring JSON; historical runs can contain page markdown.
  discoveryRunJobs(rootId: string, mandateId: string) {
    return this.db.select({ id: researchJobs.id, status: researchJobs.status, seeds: researchJobs.seeds,
      config: sql<Pick<ResearchConfig, 'newBusinessIds' | 'discoveryCandidate' | 'companyDomain'>>`jsonb_build_object('newBusinessIds', ${researchJobs.config}->'newBusinessIds', 'discoveryCandidate', ${researchJobs.config}->'discoveryCandidate', 'companyDomain', ${researchJobs.config}->'companyDomain')`,
    }).from(researchJobs).where(and(eq(researchJobs.organizationId, this.org), eq(researchJobs.mandateId, mandateId),
      sql`(${researchJobs.id} = ${rootId} OR ${researchJobs.config}->>'researchRunId' = ${rootId})`))
      .orderBy(desc(researchJobs.createdAt)).limit(1000);
  }
  listReview(mandateId: string) {
    return this.db.select(researchReviewSelection).from(researchJobs)
      .where(and(eq(researchJobs.organizationId, this.org), eq(researchJobs.mandateId, mandateId)))
      .orderBy(desc(researchJobs.createdAt)).limit(1000);
  }
  async timingSummaries(jobs: Pick<ResearchJobRow, 'id'>[]) {
    if (!jobs.length) return {} as Record<string, CompactResearchTimingRun>;
    const relation = sql`SELECT ${researchJobs.id} AS id, ${researchJobs.createdAt} AS created_at, ${researchJobs.config} AS config, requested.job_order
      FROM jsonb_array_elements_text(${JSON.stringify(jobs.map(job=>job.id))}::jsonb) WITH ORDINALITY AS requested(id,job_order)
      INNER JOIN ${researchJobs} ON ${researchJobs.id} = requested.id::uuid
      WHERE ${researchJobs.organizationId} = ${this.org}`;
    const result = await this.db.execute(compactResearchTimingQuery(relation));
    const rows = (result as unknown as {rows:CompactResearchTimingRun[]}).rows;
    return Object.fromEntries(rows.map(row=>[row.runId,row]));
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
  // Every saved finding for the mandate's targets, including company-detail and
  // people jobs, so review screens can distinguish found-awaiting-review from unknown.
  targetEvidence(mandateId: string) {
    return this.db.select({ targetId: researchFindings.targetId, jobId: researchFindings.jobId, evidence: researchFindings.evidence })
      .from(researchFindings)
      .where(and(eq(researchFindings.organizationId, this.org), eq(researchFindings.mandateId, mandateId), sql`${researchFindings.targetId} IS NOT NULL`, sql`${researchFindings.evidence}->>'kind' IN ('headcount', 'revenue', 'person')`))
      .limit(5000);
  }
  async resultCounts(mandateId: string) {
    const rows = await this.db.select({
      jobId: researchFindings.jobId,
      // Full evidence set, independent of target creation and the UI's findings limit.
      businessDomains: sql<string[]>`coalesce(array_agg(distinct regexp_replace(lower(split_part(${researchFindings.sourceUrl}, '/', 3)), '^www[.]', '')) filter (where ${researchFindings.evidence}->>'kind' = 'company' and regexp_replace(lower(split_part(${researchFindings.evidence}->>'website', '/', 3)), '^www[.]', '') = regexp_replace(lower(split_part(${researchFindings.sourceUrl}, '/', 3)), '^www[.]', '')), array[]::text[])`,
      added: sql<number>`count(distinct case when ${targets.createdAt} >= ${researchJobs.createdAt} then ${targets.id} end)::int`,
      updated: sql<number>`count(distinct case when ${targets.createdAt} < ${researchJobs.createdAt} then ${targets.id} end)::int`,
      people: sql<number>`count(distinct case when ${researchFindings.evidence}->>'kind' = 'person' then lower(${researchFindings.evidence}->>'name') end)::int`,
    }).from(researchFindings)
      .innerJoin(researchJobs, eq(researchJobs.id, researchFindings.jobId))
      .leftJoin(targets, and(eq(targets.id, researchFindings.targetId), eq(targets.organizationId, this.org)))
      .where(and(eq(researchFindings.organizationId, this.org), eq(researchFindings.mandateId, mandateId)))
      .groupBy(researchFindings.jobId);
    return rows.map(row => ({ ...row, businessDomains: row.businessDomains.filter(domain => domain && !directorySource(`https://${domain}/`)) }));
  }
  async recordNewBusiness(id: string, targetId: string, snapshot?: ResearchJobRow) {
    if (snapshot && (snapshot.id !== id || snapshot.organizationId !== this.org)) throw new Error("Invalid research snapshot");
    const job = snapshot || await this.getExecution(id);
    if (!job) return;
    const config = job.config as ResearchConfig;
    if (!config.targetBusinesses || config.purpose) return;
    const [target] = await this.db.select({ createdAt: targets.createdAt }).from(targets)
      .where(and(eq(targets.id, targetId), eq(targets.organizationId, this.org))).limit(1);
    if (!target || target.createdAt.getTime() < new Date(config.businessTargetStartedAt || job.createdAt).getTime()) return;
    const mergedIds = sql`(SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(COALESCE(${researchJobs.config}->'newBusinessIds', '[]'::jsonb) || ${JSON.stringify([targetId])}::jsonb))`;
    const milestoneAt = new Date().toISOString();
    const milestones = sql`COALESCE(${researchJobs.config}->'researchMilestones', '{}'::jsonb) || jsonb_build_object('firstCompanyAt', COALESCE(${researchJobs.config}->'researchMilestones'->>'firstCompanyAt', ${milestoneAt})) || CASE WHEN jsonb_array_length(${mergedIds}) >= COALESCE((${researchJobs.config}->>'targetBusinesses')::int, 20) THEN jsonb_build_object('targetReachedAt', COALESCE(${researchJobs.config}->'researchMilestones'->>'targetReachedAt', ${milestoneAt})) ELSE '{}'::jsonb END`;
    await this.db.update(researchJobs).set({ config: sql`jsonb_set(jsonb_set(${researchJobs.config}, '{newBusinessIds}', ${mergedIds}), '{researchMilestones}', ${milestones})` })
      .where(and(sql`${researchJobs.id} IN (${id}, ${config.discoveryCandidate || config.researchTask === "website" || config.researchTask === "page" ? config.researchRunId || id : id})`, eq(researchJobs.organizationId, this.org)));
  }
  async create(
    id: string,
    mandateId: string,
    createdBy: string,
    config: ResearchConfig,
  ) {
    config = { ...config, pipelineTiming: undefined, executionSlot: mandateResearchSlot(mandateId, config.executionSlot) };
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
  // Search-snippet estimates come from result text, not a read page; they are saved
  // against the target at low confidence and never satisfy a missing-field check.
  async saveSnippetEstimates(id: string, estimates: (ResearchFinding & { sourceUrl: string })[]) {
    const job = await this.get(id);
    if (!job) return 0;
    const config = job.config as ResearchConfig;
    if (!config.targetId) return 0;
    let saved = 0;
    for (const { sourceUrl, ...evidence } of estimates) {
      const evidenceKey = createHash("sha256").update(JSON.stringify([sourceUrl, evidence.kind, evidence.name, evidence.value, evidence.quote])).digest("hex");
      const result = await this.db.insert(researchFindings).values({ jobId: id, organizationId: this.org, mandateId: job.mandateId, targetId: config.targetId, evidenceKey, sourceUrl, observedAt: new Date(), evidence: { ...evidence, source: "Search result snippet — unverified estimate", status: "unverified", truncated: false }, confidence: 0.2 }).onConflictDoNothing().returning({ id: researchFindings.id });
      saved += result.length;
    }
    return saved;
  }
  async recoverStopped(id: string, revision: number, pages: number) {
    await this.db.update(researchJobs).set({ status: pages ? "partial" : "failed", message: "Worker stopped unexpectedly; saved evidence retained. Start a new run or continue remaining URLs.", updatedAt: new Date() }).where(and(eq(researchJobs.id, id), eq(researchJobs.organizationId, this.org), eq(researchJobs.revision, revision), notInArray(researchJobs.status, terminalResearchStates)));
  }
  async cancelRun(id: string) {
    const job = await this.get(id);
    if (!job) return [];
    const rootId = (job.config as ResearchConfig).researchRunId || id;
    return this.db.update(researchJobs).set({ status: "cancelled", message: "Research stopped; saved evidence retained", updatedAt: new Date() }).where(and(eq(researchJobs.organizationId, this.org), sql`(${researchJobs.id} = ${rootId} OR ${researchJobs.config}->>'researchRunId' = ${rootId})`, sql`(${researchJobs.id} = ${rootId} OR ${researchJobs.status} NOT IN ('complete', 'partial', 'failed', 'cancelled'))`)).returning({ id: researchJobs.id });
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
  async cancelDiscoveryCandidates(rootId: string) {
    return this.db.update(researchJobs).set({ status: "cancelled", message: "Target reached; surplus candidate research stopped", updatedAt: new Date() }).where(and(
      eq(researchJobs.organizationId, this.org),
      sql`${researchJobs.config}->>'researchRunId' = ${rootId}`,
      sql`${researchJobs.config}->>'discoveryCandidate' = 'true'`,
      notInArray(researchJobs.status, terminalResearchStates),
    )).returning({ id: researchJobs.id });
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
  async progress(id: string, event: z.infer<typeof progressSchema>, snapshot?: ResearchJobRow) {
    if (snapshot && (snapshot.id !== id || snapshot.organizationId !== this.org)) throw new Error("Invalid research snapshot");
    const job = snapshot || await this.getExecution(id);
    if (
      !job ||
      terminalResearchStates.includes(job.status) ||
      event.revision <= job.revision
    )
      return job;
    const config = job.config as ResearchConfig;
    if (
      event.pages > config.budget.maxPages ||
      event.modelCalls > config.budget.maxModelCalls ||
      (event.runtime?.attempts.length ?? 0) > config.budget.maxPages
    )
      throw new Error("Research budget exceeded");
    if (event.page && publicResearchUrl(event.page.url)) {
      const page = event.page;
      const sourceUrl = publicResearchUrl(page.url)!;
      const modelHeadcounts = (input: unknown, markdown: string, source: string) => (Array.isArray(input) ? input : []).flatMap((raw: unknown) => { const f = raw as { kind?: unknown; value?: unknown; quote?: unknown }; const located = f?.kind === "headcount" ? modelHeadcountFinding({ value: f.value, quote: f.quote }, markdown, source, config) : null; return located ? [located] : []; });
      const findings = await measureResearchSegment(id, this.org, 'evidence-validation', 'persistence', async () => {
      const validated = (config.purpose === "firmographics" ? (input: unknown, markdown: string, source: string) => { const labelled = validateCompanyFacts(input, markdown, source, config); return [...labelled, ...(labelled.some(f => f.kind === "headcount") ? [] : modelHeadcounts(input, markdown, source)), ...validatePeopleFindings(input, markdown, source, config).filter(f => f.kind === "person"), ...(config.mode === "automatic" && new URL(source).hostname.replace(/^www\./, "") === config.companyDomain ? validateBusinessFindings(input, markdown, source, config) : [])]; } : config.purpose === "people" ? (input: unknown, markdown: string, source: string) => [...validatePeopleFindings(input, markdown, source, config), ...validateCompanyFacts(input, markdown, source, config)] : config.workflow === "business" ? (input: unknown, markdown: string, source: string) => validateBusinessFindings(input, markdown, source, config) : validateFindings)(
        page.findings,
        page.markdown,
        sourceUrl,
        config.searchTerms,
      );
      return [...validated, ...validateCompanyIdentifiers(page.findings, page.markdown, sourceUrl, config), ...(config.researchTask === 'website' || config.researchTask === 'page' ? [...validateCompanyFacts(page.findings, page.markdown, sourceUrl, config), ...validatePeopleFindings(page.findings, page.markdown, sourceUrl, config).filter(f => f.kind === 'person')] : [])];
      });
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
          and(eq(targets.organizationId, this.org), eq(targets.domain, config.purpose ? config.companyDomain! : domain), ...(config.targetId ? [eq(targets.id, config.targetId)] : [])),
        )
        .limit(1);
      // Only a literal first-party company assertion may create a new business, and
      // never from a directory, register, association or social listing page.
      let targetId = config.targetId || linked[0]?.id;
      const company = ownCompany(findings, sourceUrl);
      // ...and only when the page also shows what the business makes, does or sells; identity alone is not a lead.
      const businessFit = findings.some(f => ["product", "capability", "customer", "business_role"].includes(f.kind));
      if (!targetId && config.workflow === "business" && company && businessFit && !directorySource(sourceUrl, page.markdown) && (!config.targetBusinesses || new Set(config.newBusinessIds || []).size < config.targetBusinesses)) {
        const acquisition = new AcquisitionRepository(this.org, this.db);
        const mandate = await acquisition.getMandate(job.mandateId);
        if (mandate) {
          const filters = briefToMandate(mandate.brief);
          const candidate = mapGooglePlace({ id: domain, name: company.name, website: `https://${domain}/`, formattedAddress: "Unknown", discoverySource: "manufacturing-directory", manufacturingDirectory: { recordId: domain, name: company.name, website: `https://${domain}/`, description: company.quote, categories: [], keywords: [], capabilities: [], sourceRecords: [{ source: "Public website research", sourceId: domain, sourceUrl }] } }, filters, this.org, "Website identity observed; review financial fit");
          const saved = await new OrganizationRepository(this.db, this.org).upsertEnrichedTarget({ target: rankTarget(candidate, filters), mandateId: job.mandateId, actorId: job.createdBy, creationId: researchTargetId(this.org, domain) });
          if (saved) { await acquisition.attach(job.mandateId, saved.id); targetId = saved.id; }
        }
      }
      let earlier: { evidence: unknown; sourceUrl: string; observedAt: Date }[] = [];
      if (targetId && config.parallelBusinessResearch) {
        // Field jobs may finish before the website identifies and saves its target.
        // Attach those source-validated findings when that domain becomes known.
        earlier = await this.db.update(researchFindings).set({ targetId }).where(and(eq(researchFindings.organizationId, this.org), eq(researchFindings.mandateId, job.mandateId), sql`${researchFindings.targetId} IS NULL`, sql`${researchFindings.jobId} IN (SELECT id FROM research_jobs WHERE organization_id = ${this.org} AND config->>'researchRunId' = ${config.researchRunId || id} AND config->>'companyDomain' = ${config.companyDomain || domain})`)).returning({ evidence: researchFindings.evidence, sourceUrl: researchFindings.sourceUrl, observedAt: researchFindings.observedAt });
        for (const saved of earlier) {
          const evidence = saved.evidence as ResearchFinding;
          if (evidence.kind === 'person') await saveResearchContact({ database: this.db, organizationId: this.org, targetId, evidence, sourceUrl: saved.sourceUrl, observedAt: saved.observedAt });
        }
      }
      const previousAbn = earlier.find(f => (f.evidence as ResearchFinding).kind === 'identifier' && (f.evidence as ResearchFinding).name === 'ABN');
      const abn = findings.find(f => f.kind === 'identifier' && f.name === 'ABN') || previousAbn?.evidence as ResearchFinding | undefined;
      if (targetId && abn) await this.db.update(targets).set({ identifiers: sql`${targets.identifiers} || ${JSON.stringify({ abn: abn.value, identityEvidence: { sourceUrl: previousAbn?.sourceUrl || sourceUrl, observedAt: previousAbn?.observedAt.toISOString() || page.observedAt, quote: abn.quote } })}::jsonb`, updatedAt: new Date() }).where(and(eq(targets.id, targetId), eq(targets.organizationId, this.org)));
      if (targetId && ((config.workflow === "business" && config.findPeople) || (config.purpose === "firmographics" && config.parentJobId))) {
        const links = peopleFollowUpLinks(page.markdown, sourceUrl, [], config.purpose ? config : undefined).filter(url => new URL(url).hostname.replace(/^www\./, "") === domain).slice(0, 8);
        const ownerJob = config.purpose === "firmographics" ? config.parentJobId! : id;
        // Preserve earlier team links when later pages add contact/about links.
        if (links.length) await this.db.update(researchJobs).set({ config: sql`jsonb_set(${researchJobs.config}, '{peopleLinks}', jsonb_set(COALESCE(${researchJobs.config}->'peopleLinks', '{}'::jsonb), ARRAY[${targetId}]::text[], COALESCE(${researchJobs.config}->'peopleLinks'->${targetId}, '[]'::jsonb) || ${JSON.stringify(links)}::jsonb))` }).where(and(eq(researchJobs.id, ownerJob), eq(researchJobs.organizationId, this.org)));
      }
      const pageFindings = (config.purpose === "firmographics" && !targetId && !config.researchTask ? [] : findings);
      const rows = pageFindings.map(evidence => {
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
        return {
            jobId: id,
            organizationId: this.org,
            mandateId: job.mandateId,
            targetId,
            evidenceKey,
            sourceUrl,
            observedAt: new Date(page.observedAt),
            evidence: {
              ...evidence,
              source: config.purpose === "firmographics" ? "Public web research — validated source statement" : ["Catalogue product listing", "Stated supply activity", "Stated product supply"].includes(evidence.name) ? "Cloudflare Browser Run — directly observed website evidence" : "Cloudflare Browser Run + Workers AI",
              status: "unverified",
              truncated: page.truncated,
            },
            confidence: evidence.factMetadata?.basis === "search_snippet" ? 0.2 : evidence.factMetadata?.identityNote ? 0.2 : evidence.factMetadata?.basis === "third_party_estimate" ? 0.3 : 0.5,
          };
      });
      if (rows.length) await measureResearchSegment(id, this.org, 'evidence-persistence', 'persistence', async () => { await this.db.insert(researchFindings).values(rows).onConflictDoNothing(); });
      for (const evidence of pageFindings) {
        if (targetId && evidence.kind === "person") await saveResearchContact({ database: this.db, organizationId: this.org, targetId, evidence, sourceUrl, observedAt: new Date(page.observedAt) });
      }
      if (targetId && [...pageFindings, ...earlier.map(f => f.evidence as ResearchFinding)].some(f => ['headcount', 'revenue', 'founded_year'].includes(f.kind))) await reconcileResearchTarget(this.db, this.org, targetId);
      // A qualifying company counts only after its evidence/contact writes
      // succeed. Failed persistence remains retryable without a false milestone.
      if (targetId && relevantBusiness(pageFindings)) await this.recordNewBusiness(id, targetId, job);
    }
    let updatedConfig = event.runtime ? sql`jsonb_set(${researchJobs.config}, '{runtime}', ${JSON.stringify(event.runtime)}::jsonb)` : sql`${researchJobs.config}`;
    for (const key of ['targetedSearchDeferred', 'followupPlannerUsed', 'followupExhaustedFields', 'followupSearchCounts', 'followupEmptySearchCounts'] as const) {
      if (event[key] !== undefined) updatedConfig = sql`jsonb_set(${updatedConfig}, ARRAY[${key}]::text[], ${JSON.stringify(event[key])}::jsonb)`;
    }
    if (config.enrichmentPhase && event.enrichmentPendingFields) updatedConfig = sql`jsonb_set(${updatedConfig}, '{enrichmentPendingFields}', ${JSON.stringify(event.enrichmentPendingFields)}::jsonb)`;
    const [saved] = await this.db
      .update(researchJobs)
      .set({
        status: event.status,
        revision: event.revision,
        pages: sql`greatest(${researchJobs.pages}, ${event.pages})`,
        modelCalls: sql`greatest(${researchJobs.modelCalls}, ${event.modelCalls})`,
        message: event.message,
        ...(event.crawlId !== undefined ? { crawlId: event.crawlId } : {}),
        config: updatedConfig,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(researchJobs.id, id),
          eq(researchJobs.organizationId, this.org),
          lt(researchJobs.revision, event.revision),
          notInArray(researchJobs.status, terminalResearchStates),
        ),
      ).returning(researchExecutionSelection);
    return saved || await this.getExecution(id);
  }
}
