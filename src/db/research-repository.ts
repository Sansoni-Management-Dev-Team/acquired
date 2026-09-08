import { validatePeopleFindings } from "@/domain/people-research";
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
          sql`${researchFindings.jobId} NOT IN (SELECT ${researchJobs.id} FROM ${researchJobs} WHERE ${researchJobs.config}->>'purpose' = 'people')`,
        ),
      )
      .orderBy(desc(researchFindings.observedAt))
      .limit(100);
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
        config,
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
      event.modelCalls > config.budget.maxModelCalls
    )
      throw new Error("Research budget exceeded");
    if (event.page && publicResearchUrl(event.page.url)) {
      const sourceUrl = publicResearchUrl(event.page.url)!;
      const findings = (config.purpose === "people" ? (input: unknown, markdown: string, source: string) => validatePeopleFindings(input, markdown, source, config) : validateFindings)(
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
          and(eq(targets.organizationId, this.org), eq(targets.domain, domain)),
        )
        .limit(1);
      for (const evidence of findings) {
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
            targetId: config.purpose === "people" ? config.targetId : linked[0]?.id,
            evidenceKey,
            sourceUrl,
            observedAt: new Date(event.page.observedAt),
            evidence: {
              ...evidence,
              source: ["Catalogue product listing", "Stated supply activity", "Stated product supply"].includes(evidence.name) ? "Cloudflare Browser Run — directly observed website evidence" : "Cloudflare Browser Run + Workers AI",
              status: "unverified",
              truncated: event.page.truncated,
            },
            confidence: 0.5,
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
