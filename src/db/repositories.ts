import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { db as databaseType } from "./client";
import { auditEvents, firmableCompanies, mandates, signals, targets } from "./schema";
import { targetRecordToRankedTarget } from "./target-record-mapper";
import type { Mandate, RankedTarget } from "@/domain/models";
import { targetEvidence } from "@/domain/target-evidence";
import { FirmableHistoryRepository } from "./firmable-history-repository";
import { applyStoredFirmableCompany } from "@/adapters/firmable-mapper";
import { normalizeFirmableAbn, normalizeFirmableDomain } from "@/domain/firmable-history";

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
    const explicitIds = targetRows.flatMap(row => row.firmableCompanyId ? [row.firmableCompanyId] : []);
    const domains = targetRows.flatMap(row => normalizeFirmableDomain(row.domain) ? [normalizeFirmableDomain(row.domain)!] : []);
    const abns = targetRows.flatMap(row => normalizeFirmableAbn((row.identifiers as Record<string, unknown>).abn as string | undefined) ? [normalizeFirmableAbn((row.identifiers as Record<string, unknown>).abn as string)!] : []);
    const matchConditions = [explicitIds.length ? inArray(firmableCompanies.id, explicitIds) : undefined, domains.length ? inArray(firmableCompanies.domain, domains) : undefined, abns.length ? inArray(firmableCompanies.abn, abns) : undefined].filter(Boolean);
    const sharedCompanies = matchConditions.length ? await this.database.select().from(firmableCompanies).where(or(...matchConditions as Parameters<typeof or>)) : [];
    const resolved = new Map(targetRows.map(row => {
      const identifiers = row.identifiers as Record<string, unknown>;
      const domain = normalizeFirmableDomain(row.domain);
      const abn = normalizeFirmableAbn(typeof identifiers.abn === "string" ? identifiers.abn : undefined);
      const matches = sharedCompanies.filter(company => company.id === row.firmableCompanyId || (abn && company.abn === abn) || (domain && company.domain === domain));
      return [row.id, matches.length === 1 ? matches[0].id : undefined];
    }));
    const latest = await new FirmableHistoryRepository(this.database).latestCompanyResponses([...new Set([...resolved.values()].filter((id): id is string => Boolean(id)))]);
    return targetRows.map((target) => {
      const ranked = targetRecordToRankedTarget(
      target,
      signalRows.filter((signal) => signal.targetId === target.id),
      );
      const stored = resolved.get(target.id) ? latest.get(resolved.get(target.id)!) : undefined;
      return stored ? applyStoredFirmableCompany(ranked, stored.response, stored.fetchedAt.toISOString()) : ranked;
    });
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

  async upsertEnrichedTarget(input: { target: RankedTarget; mandateId: string; actorId: string; existingTargetId?: string }) {
    const { target, actorId } = input;
    const firmable = target.sourceData?.firmable;
    const directory = target.sourceData?.manufacturingDirectory;
    const placeId = target.sourceData?.googlePlaces?.placeId;
    const cachedFirmable = firmable ? undefined : await new FirmableHistoryRepository(this.database).findCompany({ domain: target.domain, abn: target.abn || directory?.abn });
    if (!firmable && !directory && !cachedFirmable) return null;
    const identifiers = {
      googlePlaceId: target.sourceData?.googlePlaces?.placeId,
      firmableId: firmable?.firmableId || cachedFirmable?.id,
      manufacturingDirectoryRecordId: target.sourceData?.manufacturingDirectory?.recordId,
      abn: (firmable?.abn || directory?.abn)?.replace(/\D/g, ""),
      acn: firmable?.acn,
      anzsic: firmable?.anzsic,
    };
    // Google content remains transient except for Place ID. Persisted profiles come from
    // a sourced register/directory record or the Firmable enrichment response.
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
        description: firmable?.description,
        tagline: firmable?.tagline,
        industries: firmable?.industries,
        keywords: firmable?.keywords,
        headquarters: firmable?.headquarters,
        locations: firmable?.locations,
        yearFounded: firmable?.yearFounded,
      },
      financeability: target.financeability,
      scoreExplanation: {
        tensions: target.scores.tensions,
        reasons: target.scores.reasons,
      },
    };
    const values = {
      companyName: target.companyName,
      domain: target.domain.toLowerCase(),
      firmableCompanyId: firmable?.firmableId || cachedFirmable?.id,
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
    const [existing] = await this.database.select({ id: targets.id, firmographics: targets.firmographics, status: targets.status }).from(targets).where(and(
      eq(targets.organizationId, this.organizationId),
      input.existingTargetId ? eq(targets.id, input.existingTargetId) : or(
        target.domain ? eq(targets.domain, target.domain.toLowerCase()) : undefined,
        identifiers.abn ? sql`${targets.identifiers}->>'abn' = ${identifiers.abn.replace(/\D/g, "")}` : undefined,
        directory ? sql`${targets.identifiers}->>'manufacturingDirectoryRecordId' = ${directory.recordId}` : undefined,
        placeId ? sql`${targets.identifiers}->>'googlePlaceId' = ${placeId}` : undefined,
      ),
    )).limit(1);
    if (input.existingTargetId && !existing) throw new Error("Target not found in organisation");
    const retained = existing?.firmographics as Record<string, unknown> | undefined;
    const priorDirectory = retained?.manufacturingDirectory as typeof directory;
    const mergedDirectory = directory && priorDirectory ? { ...priorDirectory, ...directory, sourceRecords: [...new Map([...priorDirectory.sourceRecords, ...directory.sourceRecords].map(record => [`${record.source}:${record.sourceId}`, record])).values()] } : directory || priorDirectory;
    // Enrichment updates facts, scores and source data. It must never move a
    // company backwards (or forwards) in the user's workflow.
    const storedValues = { ...values, status: existing?.status || values.status, firmographics: { ...retained, ...values.firmographics, manufacturingDirectory: mergedDirectory, ...(retained?.accreditations ? { accreditations: retained.accreditations } : {}) } };
    const [saved] = existing
      ? await this.database.update(targets).set(storedValues).where(and(eq(targets.id, existing.id), eq(targets.organizationId, this.organizationId))).returning({ id: targets.id })
      : await this.database.insert(targets).values({ organizationId: this.organizationId, ...storedValues }).returning({ id: targets.id });
    await this.appendAudit({
      actorId,
      action: existing ? "target.reenriched" : "target.created",
      entityType: "target",
      entityId: saved.id,
      after: { companyName: target.companyName, domain: target.domain, identifiers, scores: target.scores },
      metadata: {
        mandateId: input.mandateId,
        providers: [
          ...(target.sourceData?.googlePlaces ? ["Google Places"] : []),
          ...(target.sourceData?.manufacturingDirectory ? ["Australian Manufacturing directories"] : []),
          ...(firmable ? ["Company data"] : []),
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
