import { describe, expect, it } from "vitest";
import { enrolmentStateAfterApproval } from "./outreach-approval";

describe("outreach approval", () => {
  it("keeps the sequence awaiting approval until every message is approved", () => {
    expect(enrolmentStateAfterApproval(["approved", "draft"])).toBe("awaiting_approval");
    expect(enrolmentStateAfterApproval(Array(7).fill("approved"))).toBe("manual_confirmation");
  });
});
