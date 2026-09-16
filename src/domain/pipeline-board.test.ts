import { expect, it } from "vitest";
import { pipelineColumn, shortlistRequest } from "./pipeline-board";
import { initialAssessment, type MembershipView } from "./acquisition";

it("puts identified and reviewing businesses in Found without including archived or advanced deals", () => {
  expect(pipelineColumn("identified")).toBe("found");
  expect(pipelineColumn("reviewing")).toBe("found");
  for (const stage of ["shortlisted", "parked", "excluded", "qualified"]) expect(pipelineColumn(stage)).toBe(stage);
});
it("preserves assessment notes and version when shortlisting", () => {
  const member = { target: { id: "company-1" }, version: 7, assessment: { ...initialAssessment, reason: "Fits mandate", nextAction: "Call owner" } } as MembershipView;
  expect(shortlistRequest(member)).toEqual({ action: "assessment", targetId: "company-1", version: 7, assessment: { ...member.assessment, stage: "shortlisted" } });
  expect(member.assessment.stage).toBe("identified");
});
it("does not downgrade advanced deals or restore parked and excluded businesses", () => {
  for (const stage of ["shortlisted", "qualified", "parked", "excluded"] as const) {
    expect(shortlistRequest({ target: { id: "company-1" }, version: 1, assessment: { ...initialAssessment, stage } } as MembershipView)).toBeNull();
  }
});
