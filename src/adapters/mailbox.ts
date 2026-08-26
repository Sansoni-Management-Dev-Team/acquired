export type OutboundMessage = { to: string; subject: string; text: string; replyTo?: string; threadId?: string };
export type Delivery = { providerMessageId: string; providerThreadId: string; sentAt: Date };

export interface MailboxAdapter {
  send(userId: string, message: OutboundMessage): Promise<Delivery>;
}

export class MockMailbox implements MailboxAdapter {
  deliveries: Array<{ userId: string; message: OutboundMessage; delivery: Delivery }> = [];
  async send(userId: string, message: OutboundMessage) {
    const id = `mock-${this.deliveries.length + 1}`;
    const delivery = { providerMessageId: id, providerThreadId: message.threadId || id, sentAt: new Date() };
    this.deliveries.push({ userId, message, delivery });
    return delivery;
  }
}

export class GmailMailbox implements MailboxAdapter {
  constructor(private accessToken: () => Promise<string>, private fetcher: typeof fetch = fetch) {}
  async send(_userId: string, message: OutboundMessage) {
    const token = await this.accessToken();
    const mime = [`To: ${message.to}`, `Subject: ${message.subject}`, ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []), "Content-Type: text/plain; charset=utf-8", "", message.text].join("\r\n");
    const raw = Buffer.from(mime).toString("base64url");
    const response = await this.fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw, threadId: message.threadId }) });
    if (!response.ok) throw new Error(`Gmail send failed (${response.status})`);
    const result = await response.json() as { id: string; threadId: string };
    return { providerMessageId: result.id, providerThreadId: result.threadId, sentAt: new Date() };
  }
}
