import { beforeEach, expect, it, vi } from "vitest";
import type { ConnectionBinding, ConnectionRecord, MessageSubmission } from "../../contracts/src/index";
import { messageDigest } from "../../core/src/message-digest";
import { createLegacyMessagingAdapter, type LegacyDeliveryPort } from "./index";

const binding: ConnectionBinding = { applicationId: "app", tenantId: "tenant", ownerId: "owner", connectionId: "connection", accountId: "account", generation: 1, channel: "whatsapp", platform: "whatsapp", backend: "baileys" };
const record: ConnectionRecord = { binding, status: "connected", capabilities: { messaging: { send: true, durableIdempotency: true, receiptLookup: true }, events: { read: true, history: true, realtime: false } } };
let port: LegacyDeliveryPort;
beforeEach(() => {
  port = { ready: vi.fn().mockResolvedValue({ status: "ready" }), submit: vi.fn().mockResolvedValue({ status: "submitted", id: "message", sentAt: "2026-10-12T00:00:00.000Z" }), lookup: vi.fn().mockResolvedValue(null) };
});
function input(overrides: Partial<MessageSubmission> = {}): MessageSubmission {
  const message = { recipient: { kind: "phone" as const, value: "+61400000002" }, text: "Synthetic hello" };
  return { snapshot: { binding, key: "campaign:synthetic:step", operation: "message", payloadDigest: messageDigest("message", message) }, message, ...overrides };
}

it("wraps the existing WhatsApp port with canonical identities and original receipt provenance", async () => {
  const result = await createLegacyMessagingAdapter(record, port).submit(input());
  expect(port.submit).toHaveBeenCalledExactlyOnceWith({ key: "campaign:synthetic:step", recipient: "61400000002@s.whatsapp.net", text: "Synthetic hello", operation: "message" });
  expect(result).toEqual({ status: "submitted", receipt: { message: { binding, id: "message" }, recipient: input().message.recipient, submittedAt: "2026-10-12T00:00:00.000Z" } });
});
it.each(["ownerId", "connectionId", "accountId", "backend", "generation"] as const)("rejects changed %s before touching the port", async (field) => {
  const value = input();
  const changed = { ...value.snapshot.binding, [field]: field === "generation" ? 2 : "changed" } as ConnectionBinding;
  await expect(createLegacyMessagingAdapter(record, port).submit({ ...value, snapshot: { ...value.snapshot, binding: changed } })).rejects.toThrow();
  expect(port.ready).not.toHaveBeenCalled();
  expect(port.submit).not.toHaveBeenCalled();
});
it("rejects changed content under an old snapshot before dispatch", async () => {
  const value = input();
  await expect(createLegacyMessagingAdapter(record, port).submit({ ...value, message: { ...value.message, text: "Changed" } })).rejects.toThrow("operation_conflict");
  expect(port.submit).not.toHaveBeenCalled();
});
it("holds a send when its original connection is disconnected", async () => {
  expect(await createLegacyMessagingAdapter({ ...record, status: "disconnected" }, port).submit(input())).toEqual({ status: "review", code: "reconnect" });
  expect(port.submit).not.toHaveBeenCalled();
});
it("preserves a known quota wait and performs no dispatch", async () => {
  vi.mocked(port.ready).mockResolvedValue({ status: "waiting", code: "rate_limited", retryAt: "2026-10-12T01:00:00.000Z" });
  expect(await createLegacyMessagingAdapter(record, port).submit(input())).toEqual({ status: "waiting", code: "rate_limited", retryAt: "2026-10-12T01:00:00.000Z" });
  expect(port.submit).not.toHaveBeenCalled();
});
it("never retries an ambiguous submit", async () => {
  vi.mocked(port.submit).mockRejectedValue(new DOMException("lost response", "TimeoutError"));
  expect(await createLegacyMessagingAdapter(record, port).submit(input())).toEqual({ status: "unknown" });
  expect(port.submit).toHaveBeenCalledTimes(1);
});
it("an incomplete accepted receipt remains unknown", async () => {
  vi.mocked(port.submit).mockResolvedValue({ status: "submitted", id: "" });
  expect(await createLegacyMessagingAdapter(record, port).submit(input())).toEqual({ status: "unknown" });
});
it("receipt recovery uses only the original key and never starts a connection or submits", async () => {
  vi.mocked(port.lookup).mockResolvedValue({ status: "submitted", id: "message", sentAt: "2026-10-12T01:00:00.000Z" });
  const value = input();
  const result = await createLegacyMessagingAdapter({ ...record, status: "disconnected" }, port).lookup({ snapshot: value.snapshot, expectedRecipient: value.message.recipient });
  expect(port.lookup).toHaveBeenCalledExactlyOnceWith({ key: value.snapshot.key });
  expect(port.ready).not.toHaveBeenCalled();
  expect(port.submit).not.toHaveBeenCalled();
  expect(result).toEqual({ status: "submitted", receipt: { message: { binding, id: "message" }, recipient: value.message.recipient } });
});
it("cannot invent the recipient of a recovered receipt", async () => {
  vi.mocked(port.lookup).mockResolvedValue({ status: "submitted", id: "message" });
  expect(await createLegacyMessagingAdapter(record, port).lookup({ snapshot: input().snapshot })).toEqual({ status: "review", code: "protocol" });
});
it("does not silently drop unsupported conversation/reply headers", async () => {
  const message = { ...input().message, conversation: { binding, id: "thread" } };
  const value = input({ message, snapshot: { ...input().snapshot, payloadDigest: messageDigest("message", message) } });
  expect(await createLegacyMessagingAdapter(record, port).submit(value)).toEqual({ status: "review", code: "unsupported" });
  expect(port.submit).not.toHaveBeenCalled();
});
it("maps empty-note LinkedIn invitations without pretending they are messages", async () => {
  const linked: ConnectionBinding = { ...binding, channel: "linkedin", platform: "linkedin", backend: "browser" };
  const connection: ConnectionRecord = { ...record, binding: linked, capabilities: { ...record.capabilities, linkedin: { resolveProfile: true, relationships: true, invitations: true } } };
  const message = { recipient: { kind: "linkedin_profile" as const, value: "https://www.linkedin.com/in/fictional-test" }, text: "" };
  const value: MessageSubmission = { snapshot: { binding: linked, key: "invitation", operation: "invitation", payloadDigest: messageDigest("invitation", message) }, message };
  vi.mocked(port.submit).mockResolvedValue({ status: "skipped", id: "action" });
  expect(await createLegacyMessagingAdapter(connection, port).submit(value)).toEqual({ status: "skipped", operation: { binding: linked, id: "action" }, reason: "legacy_operation_skipped" });
  expect(port.submit).toHaveBeenCalledExactlyOnceWith({ key: "invitation", recipient: message.recipient.value, text: "", operation: "connect" });
});
it("returned receipt metadata cannot mutate the adapter's recorded binding", async () => {
  const adapter = createLegacyMessagingAdapter(record, port);
  const result = await adapter.submit(input());
  if (result.status !== "submitted" || !("message" in result.receipt)) throw Error("Expected a message receipt");
  result.receipt.message.binding.generation = 2;
  expect(await adapter.ready(binding)).toEqual({ status: "ready" });
});
it("caller mutation during readiness cannot change validated dispatch content", async () => {
  const value = input();
  vi.mocked(port.ready).mockImplementation(async () => {
    value.message.text = "Changed after validation";
    value.snapshot.key = "changed-key";
    return { status: "ready" };
  });
  await createLegacyMessagingAdapter(record, port).submit(value);
  expect(port.submit).toHaveBeenCalledWith(expect.objectContaining({ key: "campaign:synthetic:step", text: "Synthetic hello" }));
});
it("represents a LinkedIn journal action as an action receipt, without inventing a provider message", async () => {
  const linked = { ...binding, channel: "linkedin" as const, platform: "linkedin" as const, backend: "browser" as const };
  const connection = { ...record, binding: linked };
  const message = { recipient: { kind: "linkedin_profile" as const, value: "https://www.linkedin.com/in/fictional-test" }, text: "Hello" };
  const result = await createLegacyMessagingAdapter(connection, port).submit({ snapshot: { binding: linked, key: "dm", operation: "message", payloadDigest: messageDigest("message", message) }, message });
  expect(result).toEqual({ status: "submitted", receipt: { operation: { binding: linked, id: "message" }, recipient: message.recipient, submittedAt: "2026-10-12T00:00:00.000Z" } });
  expect(result).not.toHaveProperty("receipt.message");
});
it.each([{ subject: "Email-only field" }, { rfcMessageId: "<email-only@example.invalid>" }])("does not silently drop email fields on WhatsApp", async extra => {
  const message = { ...input().message, ...extra };
  const value = input({ message, snapshot: { ...input().snapshot, payloadDigest: messageDigest("message", message) } });
  expect(await createLegacyMessagingAdapter(record, port).submit(value)).toEqual({ status: "review", code: "unsupported" });
  expect(port.submit).not.toHaveBeenCalled();
});
