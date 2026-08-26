import type { DerivedValue, FinancialValue } from "@/domain/models";

export function mapFirmableRevenue(value: unknown, capturedAt = new Date().toISOString()): DerivedValue<FinancialValue> {
  const provenance = { source: "Firmable", capturedAt, confidence: 70 };
  if (typeof value !== "string" || !value.trim()) return { value: null, missingReason: "Not provided by Firmable", provenance };
  return { value: { kind: "band", label: value.trim() }, provenance };
}
