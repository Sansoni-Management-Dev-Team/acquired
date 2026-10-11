import "server-only";
import type { Delivery, OutboundMessage } from "@/adapters/mailbox";
import { connectionCanMonitorReplies, mailboxForConnection, type GmailConnectionGrant } from "@/lib/gmail-connection";
import { campaignReadSignal } from "@/lib/campaign-work-budget";

export type CampaignMailbox = {
  send(userId: string, message: OutboundMessage): Promise<Delivery>;
  hasConversation(address: string): Promise<boolean>;
  inboundPage?(address: string, since: Date, pageToken: string | null): Promise<{ events: {id:string;receivedAt:Date}[]; nextPageToken:string|null }>;
  historyHead?(): Promise<string|null>;
  historyPage?(historyId:string,pageToken:string|null):Promise<{events:{id:string;fromIdentity:string;receivedAt:string}[];nextPageToken:string|null;historyId:string}>;
  inboundFrom(address: string, since: Date): Promise<{ id: string; receivedAt: Date }[]>;
  outboundToSince(address: string, since: Date): Promise<string[]>;
  findByRfcMessageId(messageId: string): Promise<{ id: string; threadId: string } | null>;
};

function localSinkUrl() {
  const configured = process.env.CAMPAIGN_TEST_SINK_URL;
  if (!configured) return null;
  const database = new URL(process.env.DATABASE_URL || "postgresql://invalid.invalid/invalid");
  const sink = new URL(configured);
  const isolated=process.env.CAMPAIGN_ISOLATED_CHANNEL_STACK === "1";
  const localProfile = database.hostname === "127.0.0.1" && database.port === (isolated ? "5445" : "5434")
    && database.pathname === (isolated ? "/acquire_channels" : "/project_acquire")
    && sink.origin === (isolated ? "http://127.0.0.1:18124" : "http://127.0.0.1:18094") && sink.pathname === "/";
  if (process.env.NODE_ENV === "production" || process.env.LOCAL_DEVELOPMENT !== "true" || !localProfile) {
    throw new Error("Campaign test delivery is allowed only with the dedicated local OrbStack database and sink");
  }
  return sink;
}

export function campaignTestSendAnytime() {
  return process.env.CAMPAIGN_TEST_SEND_ANYTIME === "true" && Boolean(localSinkUrl());
}

class LocalCampaignMailbox implements CampaignMailbox {
  constructor(private readonly base: URL, private readonly mailboxId: string) {}

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, this.base), { ...options, headers: { "Content-Type": "application/json", ...options?.headers }, signal: options?.method === "POST" ? AbortSignal.timeout(5_000) : campaignReadSignal(5_000) });
    if (!response.ok) throw new Error(`Local campaign sink failed (${response.status})`);
    return response.json() as Promise<T>;
  }

  private query(path: string, parameters: Record<string, string>) {
    return `${path}?${new URLSearchParams({ mailboxId: this.mailboxId, ...parameters })}`;
  }

  hasConversation(address: string) {
    return this.request<{ existing: boolean }>(this.query("conversation", { email: address })).then(result => result.existing);
  }

  inboundFrom(address: string, since: Date) {
    return this.request<{ id: string; receivedAt: string }[]>(this.query("inbound", { email: address, since: since.toISOString() }))
      .then(events => events.map(event => ({ id: event.id, receivedAt: new Date(event.receivedAt) })));
  }

  outboundToSince(address: string, since: Date) {
    return this.request<string[]>(this.query("outbound", { email: address, since: since.toISOString() }));
  }

  findByRfcMessageId(messageId: string) {
    return this.request<{ id: string; threadId: string } | null>(this.query("message", { messageId }));
  }

  send(userId: string, message: OutboundMessage) {
    return this.request<{ providerMessageId: string; providerThreadId: string; sentAt: string }>("send", {
      method: "POST", body: JSON.stringify({ mailboxId: this.mailboxId, userId, message }),
    }).then(result => ({ ...result, sentAt: new Date(result.sentAt) }));
  }
}

export function campaignMailboxForConnection(connection: GmailConnectionGrant, mailboxId: string): CampaignMailbox {
  if (!connectionCanMonitorReplies(connection)) throw new Error("Reconnect Gmail with compose and read-only access before automation");
  const sink = localSinkUrl();
  return sink ? new LocalCampaignMailbox(sink, mailboxId) : mailboxForConnection(connection);
}
