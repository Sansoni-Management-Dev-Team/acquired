import type { OutboundMessage, SavedDraft } from "@/adapters/mailbox";

type DraftMailbox = {
  createDraft(userId: string, message: OutboundMessage): Promise<SavedDraft>;
  updateDraft(draftId: string, message: OutboundMessage): Promise<SavedDraft>;
  deleteDraft(draftId: string): Promise<void>;
};

export async function syncGmailDraftApproval(input: {
  approved: boolean;
  mailbox: DraftMailbox | null;
  userId: string;
  recipient: string;
  subject: string;
  body: string;
  providerDraftId: string | null;
  providerThreadId: string | null;
}) {
  if (input.approved) {
    if (!input.mailbox) throw new Error("Connect Gmail in Settings before approving outreach.");
    const message = { to: input.recipient, subject: input.subject, text: input.body, threadId: input.providerThreadId || undefined };
    const draft = input.providerDraftId
      ? await input.mailbox.updateDraft(input.providerDraftId, message)
      : await input.mailbox.createDraft(input.userId, message);
    return { providerDraftId: draft.providerDraftId, providerThreadId: draft.providerThreadId };
  }
  if (input.providerDraftId && input.mailbox) await input.mailbox.deleteDraft(input.providerDraftId);
  return { providerDraftId: null, providerThreadId: null };
}
