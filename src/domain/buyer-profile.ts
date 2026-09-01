import { z } from "zod";

export const buyerProfileSchema = z.object({
  senderName: z.string().trim().min(2).max(100),
  background: z.string().trim().min(10).max(500),
  investmentThesis: z.string().trim().min(10).max(500),
  operatingIntent: z.string().trim().min(10).max(500),
  callToAction: z.string().trim().min(5).max(240),
  signature: z.string().trim().min(2).max(300),
});

export type BuyerProfile = z.infer<typeof buyerProfileSchema>;

export function organizationMetadata(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function buyerProfileFromMetadata(value: string | null | undefined) {
  const parsed = buyerProfileSchema.safeParse(organizationMetadata(value).buyerProfile);
  return parsed.success ? parsed.data : null;
}

export function metadataWithBuyerProfile(value: string | null | undefined, profile: BuyerProfile) {
  return JSON.stringify({ ...organizationMetadata(value), buyerProfile: profile });
}
