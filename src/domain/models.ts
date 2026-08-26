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
};

export type FinancialValue = number | { kind: "range"; min: number; max: number } | { kind: "band"; label: string };

export type Mandate = {
  sectors: string[];
  states: string[];
  revenue: { min: number; max: number };
  ebitda: { min: number; max: number };
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

export type TargetCandidate = {
  id: string;
  organisationId: string;
  companyName: string;
  domain: string;
  suburb: string;
  state: string;
  sector: DerivedValue<string>;
  revenue: DerivedValue<FinancialValue>;
  ebitda: DerivedValue<FinancialValue>;
  headcount: DerivedValue<number>;
  establishedYear: DerivedValue<number>;
  financeability?: FinanceabilityEvidence;
  signals: Signal[];
  status: "identified" | "enriched";
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
    band: ScoreBand;
    qualification: OpportunityQualification;
    tensions: string[];
    reasons: ScoreReason[];
  };
};
