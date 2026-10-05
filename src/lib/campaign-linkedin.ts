import "server-only";
import { z } from "zod";
import type { CampaignActor } from "@/db/campaign-client";

export function linkedinCampaignEnabled() {
  return process.env.CAMPAIGN_LINKEDIN_ENABLED === "true" && Boolean(process.env.LINKEDIN_SERVICE_URL && process.env.LINKEDIN_SERVICE_SECRET);
}
export async function campaignLinkedinAccountStatus(actor: CampaignActor) {
  if (!linkedinCampaignEnabled()) throw new Error("LinkedIn campaign delivery is not enabled");
  const url = new URL("/connection", process.env.LINKEDIN_SERVICE_URL!);
  url.searchParams.set("organizationId", actor.organizationId); url.searchParams.set("userId", actor.userId);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.LINKEDIN_SERVICE_SECRET}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("LinkedIn reply account status is unavailable");
  const result = z.object({ status: z.string() }).parse(await response.json());
  if (!["connected", "disconnected"].includes(result.status)) throw new Error("LinkedIn reply monitor needs reconnection");
  return result.status;
}
export function linkedinProfileFor(data: Record<string, unknown>) {
  const value = data.linkedinUrl || data.linkedin || data.linkedin_url;
  if (typeof value !== "string") throw new Error("Contact needs a LinkedIn profile before enrolment");
  const url = new URL(value);
  if (url.protocol !== "https:" || !/(^|\.)linkedin\.com$/.test(url.hostname) || !/^\/in\/[^/]+\/?$/.test(url.pathname)) throw new Error("Contact needs a valid LinkedIn profile URL");
  return url.toString();
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
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${process.env.LINKEDIN_SERVICE_SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(50_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "LinkedIn service unavailable; review account status");
  return resultSchema.parse(data);
}
