import "server-only";
import { contactLinkedin } from "@/domain/contact-record";
import { z } from "zod";
import type { CampaignActor } from "@/db/campaign-client";
import { ReplyCheckReview, replyCheckFailure, replyHttpFailure } from "@/lib/campaign-reply-status";
import { campaignReadSignal } from "@/lib/campaign-work-budget";

export function linkedinCampaignEnabled() {
  return process.env.CAMPAIGN_LINKEDIN_ENABLED === "true" && Boolean(process.env.LINKEDIN_SERVICE_URL && process.env.LINKEDIN_SERVICE_SECRET);
}
export async function campaignLinkedinAccountStatus(actor: CampaignActor) {
  if (!linkedinCampaignEnabled()) throw new Error("LinkedIn campaign delivery is not enabled");
  const url = new URL("/connection", process.env.LINKEDIN_SERVICE_URL!);
  url.searchParams.set("organizationId", actor.organizationId); url.searchParams.set("userId", actor.userId);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.LINKEDIN_SERVICE_SECRET}` }, cache: "no-store", redirect: "error", signal: campaignReadSignal(15_000) });
  if (!response.ok) throw await replyHttpFailure(response, "linkedin");
  const result = z.object({ status: z.string() }).parse(await response.json());
  if (!["connected", "disconnected"].includes(result.status)) throw new ReplyCheckReview("reconnect", "linkedin");
  return result.status;
}
export function linkedinProfileFor(data: Record<string, unknown>) {
  const profile = contactLinkedin(data.linkedinUrl || data.linkedin || data.linkedin_url);
  if (!profile) throw new Error("Contact needs a valid LinkedIn profile URL before enrolment");
  return profile;
}
const resultSchema = z.object({
  recipient: z.string().nullable().optional(),
  connected: z.boolean().nullable().optional(), status: z.string().optional(), nextEligibleAt: z.number().nonnegative().optional(),
  action: z.object({ id: z.string().min(1), status: z.enum(["queued", "submitted", "skipped", "uncertain", "blocked", "expired", "cancelled"]), reason: z.string().nullable().optional(), attemptedAt: z.number().nonnegative().optional(), nextEligibleAt: z.number().nonnegative().nullable().optional() }).optional(),
});
export async function campaignLinkedin(actor: CampaignActor, input: { operation: "status" | "connect" | "message"; profile: string; key?: string; text?: string }) {
  if (!linkedinCampaignEnabled()) throw new Error("LinkedIn campaign delivery is not enabled");
  const url = new URL("/campaign", process.env.LINKEDIN_SERVICE_URL!);
  url.searchParams.set("organizationId", actor.organizationId);
  url.searchParams.set("userId", actor.userId);
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${process.env.LINKEDIN_SERVICE_SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store", redirect: "error", signal: input.operation === "status" ? campaignReadSignal() : AbortSignal.timeout(50_000) });
  if (!response.ok && (input.operation === "status" || [400,401,403,409,429].includes(response.status))) throw await replyHttpFailure(response, "linkedin");
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "LinkedIn service unavailable; review account status");
  return resultSchema.parse(data);
}

// Check hosted switches before claiming a send, so disabled delivery cannot be
// mistaken for an unknown result from an attempted provider submission.
export async function assertLinkedinDeliveryReady(actor: CampaignActor) {
  if (!linkedinCampaignEnabled()) throw new ReplyCheckReview("delivery_disabled", "linkedin");
  const url = new URL("/settings", process.env.LINKEDIN_SERVICE_URL!);
  url.searchParams.set("organizationId", actor.organizationId); url.searchParams.set("userId", actor.userId);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.LINKEDIN_SERVICE_SECRET}` }, cache: "no-store", redirect: "error", signal: campaignReadSignal() });
    if (!response.ok) throw await replyHttpFailure(response, "linkedin");
    const result = z.object({ fixture: z.boolean(), protection: z.object({ status: z.string().optional(), liveSendsEnabled: z.boolean(), campaignsEnabled: z.boolean() }) }).parse(await response.json());
    if (result.protection.status === "needs_verification") throw new ReplyCheckReview("reconnect", "linkedin");
    if (!result.fixture && (!result.protection.liveSendsEnabled || !result.protection.campaignsEnabled)) throw new ReplyCheckReview("delivery_disabled", "linkedin");
    return result.protection;
  } catch (error) { throw replyCheckFailure(error, "linkedin"); }
}

// Receipt recovery cannot invoke the submit endpoint, even for the same key.
export async function lookupCampaignLinkedin(actor:CampaignActor,key:string) {
  if (!linkedinCampaignEnabled()) throw new ReplyCheckReview("delivery_disabled","linkedin");
  const url=new URL("/campaign",process.env.LINKEDIN_SERVICE_URL!);
  url.searchParams.set("organizationId",actor.organizationId);url.searchParams.set("userId",actor.userId);url.searchParams.set("key",key);
  const response=await fetch(url,{headers:{Authorization:`Bearer ${process.env.LINKEDIN_SERVICE_SECRET}`},cache:"no-store",redirect:"error",signal:campaignReadSignal()});
  if(!response.ok)throw await replyHttpFailure(response,"linkedin");
  const result=resultSchema.parse(await response.json());return result.status==="missing"?null:result;
}
