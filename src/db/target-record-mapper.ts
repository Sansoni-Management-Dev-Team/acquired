import {normalizeFirmableProfile} from '@/domain/firmable-company-pipeline';
import {applyScopedCompanyFacts} from '@/domain/company-scoped-facts';
import {applyCompanyBackgroundProjection} from '@/domain/company-background-projection';
import type { InferSelectModel } from "drizzle-orm";
import type { DerivedValue, FinancialValue, FirmableSourceData, ManufacturingDirectorySourceData, RankedTarget, ScoreReason, Signal } from "@/domain/models";
import { signals, targets } from "./schema";

type TargetRecord = InferSelectModel<typeof targets>;
type SignalRecord = InferSelectModel<typeof signals>;

type StoredFirmographics = {
  suburb?: unknown;
  state?: unknown;
  sector?: unknown;
  revenue?: unknown;
  ebitda?: unknown;
  headcount?: unknown;
  headcountBand?: unknown;
  establishedYear?: unknown;
  accreditations?: unknown;
  financeability?: unknown;
  firmable?: unknown;
  abnVerification?: unknown;
  manufacturingDirectory?: unknown;
  scoreExplanation?: unknown;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function derived<T>(value: unknown, missingReason: string): DerivedValue<T> {
  const stored = record(value);
  const provenance = record(stored?.provenance);
  if (stored && provenance && typeof provenance.source === "string" && typeof provenance.capturedAt === "string" && typeof provenance.confidence === "number") {
    return value as DerivedValue<T>;
  }
  return {
    value: null,
    missingReason,
    provenance: { source: "Persisted target", capturedAt: new Date(0).toISOString(), confidence: 0 },
  };
}

function storedSignals(rows: SignalRecord[]): Signal[] {
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    value: row.value,
    weight: row.weight === "very_high" ? "very-high" : row.weight,
    direction: row.direction === "negative" ? "negative" : "positive",
    provenance: {
      source: row.source,
      sourceUrl: row.sourceUrl || undefined,
      capturedAt: row.capturedAt.toISOString(),
      confidence: row.confidence,
    },
  }));
}

function scoreExplanation(value: unknown) {
  const explanation = record(value);
  const reasons = Array.isArray(explanation?.reasons) ? explanation.reasons as ScoreReason[] : [];
  const tensions = Array.isArray(explanation?.tensions)
    ? explanation.tensions.filter((item): item is string => typeof item === "string")
    : [];
  return { reasons, tensions };
}

export function targetRecordToRankedTarget(row: TargetRecord, signalRows: SignalRecord[]): RankedTarget {
  const firmographics = (record(row.firmographics) || {}) as StoredFirmographics;
  const identifiers = record(row.identifiers) || {};
  const firmable = record(firmographics.firmable || (firmographics as Record<string,unknown>).websiteProfile) as FirmableSourceData | undefined;
  const storedAbnVerification = record(firmographics.abnVerification) as import("@/domain/models").AbnVerification | undefined;
  const manufacturingDirectory = record(firmographics.manufacturingDirectory) as ManufacturingDirectorySourceData | undefined;
  const explanation = scoreExplanation(firmographics.scoreExplanation);
  const placeId = text(identifiers.googlePlaceId);

  const reportedAbn = firmable?.firmableId
    ? normalizeFirmableProfile(record(firmable.rawResponse)||{}).abn || normalizeFirmableProfile({industry_codes:{abn:firmable.abn}}).abn
    : null;
  const abnVerification = reportedAbn ? {status:'provider_reported',operationalStatus:'complete',missingReason:null,errors:[]} : storedAbnVerification;

  const retained:RankedTarget={
    id: row.id,
    organisationId: row.organizationId,
    companyName: row.companyName,
    domain: row.domain || "",
    abn: reportedAbn || text(identifiers.abn) || undefined,
    accreditations: Array.isArray(firmographics.accreditations) ? firmographics.accreditations as RankedTarget["accreditations"] : [],
    suburb: text(firmographics.suburb, "Unknown"),
    state: text(firmographics.state, "Unknown"),
    sector: derived<string>(firmographics.sector, "Sector was not retained"),
    revenue: derived<FinancialValue>(firmographics.revenue, "Revenue was not retained"),
    ebitda: derived<FinancialValue>(firmographics.ebitda, "EBITDA was not retained"),
    headcount: derived<number>(firmographics.headcount, "Headcount was not retained"),
    headcountBand: firmographics.headcountBand as import("@/domain/models").TargetCandidate["headcountBand"],
    establishedYear: derived<number>(firmographics.establishedYear, "Established year was not retained"),
    financeability: firmographics.financeability as RankedTarget["financeability"],
    signals: storedSignals(signalRows),
    status: row.status === "identified" ? "identified" : "enriched",
    sourceData: placeId || firmable || manufacturingDirectory || abnVerification ? {
      ...(abnVerification ? {abnVerification} : {}),
      ...(placeId ? { googlePlaces: { placeId, types: [] } } : {}),
      ...(manufacturingDirectory ? { manufacturingDirectory } : {}),
      ...(firmable ? { firmable } : {}),
    } : undefined,
    scores: {
      fit: row.fitScore ?? 0,
      ripeness: row.ripenessScore ?? 0,
      financeability: row.financeabilityScore,
      confidence: row.confidenceScore ?? 0,
      band: row.band ?? "cold",
      qualification: row.qualification ?? "research",
      tensions: explanation.tensions.length || row.financeabilityScore !== null
        ? explanation.tensions
        : ["Financeability is unscored until operating and lender evidence is collected."],
      reasons: explanation.reasons,
    },
  };
  const scoped=applyScopedCompanyFacts(retained);
  for(const field of ['headcount','revenue','establishedYear'] as const){
    const value=retained[field];
    if(value.value!==null && value.provenance.basis!=='provider_reported' && value.provenance.basis!=='website' && value.provenance.scope!=='global' && !/firmable|persisted target|company website/i.test(value.provenance.source))Object.assign(scoped,{[field]:value});
  }
  return applyCompanyBackgroundProjection(scoped,(firmographics as Record<string,unknown>).backgroundResearch);
}
