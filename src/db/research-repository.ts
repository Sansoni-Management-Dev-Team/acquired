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
    if (!job || terminalResearchStates.includes(job.status)) return;
    const config = job.config as ResearchConfig;
    if (
      event.pages > config.budget.maxPages ||
      event.modelCalls > config.budget.maxModelCalls
    )
      throw new Error("Research budget exceeded");
    if (event.page && publicResearchUrl(event.page.url)) {
      const sourceUrl = publicResearchUrl(event.page.url)!;
      const findings = validateFindings(
        event.page.findings,
        event.page.markdown,
        sourceUrl,
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
            targetId: linked[0]?.id,
            evidenceKey,
            sourceUrl,
            observedAt: new Date(event.page.observedAt),
            evidence: {
              ...evidence,
              source: "Cloudflare Browser Run + Workers AI",
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
