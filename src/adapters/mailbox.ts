import { replyHttpFailure, replyRead } from "@/lib/campaign-reply-status";
import { campaignReadSignal } from "@/lib/campaign-work-budget";

export type OutboundMessage = { to: string; subject: string; text: string; replyTo?: string; threadId?: string; messageId?: string };
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
    const mime = [`To: ${safeHeader(message.to)}`, `Subject: ${encodedSubject(message.subject)}`, ...(message.replyTo ? [`Reply-To: ${safeHeader(message.replyTo)}`] : []), ...(message.messageId ? [`Message-ID: ${safeHeader(message.messageId)}`] : []), "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", message.text].join("\r\n");
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
    const response = await this.fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(50_000), body: JSON.stringify({ raw: this.encode(message), threadId: message.threadId }) });
    if (!response.ok) throw new Error(`Gmail send failed (${response.status})`);
    const result = await response.json() as { id: string; threadId: string };
    return { providerMessageId: result.id, providerThreadId: result.threadId, sentAt: new Date() };
  }

  private async searchPage(query: string, maxResults = 10, pageToken?: string): Promise<{ messages: { id: string; threadId: string }[]; nextPageToken?: string }> {
    const token = await this.accessToken();
    const params = new URLSearchParams({ q: query, maxResults: String(maxResults), ...(pageToken ? { pageToken } : {}) });
    const response = await replyRead("email", () => this.fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: campaignReadSignal() }));
    if (!response.ok) throw await replyHttpFailure(response, "email");
    const result = await response.json() as { messages?: { id: string; threadId: string }[]; nextPageToken?: string };
    return { messages: result.messages || [], nextPageToken: result.nextPageToken };
  }

  private async search(query: string, maxResults = 10): Promise<{ id: string; threadId: string }[]> {
    return (await this.searchPage(query, maxResults)).messages;
  }

  private async searchAll(query: string): Promise<{ id: string; threadId: string }[]> {
    const messages: { id: string; threadId: string }[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await this.searchPage(query, 100, pageToken);
      messages.push(...result.messages);
      if (!result.nextPageToken) return messages;
      pageToken = result.nextPageToken;
    }
    // If the history is too large to verify, block the send rather than miss a reply.
    throw new Error("Gmail conversation history exceeds the safety-check limit");
  }

  async hasConversation(address: string): Promise<boolean> {
    const normalized = address.trim().toLowerCase();
    // False positives hold a send for review; failed lookups never authorize it.
    return (await this.search(`-in:drafts from:${normalized}`, 1)).length > 0 || (await this.search(`-in:drafts to:${normalized}`, 1)).length > 0;
  }

  async inboundFrom(address: string, since: Date): Promise<{ id: string; receivedAt: Date }[]> {
    const normalized = address.trim().toLowerCase();
    const candidates = await this.searchAll(`from:${normalized} after:${Math.floor(since.getTime() / 1000)}`);
    const token = await this.accessToken();
    const messages: { id: string; internalDate: string; payload?: { headers?: { name: string; value: string }[] } }[] = [];
    for (let offset = 0; offset < candidates.length; offset += 10) {
      messages.push(...await Promise.all(candidates.slice(offset, offset + 10).map(async candidate => {
        const params = new URLSearchParams({ format: "metadata", metadataHeaders: "From" });
        const response = await replyRead("email", () => this.fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(candidate.id)}?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: campaignReadSignal() }));
        if (!response.ok) throw await replyHttpFailure(response, "email");
        return response.json() as Promise<{ id: string; internalDate: string; payload?: { headers?: { name: string; value: string }[] } }>;
      })));
    }
    return messages.filter(message => {
      const from = message.payload?.headers?.find(header => header.name.toLowerCase() === "from")?.value.toLowerCase() || "";
      return from === normalized || from.endsWith(`<${normalized}>`);
    }).map(message => ({ id: message.id, receivedAt: new Date(Number(message.internalDate)) }));
  }

  async outboundToSince(address: string, since: Date): Promise<string[]> {
    const normalized = address.trim().toLowerCase();
    const candidates = await this.searchAll(`-in:drafts to:${normalized} after:${Math.floor(since.getTime() / 1000)}`);
    return candidates.map(candidate => candidate.id);
  }

  async findByRfcMessageId(messageId: string): Promise<{ id: string; threadId: string } | null> {
    return (await this.search(`rfc822msgid:${messageId}`, 1))[0] || null;
  }
}
