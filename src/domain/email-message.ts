export type OutboundMessage = { to: string; subject: string; text: string; replyTo?: string; threadId?: string; messageId?: string };
export type Delivery = { providerMessageId: string; providerThreadId: string; sentAt: Date };
export type SavedDraft = { providerDraftId: string; providerMessageId: string; providerThreadId: string };
