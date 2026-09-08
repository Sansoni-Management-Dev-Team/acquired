import type { MembershipView } from "./acquisition";
import type { Signal } from "./models";
// Only explicitly reviewed public capability evidence can become an outreach hook.
// Private financial criteria, owner circumstances and contact research never do.
export function reviewedOutreachSignals(member?: MembershipView): Signal[] {
  return (member?.assessment.evidence || []).filter(e => e.criterionKey === "subsectors" && e.assessment === "supported" && ["website", "register"].includes(e.kind) && /^https?:\/\//.test(e.sourceUrl) && e.value.trim()).map(e => ({ id: `reviewed-subsector-${member!.target.id}`, kind: "reviewed-capability", value: e.value, weight: "medium", direction: "positive", provenance: { source: e.source, sourceUrl: e.sourceUrl, capturedAt: e.capturedAt, confidence: e.confidence } }));
}
