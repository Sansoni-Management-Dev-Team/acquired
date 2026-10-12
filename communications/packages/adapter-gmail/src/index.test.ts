import { describe, expect, it, vi } from "vitest";
import { createGmailAdapter } from "./index";
import { messageDigest, draftDigest } from "../../core/src/message-digest";
import type { ConnectionBinding, MessageSubmission, OperationSnapshot, OutboundMessage, ProviderReference } from "../../contracts/src/index";

const binding: ConnectionBinding = {
  applicationId: "test-client", tenantId: "test-tenant", ownerId: "sender",
  connectionId: "gmail-original", accountId: "physical-mailbox", generation: 1,
  channel: "email", platform: "gmail", backend: "direct",
};
const message: OutboundMessage = {
  recipient: { kind: "email", value: "person@example.invalid" },
  text: "Synthetic body", subject: "Synthetic subject", replyTo: "reply@example.invalid",
  rfcMessageId: "<unique-operation@example.invalid>",
  conversation: { binding, id: "existing-thread" },
};
const draft: ProviderReference = { binding, id: "saved-draft" };
function input(operation: OperationSnapshot["operation"] = "message"): MessageSubmission {
  const copy = structuredClone(message);
  return { snapshot: { key: "operation-1", binding: { ...binding }, operation, payloadDigest: messageDigest(operation, copy) }, message: copy };
}
function fixture() {
  const mailbox = {
    send: vi.fn().mockResolvedValue({ providerMessageId: "sent-message", providerThreadId: "existing-thread", sentAt: new Date("2026-10-12T00:00:00Z") }),
    findByRfcMessageId: vi.fn().mockResolvedValue({ id: "sent-message", threadId: "existing-thread" }),
  };
  const drafts = {
    createDraft: vi.fn().mockResolvedValue({ providerDraftId: "saved-draft", providerMessageId: "draft-message", providerThreadId: "existing-thread" }),
    updateDraft: vi.fn().mockResolvedValue({ providerDraftId: "saved-draft", providerMessageId: "draft-message-2", providerThreadId: "existing-thread" }),
    deleteDraft: vi.fn().mockResolvedValue(undefined),
  };
  const readiness = vi.fn().mockResolvedValue({ status: "ready" });
  return { mailbox, drafts, readiness, adapter: createGmailAdapter({ binding, mailbox, drafts, readiness, messageDigest, draftDigest }) };
}

describe("direct Gmail messaging port (P1.3/A01/A06/A07/A08)", () => {
  it("preserves content, sender, threading and RFC correlation metadata", async () => {
    const f = fixture();
    const result = await f.adapter.submit(input());
    expect(f.mailbox.send).toHaveBeenCalledExactlyOnceWith("sender", {
      to: "person@example.invalid", subject: message.subject, text: message.text,
      replyTo: message.replyTo, threadId: "existing-thread", messageId: message.rfcMessageId,
    });
    expect(result).toMatchObject({ status: "submitted", receipt: {
      message: { binding, id: "sent-message" }, conversation: { binding, id: "existing-thread" },
      recipient: message.recipient, submittedAt: "2026-10-12T00:00:00.000Z",
    } });
    expect(f.adapter.capabilities.messaging.durableIdempotency).toBe(false);
    expect(f.adapter.capabilities.events).toEqual({ read: false, history: false, realtime: false });
  });
  it("keeps ready account status separate from historical coverage", async () => {
    const f = fixture();
    expect(await f.adapter.ready(binding)).toEqual({ status: "ready" });
    expect(f.mailbox.send).not.toHaveBeenCalled();
  });
  it("blocks new sends when the readiness port requires reconnection", async () => {
    const f = fixture();
    f.readiness.mockResolvedValue({ status: "review", code: "reconnect" });
    expect(await f.adapter.submit(input())).toEqual({ status: "review", code: "reconnect" });
    expect(f.mailbox.send).not.toHaveBeenCalled();
  });
  it("retains unknown after ambiguous transport failure and does not retry", async () => {
    const f = fixture();
    f.mailbox.send.mockRejectedValue(new DOMException("synthetic lost response", "TimeoutError"));
    expect(await f.adapter.submit(input())).toEqual({ status: "unknown" });
    expect(f.mailbox.send).toHaveBeenCalledTimes(1);
    expect(f.mailbox.findByRfcMessageId).not.toHaveBeenCalled();
  });
  it("permits injected definite rejection classification without app error imports", async () => {
    const f = fixture();
    const error = new Error("synthetic definite rejection");
    f.mailbox.send.mockRejectedValue(error);
    const classifyFailure = vi.fn().mockReturnValue({ status: "waiting", code: "rate_limited" });
    const adapter = createGmailAdapter({ ...f, binding, messageDigest, draftDigest, classifyFailure });
    expect(await adapter.submit(input())).toEqual({ status: "waiting", code: "rate_limited" });
    expect(classifyFailure).toHaveBeenCalledExactlyOnceWith(error);
  });
  it.each([
    { snapshot: { ...input().snapshot, binding: { ...binding, generation: 2 } } },
    { snapshot: { ...input().snapshot, binding: { ...binding, backend: "unipile" as const } } },
    { snapshot: { ...input().snapshot, operation: "draft_create" as const } },
    { snapshot: { ...input().snapshot, payloadDigest: "changed-content" } },
    { message: { ...message, conversation: { ...message.conversation!, binding: { ...binding, accountId: "other-mailbox" } } } },
  ])("rejects changed ownership, operation, payload or thread before provider I/O %j", async change => {
    const f = fixture();
    await expect(f.adapter.submit({ ...input(), ...change })).rejects.toThrow();
    expect(f.mailbox.send).not.toHaveBeenCalled();
    expect(f.readiness).not.toHaveBeenCalled();
  });
  it("captures message content before awaiting account readiness", async () => {
    const f = fixture();
    const submission = input();
    f.readiness.mockImplementation(async () => { submission.message.text = "changed during wait"; return { status: "ready" }; });
    await f.adapter.submit(submission);
    expect(f.mailbox.send.mock.calls[0][1].text).toBe(message.text);
  });
  it("retains the original injected mailbox when callers change configuration during readiness", async () => {
    const f = fixture();
    const replacement = { ...f.mailbox, send: vi.fn().mockResolvedValue({ providerMessageId: "different-account-message", providerThreadId: "existing-thread" }) };
    const config = { binding, mailbox: f.mailbox, readiness: f.readiness, messageDigest };
    f.readiness.mockImplementation(async () => { config.mailbox = replacement; return { status: "ready" }; });
    const adapter = createGmailAdapter(config);
    await adapter.submit(input());
    expect(f.mailbox.send).toHaveBeenCalledTimes(1);
    expect(replacement.send).not.toHaveBeenCalled();
  });
  it("does not invent a timestamp when the mailbox port supplies none", async () => {
    const f = fixture();
    f.mailbox.send.mockResolvedValue({ providerMessageId: "sent-message", providerThreadId: "existing-thread" });
    const result = await f.adapter.submit(input());
    expect(result.status).toBe("submitted");
    if (result.status === "submitted") expect(result.receipt.submittedAt).toBeUndefined();
  });
  it("keeps a malformed post-send receipt unknown", async () => {
    const f = fixture();
    f.mailbox.send.mockResolvedValue({ providerMessageId: "" });
    expect(await f.adapter.submit(input())).toEqual({ status: "unknown" });
  });
  it("keeps an unexpected post-send thread unknown rather than accepting mismatched threading", async () => {
    const f = fixture();
    f.mailbox.send.mockResolvedValue({ providerMessageId: "sent-message", providerThreadId: "other-thread" });
    expect(await f.adapter.submit(input())).toEqual({ status: "unknown" });
    expect(f.mailbox.send).toHaveBeenCalledTimes(1);
  });
  it("normalizes an email address without changing the payload digest or losing its receipt identity", async () => {
    const f = fixture();
    const submission = input();
    submission.message.recipient.value = " Person@Example.Invalid ";
    submission.snapshot.payloadDigest = messageDigest("message", submission.message);
    const result = await f.adapter.submit(submission);
    expect(f.mailbox.send.mock.calls[0][1].to).toBe("person@example.invalid");
    expect(result.status === "submitted" && result.receipt.recipient.value).toBe("person@example.invalid");
  });
});

describe("read-only receipt recovery (A07/A08/A15)", () => {
  it("looks up the original RFC message without calling send or readiness and without fabricating time", async () => {
    const f = fixture();
    const result = await f.adapter.lookup({ snapshot: input().snapshot, rfcMessageId: message.rfcMessageId, expectedRecipient: message.recipient });
    expect(f.mailbox.findByRfcMessageId).toHaveBeenCalledExactlyOnceWith(message.rfcMessageId);
    expect(result).toEqual({ status: "submitted", receipt: { message: { binding, id: "sent-message" }, conversation: { binding, id: "existing-thread" }, recipient: message.recipient } });
    expect(f.mailbox.send).not.toHaveBeenCalled();
    expect(f.readiness).not.toHaveBeenCalled();
  });
  it("returns null for absent receipts without dispatching", async () => {
    const f = fixture();
    f.mailbox.findByRfcMessageId.mockResolvedValue(null);
    expect(await f.adapter.lookup({ snapshot: input().snapshot, rfcMessageId: message.rfcMessageId, expectedRecipient: message.recipient })).toBeNull();
    expect(f.mailbox.send).not.toHaveBeenCalled();
  });
  it("will not claim a recipient when recovery metadata is incomplete", async () => {
    const f = fixture();
    expect(await f.adapter.lookup({ snapshot: input().snapshot, rfcMessageId: message.rfcMessageId })).toBeNull();
    expect(f.mailbox.findByRfcMessageId).not.toHaveBeenCalled();
  });
  it("rejects foreign message references before lookup", async () => {
    const f = fixture();
    await expect(f.adapter.lookup({ snapshot: input().snapshot, message: { binding: { ...binding, generation: 2 }, id: "foreign" }, rfcMessageId: message.rfcMessageId, expectedRecipient: message.recipient })).rejects.toThrow();
    expect(f.mailbox.findByRfcMessageId).not.toHaveBeenCalled();
  });
  it("supports injected provider-ID lookup without silently using a different reference", async () => {
    const f = fixture();
    const findByMessageId = vi.fn().mockResolvedValue({ id: "known-message", threadId: "thread" });
    const adapter = createGmailAdapter({ binding, mailbox: { ...f.mailbox, findByMessageId }, readiness: f.readiness, messageDigest });
    expect((await adapter.lookup({ snapshot: input().snapshot, message: { binding, id: "known-message" }, expectedRecipient: message.recipient }))?.status).toBe("submitted");
    expect(findByMessageId).toHaveBeenCalledExactlyOnceWith("known-message");
    expect(f.mailbox.findByRfcMessageId).not.toHaveBeenCalled();
  });
  it("rejects a looked-up message that differs from the recorded message reference", async () => {
    const f = fixture();
    await expect(f.adapter.lookup({ snapshot: input().snapshot, message: { binding, id: "different-message" }, rfcMessageId: message.rfcMessageId, expectedRecipient: message.recipient })).rejects.toThrow("receipt_mismatch");
    expect(f.mailbox.send).not.toHaveBeenCalled();
  });
});

describe("draft-only CRUD (P1.2/P1.3/A17)", () => {
  it("creates, updates and deletes drafts while never calling send", async () => {
    const f = fixture();
    expect(await f.adapter.drafts!.create(input("draft_create"))).toEqual({ draft: { binding, id: "saved-draft" }, message: { binding, id: "draft-message" }, conversation: { binding, id: "existing-thread" } });
    const update = input("draft_update");
    update.snapshot.payloadDigest = draftDigest("draft_update", draft, update.message);
    expect((await f.adapter.drafts!.update({ ...update, draft })).draft).toEqual(draft);
    await f.adapter.drafts!.delete({ snapshot: { ...input().snapshot, operation: "draft_delete", payloadDigest: draftDigest("draft_delete", draft) }, draft });
    expect(f.drafts.createDraft).toHaveBeenCalledTimes(1);
    expect(f.drafts.updateDraft.mock.calls[0][0]).toBe("saved-draft");
    expect(f.drafts.updateDraft.mock.calls[0][1]).toMatchObject({ threadId: "existing-thread", messageId: message.rfcMessageId });
    expect(f.drafts.deleteDraft).toHaveBeenCalledExactlyOnceWith("saved-draft");
    expect(f.mailbox.send).not.toHaveBeenCalled();
  });
  it("does not claim draft capability without a draft port", () => {
    const f = fixture();
    const adapter = createGmailAdapter({ binding, mailbox: f.mailbox, readiness: f.readiness, messageDigest });
    expect(adapter.drafts).toBeUndefined();
    expect(adapter.capabilities.email?.drafts).toBe(false);
  });
  it("blocks draft changes that refer to another generation or target", async () => {
    const f = fixture();
    const update = input("draft_update");
    update.snapshot.payloadDigest = draftDigest("draft_update", draft, update.message);
    await expect(f.adapter.drafts!.update({ ...update, draft: { ...draft, id: "other-draft" } })).rejects.toThrow();
    await expect(f.adapter.drafts!.delete({ snapshot: { ...input().snapshot, operation: "draft_delete", payloadDigest: draftDigest("draft_delete", draft) }, draft: { ...draft, binding: { ...binding, generation: 2 } } })).rejects.toThrow();
    expect(f.drafts.updateDraft).not.toHaveBeenCalled();
    expect(f.drafts.deleteDraft).not.toHaveBeenCalled();
  });
  it("blocks create/send operation confusion before touching drafts", async () => {
    const f = fixture();
    await expect(f.adapter.drafts!.create(input("message"))).rejects.toThrow();
    expect(f.drafts.createDraft).not.toHaveBeenCalled();
  });
  it("blocks all draft mutations when readiness requires reconnection", async () => {
    const f = fixture();
    f.readiness.mockResolvedValue({ status: "review", code: "reconnect" });
    await expect(f.adapter.drafts!.create(input("draft_create"))).rejects.toThrow("reconnect");
    const update = input("draft_update");
    update.snapshot.payloadDigest = draftDigest("draft_update", draft, update.message);
    await expect(f.adapter.drafts!.update({ ...update, draft })).rejects.toThrow("reconnect");
    await expect(f.adapter.drafts!.delete({ snapshot: { ...input().snapshot, operation: "draft_delete", payloadDigest: draftDigest("draft_delete", draft) }, draft })).rejects.toThrow("reconnect");
    expect(f.drafts.createDraft).not.toHaveBeenCalled();
    expect(f.drafts.updateDraft).not.toHaveBeenCalled();
    expect(f.drafts.deleteDraft).not.toHaveBeenCalled();
    expect(f.mailbox.send).not.toHaveBeenCalled();
  });
  it("rejects unsupported Gmail account bindings at construction", () => {
    const f = fixture();
    expect(() => createGmailAdapter({ ...f, binding: { ...binding, backend: "unipile" }, messageDigest, draftDigest })).toThrow();
  });
});
