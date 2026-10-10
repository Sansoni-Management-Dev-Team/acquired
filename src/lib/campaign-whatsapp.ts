import "server-only";
import { z } from "zod";
import type { CampaignActor } from "@/db/campaign-client";
import { ReplyCheckPending, ReplyCheckReview, replyHttpFailure, replyRead } from "@/lib/campaign-reply-status";
import { deliveryOutcomeSchema, type DeliveryOutcome } from "@/domain/channel-delivery";
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

async function request(actor: CampaignActor, path: string, body?: { key: string; recipient: string; text: string }) {
  if (!whatsappCampaignEnabled()) throw new Error("WhatsApp campaign delivery is not configured");
  const url = new URL(path, process.env.WHATSAPP_SERVICE_URL!);
  url.searchParams.set("organizationId", actor.organizationId);
  url.searchParams.set("userId", actor.userId);
  // Never retry a send here: a lost response may follow an accepted message.
  const response = await fetch(url, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${process.env.WHATSAPP_SERVICE_SECRET}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", redirect: "error", signal: body ? AbortSignal.timeout(50_000) : campaignReadSignal() });
  if (!response.ok && (!body || [400,401,403,409,429].includes(response.status))) throw await replyHttpFailure(response, "whatsapp");
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "WhatsApp service unavailable");
  return data;
}

export async function assertCampaignWhatsappConnected(actor: CampaignActor) {
  const result = z.object({ status: z.string() }).parse(await replyRead("whatsapp", () => request(actor, "/connection")));
  if (result.status === "disconnected") throw new CampaignWhatsappDisconnected("Connect your WhatsApp account in Settings before starting WhatsApp automation");
  if (["connecting", "reconnecting"].includes(result.status)) throw new ReplyCheckPending("incomplete", "whatsapp");
  if (result.status !== "connected") throw new ReplyCheckReview("reconnect", "whatsapp");
  const capabilities = z.object({contractVersion:z.literal(1),campaignsEnabled:z.boolean(),capabilities:z.array(z.string())}).safeParse(await replyRead("whatsapp",()=>request(actor,"/capabilities")));
  if (!capabilities.success || !capabilities.data.campaignsEnabled || !["idempotent_submission","receipt_lookup"].every(c=>capabilities.data.capabilities.includes(c))) throw new ReplyCheckReview("delivery_disabled","whatsapp");
}

export async function campaignWhatsapp(actor: CampaignActor, input: { key:string; recipient: string; text: string }):Promise<DeliveryOutcome> {
  if (!input.key || input.key.length>200 || !/^\d+@s\.whatsapp\.net$/.test(input.recipient) || !input.text.trim() || input.text.length > 4000) throw new Error("Invalid WhatsApp campaign message");
  const result=z.object({contractVersion:z.literal(1)}).passthrough().parse(await request(actor,"/campaign",input));
  return deliveryOutcomeSchema.parse(result);
}
export async function lookupCampaignWhatsapp(actor:CampaignActor,key:string):Promise<DeliveryOutcome|null> {
  const result=z.object({contractVersion:z.literal(1),status:z.string()}).passthrough().parse(await replyRead("whatsapp",()=>request(actor,`/campaign?key=${encodeURIComponent(key)}`)));
  return result.status==="missing"?null:deliveryOutcomeSchema.parse(result);
}
