import "server-only";
import { z } from "zod";
import type { CampaignActor } from "@/db/campaign-client";

export function linkedinCampaignEnabled() {
  return process.env.CAMPAIGN_LINKEDIN_ENABLED === "true" && Boolean(process.env.LINKEDIN_SERVICE_URL && process.env.LINKEDIN_SERVICE_SECRET);
}
export function linkedinProfileFor(data: Record<string, unknown>) {
  const value = data.linkedinUrl || data.linkedin || data.linkedin_url;
  if (typeof value !== "string") throw new Error("Contact needs a LinkedIn profile before enrolment");
  const url = new URL(value);
  if (url.protocol !== "https:" || !/(^|\.)linkedin\.com$/.test(url.hostname) || !/^\/in\/[^/]+\/?$/.test(url.pathname)) throw new Error("Contact needs a valid LinkedIn profile URL");
  return url.toString();
}
const resultSchema = z.object({
  connected: z.boolean().nullable().optional(), status: z.string().optional(), nextEligibleAt: z.number().optional(),
  action: z.object({ id: z.string(), status: z.enum(["queued", "submitted", "skipped", "uncertain", "blocked", "expired", "cancelled"]), reason: z.string().nullable().optional(), attemptedAt: z.number().optional(), nextEligibleAt: z.number().nullable().optional() }).optional(),
});
export async function campaignLinkedin(actor: CampaignActor, input: { operation: "status" | "connect" | "message"; profile: string; key?: string; text?: string }) {
  if (!linkedinCampaignEnabled()) throw new Error("LinkedIn campaign delivery is not enabled");
  const url = new URL("/campaign", process.env.LINKEDIN_SERVICE_URL!);
  url.searchParams.set("organizationId", actor.organizationId);
  url.searchParams.set("userId", actor.userId);
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${process.env.LINKEDIN_SERVICE_SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store", signal: AbortSignal.timeout(50_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "LinkedIn service unavailable; review account status");
  return resultSchema.parse(data);
}
