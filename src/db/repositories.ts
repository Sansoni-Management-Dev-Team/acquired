import { and, desc, eq } from "drizzle-orm";
import type { db as databaseType } from "./client";
import { auditEvents, mandates, signals, targets } from "./schema";
import { targetRecordToRankedTarget } from "./target-record-mapper";
import type { Mandate, RankedTarget } from "@/domain/models";
import { targetEvidence } from "@/domain/target-evidence";

type Database = NonNullable<typeof databaseType>;

export class OrganizationRepository {
  constructor(private database: Database, private organizationId: string) {
    if (!organizationId) throw new Error("organizationId is required for every repository");
  }

  listTargets() {
    return this.database.select().from(targets).where(eq(targets.organizationId, this.organizationId)).orderBy(desc(targets.createdAt));
  }

  async listRankedTargets() {
    const [targetRows, signalRows] = await Promise.all([
      this.listTargets(),
      this.database.select().from(signals).where(eq(signals.organizationId, this.organizationId)),
    ]);
    return targetRows.map((target) => targetRecordToRankedTarget(
      target,
      signalRows.filter((signal) => signal.targetId === target.id),
    ));
  }

  async createMandate(input: { naturalLanguage: string; filters: Mandate; confirmation: string; createdBy: string }) {
    const [created] = await this.database.insert(mandates).values({
      organizationId: this.organizationId,
      naturalLanguage: input.naturalLanguage,
      filters: input.filters,
      confirmation: input.confirmation,
      provenance: { source: "Deterministic natural-language parser", capturedAt: new Date().toISOString() },
      createdBy: input.createdBy,
    }).returning({ id: mandates.id });
    return created;
  }

  async upsertEnrichedTarget(input: { target: RankedTarget; mandateId: string; actorId: string }) {
    const { target, mandateId, actorId } = input;
    const firmable = target.sourceData?.firmable;
    if (!firmable || target.status !== "enriched" || !target.domain) return null;
    const identifiers = {
      googlePlaceId: target.sourceData?.googlePlaces?.placeId,
      firmableId: firmable.firmableId,
      manufacturingDirectoryRecordId: target.sourceData?.manufacturingDirectory?.recordId,
      abn: firmable.abn,
      acn: firmable.acn,
      anzsic: firmable.anzsic,
    };
    // Google content remains transient except for the storable Place ID. The persisted company
    // profile and outreach context are derived from Firmable's company-enrichment response.
    const firmographics = {
      suburb: target.suburb,
      state: target.state,
      sector: target.sector,
      revenue: target.revenue,
      ebitda: target.ebitda,
      headcount: target.headcount,
      establishedYear: target.establishedYear,
      firmable,
      manufacturingDirectory: target.sourceData?.manufacturingDirectory,
      outreachContext: {
        companyName: target.companyName,
        domain: target.domain,
        description: firmable.description,
        tagline: firmable.tagline,
        industries: firmable.industries,
        keywords: firmable.keywords,
        headquarters: firmable.headquarters,
        locations: firmable.locations,
        yearFounded: firmable.yearFounded,
      },
      scoreExplanation: {
        tensions: target.scores.tensions,
        reasons: target.scores.reasons,
      },
    };
    const values = {
      mandateId,
      companyName: target.companyName,
      domain: target.domain,
      identifiers,
      firmographics,
      fitScore: target.scores.fit,
      ripenessScore: target.scores.ripeness,
      financeabilityScore: target.scores.financeability,
      confidenceScore: target.scores.confidence,
      band: target.scores.band,
      qualification: target.scores.qualification,
      status: target.status,
      updatedAt: new Date(),
    } as const;
    const [existing] = await this.database.select({ id: targets.id }).from(targets).where(and(
      eq(targets.organizationId, this.organizationId),
      eq(targets.domain, target.domain),
    )).limit(1);
    const [saved] = existing
      ? await this.database.update(targets).set(values).where(and(eq(targets.id, existing.id), eq(targets.organizationId, this.organizationId))).returning({ id: targets.id })
      : await this.database.insert(targets).values({ organizationId: this.organizationId, ...values }).returning({ id: targets.id });
    await this.appendAudit({
      actorId,
      action: existing ? "target.reenriched" : "target.created",
      entityType: "target",
      entityId: saved.id,
      after: { companyName: target.companyName, domain: target.domain, identifiers, scores: target.scores },
      metadata: {
        providers: [
          ...(target.sourceData?.googlePlaces ? ["Google Places"] : []),
          ...(target.sourceData?.manufacturingDirectory ? ["Australian Manufacturing directories"] : []),
          "Firmable",
        ],
        googleContentPersisted: target.sourceData?.googlePlaces ? ["placeId"] : [],
        personalDataPersisted: false,
      },
    });
    for (const evidence of targetEvidence(target)) {
      const [existingSignal] = await this.database.select({ id: signals.id }).from(signals).where(and(
        eq(signals.organizationId, this.organizationId),
        eq(signals.targetId, saved.id),
        eq(signals.kind, evidence.kind),
      )).limit(1);
      if (existingSignal) await this.database.update(signals).set(evidence).where(and(eq(signals.id, existingSignal.id), eq(signals.organizationId, this.organizationId)));
      else await this.database.insert(signals).values({ organizationId: this.organizationId, targetId: saved.id, ...evidence });
    }
    return saved;
  }

  targetSignals(targetId: string) {
    return this.database.select().from(signals).where(and(eq(signals.organizationId, this.organizationId), eq(signals.targetId, targetId)));
  }

  appendAudit(event: { actorId: string; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; metadata?: Record<string, unknown> }) {
    return this.database.insert(auditEvents).values({ organizationId: this.organizationId, ...event });
  }

  listAudit(limit = 100) {
    return this.database.select().from(auditEvents).where(eq(auditEvents.organizationId, this.organizationId)).orderBy(desc(auditEvents.createdAt)).limit(Math.min(limit, 500));
  }
}
