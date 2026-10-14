import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyUnipileWebhook } from "./webhook";

const secret = "synthetic-webhook-secret";
const nowSeconds = 1_800_000_000;
const rawBody = Buffer.from('{"type":"message.new", "payload":{"text":"fixture"}}');
function signature(timestamp = nowSeconds, body = rawBody) {
  const digest = createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
  return `t=${timestamp},v0=${digest}`;
}
function verify(header: string | null, overrides = {}) {
  return verifyUnipileWebhook({ rawBody, signature: header, secret, nowSeconds, ...overrides });
}

describe("pure Unipile v2 webhook verification", () => {
  it("authenticates exact raw bytes without parsing or normalizing JSON", () => {
    expect(verify(signature())).toEqual({ verified: true, timestamp: nowSeconds });
  });
  it("rejects whitespace/body modification and wrong secret", () => {
    expect(verify(signature(), { rawBody: Buffer.from(JSON.stringify(JSON.parse(rawBody.toString()))) }))
      .toEqual({ verified: false, reason: "signature" });
    expect(verify(signature(), { secret: "different-synthetic-secret" }))
      .toEqual({ verified: false, reason: "signature" });
  });
  it("rejects trailing newline even when the signature itself is correct", () => {
    expect(verify(`${signature()}\n`)).toEqual({ verified: false, reason: "header" });
  });
  it("handles arbitrary raw bytes without lossy UTF-8 decoding", () => {
    const bytes = Buffer.from([0xff, 0x00, 0xc3, 0x28]);
    expect(verify(signature(nowSeconds, bytes), { rawBody: bytes })).toMatchObject({ verified: true });
  });
  it("rejects stale and future timestamps even with valid signatures", () => {
    expect(verify(signature(nowSeconds - 301))).toEqual({ verified: false, reason: "timestamp" });
    expect(verify(signature(nowSeconds + 31))).toEqual({ verified: false, reason: "timestamp" });
    expect(verify(signature(nowSeconds - 300))).toMatchObject({ verified: true });
    expect(verify(signature(nowSeconds + 30))).toMatchObject({ verified: true });
  });
  it.each([
    null, "", `t=${nowSeconds},v0=123`, `t=NaN,v0=${"a".repeat(64)}`,
    `t=${nowSeconds},t=${nowSeconds},v0=${"a".repeat(64)}`,
    `t=${nowSeconds},v0=${"a".repeat(64)},v0=${"b".repeat(64)}`,
    `t=${nowSeconds},v1=${"a".repeat(64)}`, `t=${nowSeconds},v0=${"g".repeat(64)}`,
    `t=9007199254740993,v0=${"a".repeat(64)}`,
  ])("rejects malformed/duplicate/versioned header %s", (header) => {
    expect(verify(header)).toEqual({ verified: false, reason: "header" });
  });
  it("does not authenticate without a configured secret or valid bounded clock policy", () => {
    expect(verify(signature(), { secret: "" })).toEqual({ verified: false, reason: "configuration" });
    expect(verify(signature(), { maxAgeSeconds: Infinity })).toEqual({ verified: false, reason: "configuration" });
    expect(verify(signature(), { nowSeconds: NaN })).toEqual({ verified: false, reason: "configuration" });
  });
  it("authenticating twice is possible; persistence owns event replay deduplication", () => {
    expect(verify(signature())).toMatchObject({ verified: true });
    expect(verify(signature())).toMatchObject({ verified: true });
  });
});
