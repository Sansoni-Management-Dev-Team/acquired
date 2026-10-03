import type { Accreditation } from "./acquisition";
export type Confidence = number;
export type ScoreBand = "hot" | "warm" | "cold" | "excluded";
export type OpportunityQualification = "priority" | "develop" | "research" | "excluded";
export type SignalWeight = "low" | "medium" | "high" | "very-high";

export type Provenance = {
  source: string;
  sourceUrl?: string;
  capturedAt: string;
  confidence: Confidence;
};

export type DerivedValue<T> = {
  value: T | null;
  provenance: Provenance;
  missingReason?: string;
  displayValue?: string | null;
  researchState?: 'missing' | 'estimated' | 'conflicting' | 'observed';
  range?: { min: number | null; max: number | null; approximate: boolean; kind: 'point' | 'range' | 'lower_bound' | 'upper_bound' };
};

export type FinancialValue = number | { kind: "range"; min: number; max: number } | { kind: "band"; label: string };

export type Mandate = {
  unknownFields?: string[];
  requirements?: string[];
  sectors: string[];
  states: string[];
  locations?: string[];
  revenue: { min: number; max: number | null };
  ebitda: { min: number; max: number | null };
  headcount?: { min: number; max: number };
};

export type Signal = {
  id: string;
  kind: string;
  value: string;
  weight: SignalWeight;
  direction: "positive" | "negative";
  provenance: Provenance;
};

export type FinanceabilityEvidence = {
  dscrAtStress?: DerivedValue<number>;
  customerConcentrationPct?: DerivedValue<number>;
  recurringRevenuePct?: DerivedValue<number>;
  goodwillType?: DerivedValue<"business" | "mixed" | "personal">;
  gmInPlace?: DerivedValue<boolean>;
  addBacksPctOfCashFlow?: DerivedValue<number>;
};

export type GooglePlacesSourceData = {
  placeId: string;
  name?: string;
  formattedAddress?: string;
  website?: string;
  primaryType?: string;
  types: string[];
};

export type FirmableSourceData = {
  firmableId: string;
  capturedAt?: string;
  rawResponse?: Record<string, unknown>;
  name?: string;
  website?: string;
  domain?: string;
  description?: string;
  tagline?: string;
  companyType?: string;
  companySize?: string;
  revenueBand?: string;
  employeeCount?: number;
  yearFounded?: number;
  industries: string[];
  keywords: string[];
  headquarters?: string;
  states: string[];
  locations: string[];
  abn?: string;
  acn?: string;
  anzsic?: string;
  abnStatus?: string;
  linkedin?: string;
};

export type ManufacturingDirectorySourceData = {
  recordId: string;
  name: string;
  website?: string;
  abn?: string;
  identifierEvidence?: {
    sourceUrl: string;
    confidence: number;
  };
  phone?: string;
  email?: string;
  address?: string;
  state?: string;
  postcode?: string;
  description?: string;
  categories: string[];
  keywords: string[];
  capabilities: string[];
  manufacturingConfidence?: "low" | "medium" | "high";
  manufacturingScore?: number;
  australianConfidence?: "low" | "medium" | "high";
  australianScore?: number;
  sourceRecords: Array<{ source: string; sourceId: string; sourceUrl: string }>;
};

export type TargetSourceData = {
  googlePlaces?: GooglePlacesSourceData;
  manufacturingDirectory?: ManufacturingDirectorySourceData;
  firmable?: FirmableSourceData;
};

export type TargetCandidate = {
  id: string;
  organisationId: string;
  companyName: string;
  domain: string;
  abn?: string;
  accreditations?: Accreditation[];
  suburb: string;
  state: string;
  sector: DerivedValue<string>;
  revenue: DerivedValue<FinancialValue>;
  ebitda: DerivedValue<FinancialValue>;
  headcount: DerivedValue<number>;
  headcountBand?: DerivedValue<import('./firmable-company-pipeline').CompanyBand>;
  establishedYear: DerivedValue<number>;
  financeability?: FinanceabilityEvidence;
  signals: Signal[];
  status: "identified" | "enriched";
  sourceData?: TargetSourceData;
};

export type ScoreReason = {
  axis: "fit" | "ripeness" | "financeability";
  label: string;
  contribution: number;
  source: string;
  sourceUrl?: string;
};

export type RankedTarget = TargetCandidate & {
  scores: {
    fit: number;
    ripeness: number;
    financeability: number | null;
    confidence: number;
    completeness?: { fit: number; ripeness: number; bankability: number };
    axisConfidence?: { fit: number; ripeness: number; bankability: number };
    band: ScoreBand;
    qualification: OpportunityQualification;
    tensions: string[];
    reasons: ScoreReason[];
  };
};
