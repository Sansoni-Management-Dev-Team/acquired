export type OutboundMessage = { to: string; subject: string; text: string; replyTo?: string; threadId?: string };
export type Delivery = { providerMessageId: string; providerThreadId: string; sentAt: Date };
export type SavedDraft = { providerDraftId: string; providerMessageId: string; providerThreadId: string };

export interface MailboxAdapter {
  send(userId: string, message: OutboundMessage): Promise<Delivery>;
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodedSubject(value: string) {
  const subject = safeHeader(value);
  return /^[\x20-\x7E]*$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

export class GmailMailbox implements MailboxAdapter {
  constructor(private accessToken: () => Promise<string>, private fetcher: typeof fetch = fetch) {}
  private encode(message: OutboundMessage) {
    const mime = [`To: ${safeHeader(message.to)}`, `Subject: ${encodedSubject(message.subject)}`, ...(message.replyTo ? [`Reply-To: ${safeHeader(message.replyTo)}`] : []), "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", message.text].join("\r\n");
    return Buffer.from(mime).toString("base64url");
  }

  async createDraft(_userId: string, message: OutboundMessage): Promise<SavedDraft> {
    const token = await this.accessToken();
    const response = await this.fetcher("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { raw: this.encode(message), threadId: message.threadId } }),
    });
    if (!response.ok) throw new Error(`Gmail draft creation failed (${response.status})`);
    const result = await response.json() as { id: string; message: { id: string; threadId: string } };
    return { providerDraftId: result.id, providerMessageId: result.message.id, providerThreadId: result.message.threadId };
  }

  async updateDraft(draftId: string, message: OutboundMessage): Promise<SavedDraft> {
    const token = await this.accessToken();
    const response = await this.fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { raw: this.encode(message), threadId: message.threadId } }),
    });
    if (!response.ok) throw new Error(`Gmail draft update failed (${response.status})`);
    const result = await response.json() as { id: string; message: { id: string; threadId: string } };
    return { providerDraftId: result.id, providerMessageId: result.message.id, providerThreadId: result.message.threadId };
  }

  async deleteDraft(draftId: string): Promise<void> {
    const token = await this.accessToken();
    const response = await this.fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok && response.status !== 404) throw new Error(`Gmail draft deletion failed (${response.status})`);
  }

  async send(_userId: string, message: OutboundMessage) {
    const token = await this.accessToken();
    const response = await this.fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: this.encode(message), threadId: message.threadId }) });
    if (!response.ok) throw new Error(`Gmail send failed (${response.status})`);
    const result = await response.json() as { id: string; threadId: string };
    return { providerMessageId: result.id, providerThreadId: result.threadId, sentAt: new Date() };
  }
}
