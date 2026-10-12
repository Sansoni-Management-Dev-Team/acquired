import { describe, expect, it } from "vitest";
import {
  assertOperationMatches,
  assertReceiptMatches,
  assertActionReceiptMatches,
  assertSubmissionReceiptMatches,
  assertSameBinding,
  coverageReady,
  resolveRecordedConnection,
  type ConnectionBinding,
  type ConnectionRecord,
  type Coverage,
  type OperationSnapshot,
  type MessageReceipt,
} from "./index";

const binding: ConnectionBinding = {
  applicationId: "client", tenantId: "tenant", ownerId: "owner",
  connectionId: "original", accountId: "physical-account", generation: 1,
  channel: "email", platform: "gmail", backend: "direct",
};
const scope = { applicationId: "client", tenantId: "tenant", ownerId: "owner" };
const record: ConnectionRecord = {
  binding,
  status: "connected",
  capabilities: {
    messaging: { send: true, durableIdempotency: false, receiptLookup: true },
    events: { read: true, history: true, realtime: false },
  },
};
const replacement: ConnectionRecord = {
  ...record, binding: { ...binding, connectionId: "new-default", backend: "unipile" },
};
const snapshot: OperationSnapshot = { key: "operation-1", binding, operation: "message", payloadDigest: "sha256:synthetic-original" };
const now = Date.parse("2026-10-12T01:00:00Z");
const query = { binding, scope: "all-personal-inbound", since: "2026-10-01T00:00:00Z" };
const coverage: Coverage = {
  binding, scope: query.scope, from: query.since,
  through: new Date(now).toISOString(), observedAt: new Date(now).toISOString(),
  complete: true, initialSyncComplete: true, invalidated: false,
};

describe("recorded connection ownership (A05, A07, A13, A15)", () => {
  it("resolves the recorded connection even when a different backend appears first", () => {
    expect(resolveRecordedConnection(scope, binding, [replacement, record])).toBe(record);
  });
  it("fails rather than falling back when the original connection is missing", () => {
    expect(() => resolveRecordedConnection(scope, binding, [replacement])).toThrowError("connection_unavailable");
  });
  it("keeps disconnected originals available for read-only recovery; readiness remains separate", () => {
    const disconnected = { ...record, status: "disconnected" as const };
    expect(resolveRecordedConnection(scope, binding, [replacement, disconnected])).toBe(disconnected);
  });
  it.each(["applicationId", "tenantId", "ownerId"] as const)("rejects a different %s", field => {
    expect(() => resolveRecordedConnection({ ...scope, [field]: "other" }, binding, [record])).toThrowError("forbidden");
  });
  it.each(["accountId", "generation", "backend", "platform"] as const)("rejects changed %s under the same connection ID", field => {
    const changes = { accountId: "different", generation: 2, backend: "unipile", platform: "outlook" };
    const changed = { ...record, binding: { ...binding, [field]: changes[field] } } as ConnectionRecord;
    expect(() => resolveRecordedConnection(scope, binding, [changed])).toThrowError("binding_changed");
  });
  it("rejects ambiguous records rather than selecting the first one", () => {
    expect(() => resolveRecordedConnection(scope, binding, [record, { ...record }])).toThrowError("connection_unavailable");
  });
  it.each([0, -1, NaN, Infinity, 1.5])("rejects invalid generation %s", generation => {
    expect(() => assertSameBinding({ ...binding, generation }, { ...binding, generation })).toThrowError("invalid_binding");
  });
  it("rejects an empty scope even when both sides match", () => {
    expect(() => assertSameBinding({ ...binding, ownerId: "" }, { ...binding, ownerId: "" })).toThrowError("invalid_binding");
  });
  it.each([
    { channel: "linkedin" as const, platform: "linkedin" as const, backend: "direct" as const },
    { channel: "email" as const, platform: "gmail" as const, backend: "baileys" as const },
    { channel: "whatsapp" as const, platform: "whatsapp" as const, backend: "browser" as const },
    { channel: "email" as const, platform: "whatsapp" as const, backend: "unipile" as const },
  ])("rejects an incompatible channel/platform/backend %j", change => {
    const incompatible = { ...binding, ...change };
    expect(() => assertSameBinding(incompatible, incompatible)).toThrowError("invalid_binding");
  });
  it.each([
    { channel: "email" as const, platform: "outlook" as const, backend: "unipile" as const },
    { channel: "email" as const, platform: "imap" as const, backend: "unipile" as const },
    { channel: "whatsapp" as const, platform: "whatsapp" as const, backend: "baileys" as const },
    { channel: "linkedin" as const, platform: "linkedin" as const, backend: "browser" as const },
  ])("allows compatible bindings without claiming their readiness %j", change => {
    const compatible = { ...binding, ...change };
    expect(() => assertSameBinding(compatible, compatible)).not.toThrow();
  });
});

describe("receipt provenance (A08)", () => {
  const recipient = { kind: "email" as const, value: "person@example.invalid" };
  const receipt: MessageReceipt = { message: { binding, id: "provider-message" }, recipient };
  it("accepts a matching receipt without inventing provider timestamps", () => {
    expect(() => assertReceiptMatches(snapshot, recipient, receipt)).not.toThrow();
    expect(receipt.submittedAt).toBeUndefined();
  });
  it.each([
    { message: { binding: { ...binding, backend: "unipile" as const }, id: "provider-message" } },
    { message: { binding: { ...binding, generation: 2 }, id: "provider-message" } },
    { message: { binding, id: "" } },
    { recipient: { ...recipient, value: "someone-else@example.invalid" } },
    { conversation: { binding: { ...binding, accountId: "other-account" }, id: "conversation" } },
  ])("rejects a receipt from a different account, recipient or thread %j", change => {
    expect(() => assertReceiptMatches(snapshot, recipient, { ...receipt, ...change })).toThrowError("receipt_mismatch");
  });
});

describe("submitted action provenance (A08)", () => {
  const recipient = { kind: "linkedin_profile" as const, value: "https://www.linkedin.com/in/synthetic-person" };
  const linkedBinding: ConnectionBinding = { ...binding, channel: "linkedin", platform: "linkedin", backend: "browser" };
  const actionSnapshot = { ...snapshot, binding: linkedBinding, operation: "invitation" as const };
  const receipt = { operation: { binding: linkedBinding, id: "journal-action-hash" }, recipient };
  it("validates a submitted action without claiming a provider message identity", () => {
    expect(() => assertActionReceiptMatches(actionSnapshot, recipient, receipt)).not.toThrow();
    expect(receipt).not.toHaveProperty("message");
  });
  it.each([
    { operation: { binding: { ...linkedBinding, generation: 2 }, id: "journal-action-hash" } },
    { operation: { binding: linkedBinding, id: "" } },
    { recipient: { ...recipient, value: "https://www.linkedin.com/in/different-person" } },
  ])("rejects wrong action binding/identity/reference %j", change => {
    expect(() => assertActionReceiptMatches(actionSnapshot, recipient, { ...receipt, ...change })).toThrowError("receipt_mismatch");
  });
  it("accepts an explicitly identified submitted action through the union boundary", () => {
    expect(() => assertSubmissionReceiptMatches(actionSnapshot, recipient, receipt)).not.toThrow();
  });
  it("rejects ambiguous action/message receipt shapes", () => {
    expect(() => assertSubmissionReceiptMatches(actionSnapshot, recipient, { ...receipt, message: { binding: linkedBinding, id: "unverified-provider-id" } })).toThrowError("receipt_mismatch");
  });
  it("cannot reinterpret an action journal result as message delivery/read evidence", () => {
    const misleading = { ...receipt, deliveredAt: "2026-10-12T00:00:00Z" };
    expect(() => assertActionReceiptMatches(actionSnapshot, recipient, misleading)).toThrowError("receipt_mismatch");
  });
});

describe("immutable operation snapshots (A06, A07)", () => {
  it("permits lookup/replay of the exact recorded operation", () => {
    expect(() => assertOperationMatches(snapshot, { ...snapshot, binding: { ...binding } })).not.toThrow();
  });
  it.each([
    { key: "other" }, { payloadDigest: "sha256:changed-content" }, { operation: "invitation" as const },
    { binding: { ...binding, accountId: "other-account" } },
    { binding: { ...binding, backend: "unipile" as const } },
    { binding: { ...binding, generation: 2 } },
  ])("rejects a changed operation snapshot %j", change => {
    expect(() => assertOperationMatches(snapshot, { ...snapshot, ...change })).toThrowError("operation_conflict");
  });
  it("does not accept blank digests as evidence that content matches", () => {
    expect(() => assertOperationMatches({ ...snapshot, payloadDigest: "" }, { ...snapshot, payloadDigest: "" })).toThrowError("operation_conflict");
  });
});

describe("truthful coverage admission (A12, A13)", () => {
  it("accepts exact complete coverage through the present", () => {
    expect(coverageReady(query, coverage, now)).toBe(true);
  });
  it("preserves the inclusive five-minute policy", () => {
    expect(coverageReady(query, { ...coverage, through: new Date(now - 300_000).toISOString() }, now)).toBe(true);
    expect(coverageReady(query, { ...coverage, through: new Date(now - 300_001).toISOString() }, now)).toBe(false);
  });
  it.each([
    { complete: false }, { initialSyncComplete: false }, { invalidated: true },
    { scope: "different-query" }, { from: "2026-10-02T00:00:00Z" },
    { through: "invalid" }, { observedAt: "invalid" },
    { through: new Date(now + 1).toISOString() },
    { observedAt: new Date(now + 1).toISOString() },
    { observedAt: new Date(now - 1).toISOString() },
    { binding: { ...binding, generation: 2 } },
    { binding: { ...binding, accountId: "different-account" } },
  ])("blocks incomplete, stale, inconsistent or mismatched evidence %j", change => {
    expect(coverageReady(query, { ...coverage, ...change }, now)).toBe(false);
  });
  it("does not certify cached history merely because the request was observed now", () => {
    expect(coverageReady(query, { ...coverage, through: new Date(now - 3_600_000).toISOString() }, now)).toBe(false);
  });
  it("blocks invalid admission timestamps and freshness bounds", () => {
    expect(coverageReady(query, coverage, NaN)).toBe(false);
    expect(coverageReady(query, coverage, now, Infinity)).toBe(false);
    expect(coverageReady({ ...query, since: "invalid" }, coverage, now)).toBe(false);
  });
});
