import { z } from "zod";

export const buyerProfileSchema = z.object({
  // Legacy fields remain readable so profiles saved before the Settings redesign still work.
  buyerType: z.enum(["trade", "financial", "individual"]).optional(),
  capitalAvailable: z.string().max(1000).optional(),
  fundingForm: z.string().max(1000).optional(),
  capitalConfirmed: z.boolean().optional(),
  publicProfileApproved: z.boolean().optional(),
  senderName: z.string().trim().min(2).max(100),
  about: z.string().trim().min(10).max(1500).optional(),
  exampleEmail: z.string().trim().max(5000).optional(),
  background: z.string().trim().min(10).max(500).optional(),
  investmentThesis: z.string().trim().min(10).max(500).optional(),
  operatingIntent: z.string().trim().min(10).max(500).optional(),
  callToAction: z.string().trim().min(5).max(240).optional(),
  signature: z.string().trim().min(2).max(300),
}).superRefine((profile, ctx) => {
  if (!profile.about && !profile.background) ctx.addIssue({ code: "custom", path: ["about"], message: "Tell us a bit about yourself" });
  if (profile.capitalConfirmed && [profile.capitalAvailable, profile.fundingForm].some(value => !value?.trim() || /^(unknown|tbd|not yet known)$/i.test(value.trim()))) ctx.addIssue({ code: "custom", message: "Confirmed capital needs an amount and funding form" });
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

// Explicit allow-list: private capital and funding details never leave for drafting.
export function publicBuyerProfile(profile: BuyerProfile, positioning?: string): BuyerProfile {
  return {
    senderName: profile.senderName,
    about: [profile.about || [profile.background, profile.investmentThesis, profile.operatingIntent].filter(Boolean).join(" "), positioning].filter(Boolean).join(" ").slice(0, 1500),
    exampleEmail: profile.exampleEmail,
    signature: profile.signature,
  };
}
