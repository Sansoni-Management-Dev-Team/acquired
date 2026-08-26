import { beforeEach, describe, expect, it } from "vitest";
import { enrolmentFromReplyAddress, replyAddress } from "./replies";

describe("reply routing", () => {
  beforeEach(() => { process.env.INBOUND_REPLY_SECRET = "reply-secret"; });
  it("round trips a signed enrolment address", () => {
    const address = replyAddress("enrol-123", "reply.example.com");
    expect(enrolmentFromReplyAddress(address)).toBe("enrol-123");
    expect(() => enrolmentFromReplyAddress(address.replace("enrol-123", "enrol-999"))).toThrow();
  });
});
