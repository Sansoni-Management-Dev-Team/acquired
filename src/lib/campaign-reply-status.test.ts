import { expect, it } from "vitest";
import { ReplyCheckPending, replyCheckFailure, replyCheckDiagnostic } from "./campaign-reply-status";

it("retries network and per-reader timeouts without treating malformed contracts as transient", () => {
  for (const error of [new DOMException("private", "TimeoutError"), new TypeError("fetch failed")]) {
    expect(replyCheckFailure(error, "linkedin")).toBeInstanceOf(ReplyCheckPending);
  }
  expect(replyCheckFailure(new Error("Reply monitor account changed"), "linkedin")).not.toBeInstanceOf(ReplyCheckPending);
});

it("keeps retry times and diagnostics while excluding exception payloads", () => {
  const retryAt = new Date(Date.now() + 120_000);
  const pending = new ReplyCheckPending("rate_limited", "linkedin", retryAt, new Date(Date.now() - 400_000));
  expect(replyCheckFailure(pending)).toBe(pending);
  expect(replyCheckDiagnostic(pending)).toMatchObject({ category: "retry", code: "rate_limited", channel: "linkedin", retryAt: retryAt.toISOString(), coverageAgeMs: expect.any(Number) });
  expect(JSON.stringify(replyCheckDiagnostic(new Error("Bearer private-secret")))).not.toContain("private-secret");
});
