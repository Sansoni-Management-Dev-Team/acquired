import type { MembershipView } from "./acquisition";

export function pipelineColumn(stage: string) {
  return ["identified", "reviewing"].includes(stage) ? "found" : stage;
}

export function shortlistRequest(member: MembershipView) {
  if (pipelineColumn(member.assessment.stage) !== "found") return null;
  return {
    action: "assessment" as const,
    targetId: member.target.id,
    version: member.version,
    assessment: { ...member.assessment, stage: "shortlisted" as const },
  };
}
