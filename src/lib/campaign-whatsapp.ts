import "server-only";
import { z } from "zod";
import type { CampaignActor } from "@/db/campaign-client";
import { replyHttpFailure, replyRead } from "@/lib/campaign-reply-status";
import { campaignReadSignal } from "@/lib/campaign-work-budget";

export function whatsappCampaignEnabled() {
  return Boolean(process.env.WHATSAPP_SERVICE_URL && process.env.WHATSAPP_SERVICE_SECRET);
}
export class CampaignWhatsappDisconnected extends Error {}

export function whatsappRecipientFor(data: Record<string, unknown>) {
  const phone = typeof data.phone === "string" ? data.phone.trim().replace(/[\s().-]/g, "") : "";
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error("Contact needs a WhatsApp phone number with an international country code");
  return `${phone.slice(1)}@s.whatsapp.net`;
}

async function request(actor: CampaignActor, path: string, body?: { recipient: string; text: string }) {
  if (!whatsappCampaignEnabled()) throw new Error("WhatsApp campaign delivery is not configured");
  const url = new URL(path, process.env.WHATSAPP_SERVICE_URL!);
  url.searchParams.set("organizationId", actor.organizationId);
  url.searchParams.set("userId", actor.userId);
  // Never retry a send here: a lost response may follow an accepted message.
  const response = await fetch(url, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${process.env.WHATSAPP_SERVICE_SECRET}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", redirect: "error", signal: body ? AbortSignal.timeout(50_000) : campaignReadSignal() });
  if (!response.ok && !body) throw await replyHttpFailure(response, "whatsapp");
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "WhatsApp service unavailable");
  return data;
}

export async function assertCampaignWhatsappConnected(actor: CampaignActor) {
  const result = z.object({ status: z.string() }).parse(await replyRead("whatsapp", () => request(actor, "/connection")));
  if (result.status === "disconnected") throw new CampaignWhatsappDisconnected("Connect your WhatsApp account in Settings before starting WhatsApp automation");
  if (result.status !== "connected") throw new Error("Connect your WhatsApp account in Settings before starting WhatsApp automation");
}

export async function campaignWhatsapp(actor: CampaignActor, input: { recipient: string; text: string }) {
  if (!/^\d+@s\.whatsapp\.net$/.test(input.recipient) || !input.text.trim() || input.text.length > 4000) throw new Error("Invalid WhatsApp campaign message");
  return z.object({ id: z.string().min(1), recipient: z.string().regex(/^\d+@(s\.whatsapp\.net|lid)$/), status: z.literal("submitted") }).parse(await request(actor, "/message", input));
}
