import "server-only";
import type { CampaignActor } from "@/db/campaign-client";
import { replyPageSchema, type ReplyChannel } from "@/domain/campaign-replies";

export async function readChannelReplies(actor: CampaignActor, channel: Exclude<ReplyChannel, "email">, cursor: string | null) {
  const prefix = channel === "whatsapp" ? "WHATSAPP" : "LINKEDIN";
  const base = process.env[`${prefix}_SERVICE_URL`];
  const secret = process.env[`${prefix}_SERVICE_SECRET`];
  const label = channel === "whatsapp" ? "WhatsApp" : "LinkedIn";
  if (!base || !secret) throw new Error(`${label} reply monitor is not configured`);
  const url = new URL("/replies", base);
  url.searchParams.set("organizationId", actor.organizationId);
  url.searchParams.set("userId", actor.userId);
  if (cursor !== null) url.searchParams.set("cursor", cursor);
  const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(50_000) });
  if (!response.ok) throw new Error(`${label} reply monitor unavailable; reconnect or review channel status`);
  return replyPageSchema.parse(await response.json());
}
