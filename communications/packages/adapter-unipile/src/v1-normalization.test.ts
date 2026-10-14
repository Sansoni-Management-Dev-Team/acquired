import { describe, expect, it } from "vitest";
import type { ConnectionBinding, MessageSubmission } from "../../contracts/src";
import { normalizeV1AccountReadiness, normalizeV1InvitationSent, normalizeV1MessageLookup, normalizeV1MessageSent } from "./v1-normalization";

const binding: ConnectionBinding = { applicationId: "test-app", tenantId: "test-tenant", ownerId: "test-owner", connectionId: "test-connection", accountId: "service-account", generation: 1, channel: "whatsapp", platform: "whatsapp", backend: "unipile" };
const recipient = { kind: "phone" as const, value: "+61400000000" };
const conversation = { binding, id: "unipile-chat" };
const input: MessageSubmission = { snapshot: { binding, key: "operation-key", operation: "message", payloadDigest: "digest" }, message: { recipient, text: "Synthetic test", conversation } };
const account = { object: "Account", id: "unipile-account", type: "WHATSAPP", connection_params: { im: { phone_number: "synthetic" } }, sources: [{ id: "source-one", status: "OK" }] };
const accountExpected = { binding, providerAccountId: "unipile-account", sourceId: "source-one" };
const message = { object: "Message", id: "unipile-message", account_id: "unipile-account", chat_id: conversation.id, is_sender: 1, is_event: 0, deleted: 0, hidden: 0, timestamp: "2026-10-12T09:30:00.000Z", seen: 1, delivered: 1 };
const lookupExpected = { lookup: { snapshot: input.snapshot, message: { binding, id: message.id }, expectedRecipient: recipient }, providerAccountId: "unipile-account", conversation, recipient };

describe("v1 account product/source readiness", () => {
  it("maps an exact healthy account source without credentials or product metadata", () => {
    expect(normalizeV1AccountReadiness(account, accountExpected)).toEqual({ status: "ready" });
  });
  it.each(["gmail", "outlook", "imap", "linkedin"] as const)("verifies the %s account type and product", platform => {
    const email = platform !== "linkedin";
    const b = { ...binding, channel: email ? "email" as const : "linkedin" as const, platform };
    const types = { gmail: "GOOGLE_OAUTH", outlook: "OUTLOOK", imap: "MAIL", linkedin: "LINKEDIN" };
    expect(normalizeV1AccountReadiness({ ...account, type: types[platform], connection_params: { [email ? "mail" : "im"]: {} } }, { ...accountExpected, binding: b })).toEqual({ status: "ready" });
    expect(normalizeV1AccountReadiness({ ...account, type: types[platform], connection_params: { calendar: {} } }, { ...accountExpected, binding: b })).toEqual({ status: "review", code: "protocol" });
  });
  it.each(["CREDENTIALS", "STOPPED", "ERROR"])("requires reconnect for %s", status => {
    expect(normalizeV1AccountReadiness({ ...account, sources: [{ id: "source-one", status }] }, accountExpected)).toEqual({ status: "review", code: "reconnect" });
  });
  it("waits on connecting, and requires permissions review", () => {
    expect(normalizeV1AccountReadiness({ ...account, sources: [{ id: "source-one", status: "CONNECTING" }] }, accountExpected)).toEqual({ status: "waiting", code: "incomplete" });
    expect(normalizeV1AccountReadiness({ ...account, sources: [{ id: "source-one", status: "PERMISSIONS" }] }, accountExpected)).toEqual({ status: "review", code: "forbidden" });
  });
  it.each([null, {}, { ...account, id: "another" }, { ...account, type: "LINKEDIN" }, { ...account, sources: [] }, { ...account, sources: [{ id: "calendar", status: "OK" }] }, { ...account, sources: [{ id: "source-one", status: "NEW_UNKNOWN" }] }, { ...account, sources: [...account.sources, ...account.sources] }])("fails closed for malformed/mismatched/ambiguous source (%#)", raw => {
    expect(normalizeV1AccountReadiness(raw, accountExpected).status).toBe("review");
  });
  it("rejects non-Unipile bindings and absent configured source identity", () => {
    expect(normalizeV1AccountReadiness(account, { ...accountExpected, sourceId: "" }).status).toBe("review");
    expect(normalizeV1AccountReadiness(account, { ...accountExpected, binding: { ...binding, backend: "baileys" } }).status).toBe("review");
  });
});

describe("v1 message submission normalization", () => {
  it("binds Unipile's message ID and known chat without inventing timestamps", () => {
    expect(normalizeV1MessageSent({ object: "MessageSent", message_id: "new-message", provider_id: "other-namespace" }, input)).toEqual({ status: "submitted", receipt: { message: { binding, id: "new-message" }, conversation, recipient } });
  });
  it.each([null, {}, { object: "MessageSent", message_id: null }, { object: "MessageSent", message_id: "" }, { object: "EmailSent", tracking_id: "tracker", provider_id: "email-id" }, { object: "MessageSent", message_id: " padded " }])("keeps uncertain send responses unknown (%#)", raw => {
    expect(normalizeV1MessageSent(raw, input)).toEqual({ status: "unknown" });
  });
  it("requires the original operation/channel/recipient/chat binding", () => {
    const raw = { object: "MessageSent", message_id: "message" };
    expect(normalizeV1MessageSent(raw, { ...input, snapshot: { ...input.snapshot, operation: "invitation" } })).toEqual({ status: "unknown" });
    expect(normalizeV1MessageSent(raw, { ...input, message: { ...input.message, conversation: undefined } })).toEqual({ status: "unknown" });
    expect(normalizeV1MessageSent(raw, { ...input, message: { ...input.message, recipient: { kind: "email", value: "synthetic@example.test" } } })).toEqual({ status: "unknown" });
    expect(normalizeV1MessageSent(raw, { ...input, message: { ...input.message, conversation: { ...conversation, binding: { ...binding, generation: 2 } } } })).toEqual({ status: "unknown" });
  });
  it("returns detached records so later caller mutation cannot alter provenance", () => {
    const mutable = structuredClone(input);
    const result = normalizeV1MessageSent({ object: "MessageSent", message_id: "message" }, mutable);
    mutable.snapshot.binding.ownerId = "other-owner";
    mutable.message.recipient.value = "other-recipient";
    expect(result).toMatchObject({ receipt: { message: { binding }, recipient } });
  });
});

describe("v1 read-only original-message receipt normalization", () => {
  it("uses exact outbound account/chat/message and caller's verified recipient correlation", () => {
    expect(normalizeV1MessageLookup(message, lookupExpected)).toEqual({ status: "submitted", receipt: { message: lookupExpected.lookup.message, conversation, recipient, submittedAt: message.timestamp } });
  });
  it.each([{ id: "other-message" }, { account_id: "other-account" }, { chat_id: "other-chat" }, { is_sender: 0 }, { is_sender: true }, { is_event: 1 }, { deleted: 1 }, { hidden: 1 }, { timestamp: "not-iso" }, { timestamp: "2026-02-30T09:30:00.000Z" }, { timestamp: "2026-10-12T09:30:00" }, { object: "Email" }, { message_id: "other-message" }])("does not recover mismatched/ambiguous/invalid facts (%#)", patch => {
    expect(normalizeV1MessageLookup({ ...message, ...patch }, lookupExpected)).toEqual({ status: "unknown" });
  });
  it("cannot recover without recorded message ID or verified recipient correspondence", () => {
    expect(normalizeV1MessageLookup(message, { ...lookupExpected, lookup: { ...lookupExpected.lookup, message: undefined } })).toEqual({ status: "unknown" });
    expect(normalizeV1MessageLookup(message, { ...lookupExpected, lookup: { ...lookupExpected.lookup, expectedRecipient: undefined } })).toEqual({ status: "unknown" });
    expect(normalizeV1MessageLookup(message, { ...lookupExpected, recipient: { ...recipient, value: "+61400000001" } })).toEqual({ status: "unknown" });
    expect(normalizeV1MessageLookup(message, { ...lookupExpected, conversation: { ...conversation, binding: { ...binding, generation: 2 } } })).toEqual({ status: "unknown" });
  });
  it("does not synthesize delivery/read times from seen or delivered flags", () => {
    const result = normalizeV1MessageLookup(message, lookupExpected);
    expect(result.status).toBe("submitted");
    expect(result).not.toHaveProperty("receipt.deliveredAt");
    expect(result).not.toHaveProperty("receipt.readAt");
  });
});

describe("v1 LinkedIn invitation action normalization", () => {
  const inviteBinding: ConnectionBinding = { ...binding, channel: "linkedin", platform: "linkedin" };
  const inviteInput: MessageSubmission = { snapshot: { ...input.snapshot, binding: inviteBinding, operation: "invitation" }, message: { text: "Synthetic invitation", recipient: { kind: "linkedin_profile", value: "https://www.linkedin.com/in/synthetic-test" } } };
  it("keeps invitation ID in the action namespace, never a provider message", () => {
    expect(normalizeV1InvitationSent({ object: "UserInvitationSent", invitation_id: "invite-one" }, inviteInput)).toEqual({ status: "submitted", receipt: { operation: { binding: inviteBinding, id: "invite-one" }, recipient: inviteInput.message.recipient } });
  });
  it.each([{}, { object: "MessageSent", message_id: "message" }, { object: "UserInvitationSent", invitation_id: null }, { object: "UserInvitationSent", invitation_id: "" }])("keeps ambiguous actions unknown (%#)", raw => {
    expect(normalizeV1InvitationSent(raw, inviteInput)).toEqual({ status: "unknown" });
  });
  it("rejects a message operation or another channel's action", () => {
    const raw = { object: "UserInvitationSent", invitation_id: "invite-one" };
    expect(normalizeV1InvitationSent(raw, input)).toEqual({ status: "unknown" });
    expect(normalizeV1InvitationSent(raw, { ...inviteInput, snapshot: { ...inviteInput.snapshot, operation: "message" } })).toEqual({ status: "unknown" });
  });
});
