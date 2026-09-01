import { describe, expect, it, vi } from "vitest";
import { syncGmailDraftApproval } from "./gmail-draft-approval";

function mailbox() {
  return {
    createDraft: vi.fn(async () => ({ providerDraftId: "draft-1", providerMessageId: "message-1", providerThreadId: "thread-1" })),
    updateDraft: vi.fn(async () => ({ providerDraftId: "draft-1", providerMessageId: "message-2", providerThreadId: "thread-1" })),
    deleteDraft: vi.fn(async () => undefined),
  };
}

const input = { userId: "user-1", recipient: "owner@example.com", subject: "Hello", body: "Message body", providerDraftId: null, providerThreadId: null };

describe("Gmail draft approval synchronization", () => {
  it("creates a Gmail draft when a message is approved", async () => {
    const provider = mailbox();
    await expect(syncGmailDraftApproval({ ...input, approved: true, mailbox: provider })).resolves.toEqual({ providerDraftId: "draft-1", providerThreadId: "thread-1" });
    expect(provider.createDraft).toHaveBeenCalledOnce();
    expect(provider.deleteDraft).not.toHaveBeenCalled();
  });

  it("updates an existing Gmail draft rather than creating a duplicate", async () => {
    const provider = mailbox();
    await syncGmailDraftApproval({ ...input, approved: true, mailbox: provider, providerDraftId: "draft-1", providerThreadId: "thread-1" });
    expect(provider.updateDraft).toHaveBeenCalledWith("draft-1", expect.objectContaining({ subject: "Hello" }));
    expect(provider.createDraft).not.toHaveBeenCalled();
  });

  it("deletes the Gmail draft when approval is revoked", async () => {
    const provider = mailbox();
    await expect(syncGmailDraftApproval({ ...input, approved: false, mailbox: provider, providerDraftId: "draft-1" })).resolves.toEqual({ providerDraftId: null, providerThreadId: null });
    expect(provider.deleteDraft).toHaveBeenCalledWith("draft-1");
  });
});
