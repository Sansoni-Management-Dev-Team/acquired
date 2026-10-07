import type { DerivedValue, Signal, TargetCandidate } from "@/domain/models";

// Test-only scoring scenarios. Runtime target discovery is provided by the
// explicit fixture/live provider boundary in src/adapters/provider-mode.ts.

const capturedAt = "2026-08-26T00:00:00.000Z";
const orgId = "org-demo";

function known<T>(value: T, source: string, confidence: number, sourceUrl?: string): DerivedValue<T> {
  return { value, provenance: { source, sourceUrl, capturedAt, confidence } };
}

function missing<T>(reason: string, source: string): DerivedValue<T> {
  return { value: null, missingReason: reason, provenance: { source, capturedAt, confidence: 100 } };
}

function signal(id: string, value: string, weight: Signal["weight"], source: string, confidence: number): Signal {
  return { id, kind: id.split("-")[1], value, weight, direction: "positive", provenance: { source, capturedAt, confidence } };
}

export const defaultMandate = {
  sectors: ["Mechanical services", "Industrial maintenance"],
  states: ["VIC", "NSW", "QLD"],
  revenue: { min: 10_000_000, max: 50_000_000 },
  ebitda: { min: 1_000_000, max: 5_000_000 },
  headcount: { min: 20, max: 180 },
};

export const seedTargets: TargetCandidate[] = [
  {
    id: "tgt-001", organisationId: orgId, companyName: "Northstar Mechanical", domain: "northstar-mechanical.example", suburb: "Dandenong South", state: "VIC",
    sector: known("Mechanical services", "Industry register", 95), revenue: known(24_800_000, "Synthetic Firmable record", 84), ebitda: known(2_850_000, "Management estimate", 72), headcount: known(74, "Synthetic Firmable record", 88), establishedYear: known(1989, "Company website", 90), status: "enriched",
    financeability: { dscrAtStress: known(1.42, "Synthetic lender model", 74), customerConcentrationPct: known(18, "Synthetic customer ledger", 78), recurringRevenuePct: known(52, "Synthetic service-book analysis", 82), goodwillType: known("business" as const, "Management-team evidence", 80), gmInPlace: known(true, "Company team page", 88), addBacksPctOfCashFlow: known(12, "Synthetic EBITDA bridge", 72) },
    signals: [signal("sig-tenure", "Founder tenure of 31 years", "high", "Synthetic ASIC extract", 92), signal("sig-gm", "General manager in place since 2022", "high", "Company team page", 88), signal("sig-sole", "Sole director structure", "high", "Synthetic ASIC extract", 94), signal("sig-age", "Owner age band 60+", "medium", "Inferred from public career history", 62)],
  },
  {
    id: "tgt-002", organisationId: orgId, companyName: "Harbour Plant Services", domain: "harbour-plant.example", suburb: "Newcastle", state: "NSW",
    sector: known("Industrial maintenance", "Industry register", 96), revenue: known(17_200_000, "Synthetic Firmable record", 82), ebitda: known(1_430_000, "Management estimate", 65), headcount: known(48, "Synthetic Firmable record", 86), establishedYear: known(1998, "Company website", 88), status: "enriched",
    financeability: { dscrAtStress: known(1.19, "Synthetic lender model", 65), customerConcentrationPct: known(27, "Synthetic customer ledger", 68), recurringRevenuePct: known(44, "Synthetic contract analysis", 75), goodwillType: known("mixed" as const, "Owner-dependency review", 67), gmInPlace: known(true, "Company team page", 77), addBacksPctOfCashFlow: known(18, "Synthetic EBITDA bridge", 62) },
    signals: [signal("sig-tenure", "Owner tenure of 24 years", "high", "Synthetic ASIC extract", 90), signal("sig-gm", "Operations manager runs day-to-day delivery", "high", "Company team page", 77), signal("sig-name", "Eponymous trading name changed in 2021", "low", "Synthetic ASIC extract", 83)],
  },
  {
    id: "tgt-003", organisationId: orgId, companyName: "Redgum Climate Systems", domain: "redgum-climate.example", suburb: "Geelong", state: "VIC",
    sector: known("Mechanical services", "Industry register", 94), revenue: missing("UNKNOWN from register", "Industry register"), ebitda: missing("UNKNOWN from register", "Industry register"), headcount: known(31, "Company website", 68), establishedYear: known(2004, "Company website", 91), status: "identified",
    signals: [signal("sig-tenure", "Director tenure of 21 years", "high", "Synthetic ASIC extract", 91), signal("sig-regional", "Single-state regional operator", "low", "Industry register", 95)],
  },
  {
    id: "tgt-004", organisationId: orgId, companyName: "Eastline Facility Engineering", domain: "eastline-facility.example", suburb: "Brisbane", state: "QLD",
    sector: known("Mechanical services", "Industry register", 95), revenue: known(41_000_000, "Synthetic Firmable record", 76), ebitda: known(4_300_000, "Management estimate", 60), headcount: known(167, "Synthetic Firmable record", 82), establishedYear: known(2015, "Company website", 90), status: "enriched",
    financeability: { dscrAtStress: known(1.51, "Synthetic lender model", 61), customerConcentrationPct: known(14, "Synthetic customer ledger", 64), recurringRevenuePct: known(61, "Synthetic service-book analysis", 70), goodwillType: known("business" as const, "Management-team evidence", 72), gmInPlace: known(true, "Company team page", 78), addBacksPctOfCashFlow: known(9, "Synthetic EBITDA bridge", 59) },
    signals: [signal("sig-capital", "Capital investment program recently completed", "low", "Company news archive", 65)],
  },
  {
    id: "tgt-005", organisationId: orgId, companyName: "Westhaven Air Projects", domain: "westhaven-air.example", suburb: "Perth", state: "WA",
    sector: known("Mechanical services", "Industry register", 95), revenue: known(19_600_000, "Synthetic Firmable record", 80), ebitda: known(1_900_000, "Management estimate", 64), headcount: known(56, "Synthetic Firmable record", 85), establishedYear: missing("not shown in register", "Industry register"), status: "enriched",
    financeability: { dscrAtStress: known(1.08, "Synthetic lender model", 58), customerConcentrationPct: known(34, "Synthetic customer ledger", 61), goodwillType: known("personal" as const, "Owner-dependency review", 65), gmInPlace: known(false, "Company team page", 76), addBacksPctOfCashFlow: known(26, "Synthetic EBITDA bridge", 55) },
    signals: [signal("sig-tenure", "Founder tenure of 26 years", "high", "Synthetic ASIC extract", 90), signal("sig-sole", "Sole director structure", "high", "Synthetic ASIC extract", 92)],
  },
  {
    id: "tgt-006", organisationId: orgId, companyName: "Summit Technical Group", domain: "summit-technical.example", suburb: "Sydney", state: "NSW",
    sector: known("Mechanical services", "Industry register", 95), revenue: known(72_000_000, "Synthetic Firmable record", 79), ebitda: known(7_600_000, "Management estimate", 61), headcount: known(220, "Synthetic Firmable record", 84), establishedYear: known(1992, "Company website", 88), status: "enriched",
    financeability: { dscrAtStress: known(1.62, "Synthetic lender model", 68), customerConcentrationPct: known(12, "Synthetic customer ledger", 71), recurringRevenuePct: known(48, "Synthetic contract analysis", 74), goodwillType: known("business" as const, "Management-team evidence", 82), gmInPlace: known(true, "Company team page", 86), addBacksPctOfCashFlow: known(7, "Synthetic EBITDA bridge", 64) },
    signals: [signal("sig-tenure", "Founder tenure of 29 years", "high", "Synthetic ASIC extract", 91), signal("sig-gm", "Experienced CEO appointed", "high", "Company team page", 86)],
  },
];

// Monetary fixture values explicitly represent Australian dollars.
for(const target of seedTargets){target.revenue.provenance.currency='AUD';target.ebitda.provenance.currency='AUD';}
