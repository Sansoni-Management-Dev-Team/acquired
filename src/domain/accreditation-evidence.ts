import type { Accreditation } from "./acquisition";
import type { Signal } from "./models";

export function accreditationSignals(records: Accreditation[], today = new Date().toISOString().slice(0, 10)): Signal[] {
  return records.filter(a => a.status === "current" && a.verifiedAt <= today && (!a.expiresAt || a.expiresAt >= today) && a.confidence >= 70).map(a => ({
    id: a.id, kind: "accreditation", value: `${a.issuer} accreditation ${a.identifier || ""} covers ${a.scope}${a.site ? ` at ${a.site}` : ""}`.trim(),
    weight: "medium", direction: "positive", provenance: { source: a.source, sourceUrl: a.sourceUrl, capturedAt: `${a.verifiedAt}T00:00:00.000Z`, confidence: a.confidence },
  }));
}
