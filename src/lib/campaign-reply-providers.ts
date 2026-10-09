import "server-only";
import type { CampaignActor } from "@/db/campaign-client";
import { replyPageSchema, type ReplyChannel } from "@/domain/campaign-replies";
import { campaignReadSignal, campaignWorkDeferred } from "@/lib/campaign-work-budget";
import { replyCheckFailure, replyHttpFailure } from "@/lib/campaign-reply-status";

export async function readChannelReplies(actor: CampaignActor, channel: Exclude<ReplyChannel, "email">, cursor: string | null, since?: Date, options: { refresh?: boolean } = {}) {
  const prefix = channel === "whatsapp" ? "WHATSAPP" : "LINKEDIN";
  const base = process.env[`${prefix}_SERVICE_URL`];
  const secret = process.env[`${prefix}_SERVICE_SECRET`];
  const label = channel === "whatsapp" ? "WhatsApp" : "LinkedIn";
  if (!base || !secret) throw new Error(`${label} reply monitor is not configured`);
  const url = new URL("/replies", base);
  url.searchParams.set("organizationId", actor.organizationId);
  url.searchParams.set("userId", actor.userId);
  if (channel === "linkedin") { url.searchParams.set("background", "true"); url.searchParams.set("refresh", String(options.refresh !== false)); }
  if (channel === "linkedin" && since) url.searchParams.set("since", since.toISOString());
  if (cursor !== null) url.searchParams.set("cursor", cursor);
  try {
    const response = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${secret}` }, cache: "no-store", redirect: "error", signal: campaignReadSignal() });
    if (!response.ok) {
      throw await replyHttpFailure(response, channel);
    }
    return replyPageSchema.parse(await response.json());
  } catch (error) { if (campaignWorkDeferred(error)) throw error; throw replyCheckFailure(error, channel); }
}
