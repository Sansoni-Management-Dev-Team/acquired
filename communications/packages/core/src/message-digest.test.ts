import { expect, it } from "vitest";
import type { ConnectionBinding, OutboundMessage } from "../../contracts/src/index";
import { messageDigest } from "./message-digest";

const binding: ConnectionBinding = { applicationId: "app", tenantId: "tenant", ownerId: "owner", connectionId: "connection", accountId: "account", generation: 1, channel: "email", platform: "gmail", backend: "direct" };
const message: OutboundMessage = { recipient: { kind: "email", value: "recipient@example.invalid" }, subject: "Hello", text: "Body" };

it("produces a stable opaque fingerprint independent of object field insertion order", () => {
  const other: OutboundMessage = { text: "Body", subject: "Hello", recipient: { value: "recipient@example.invalid", kind: "email" } };
  expect(messageDigest("message", message)).toMatch(/^[a-f0-9]{64}$/);
  expect(messageDigest("message", other)).toBe(messageDigest("message", message));
});
it.each([
  { ...message, text: "Changed" },
  { ...message, subject: "Changed" },
  { ...message, recipient: { kind: "email" as const, value: "another@example.invalid" } },
  { ...message, replyTo: "another@example.invalid" },
  { ...message, rfcMessageId: "<original@example.invalid>" },
  { ...message, conversation: { binding, id: "thread" } },
])("covers every delivery-relevant field", (changed) => {
  expect(messageDigest("message", changed)).not.toBe(messageDigest("message", message));
});
it("includes operation and the exact account-bound conversation reference", () => {
  expect(messageDigest("invitation", message)).not.toBe(messageDigest("message", message));
  const original = { ...message, conversation: { binding, id: "thread" } };
  const changed = { ...message, conversation: { binding: { ...binding, generation: 2 }, id: "thread" } };
  expect(messageDigest("message", changed)).not.toBe(messageDigest("message", original));
});
