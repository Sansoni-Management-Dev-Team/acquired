import { z } from "zod";
import { organizationMetadata } from "./buyer-profile";

export const researchSettingsSchema = z.object({
  defaultTargetBusinesses: z.number().int().min(1).max(100),
});

export const defaultResearchSettings = { defaultTargetBusinesses: 20 };

export function researchSettingsFromMetadata(metadata: string | null | undefined) {
  const parsed = researchSettingsSchema.safeParse(organizationMetadata(metadata).researchSettings);
  return parsed.success ? parsed.data : defaultResearchSettings;
}

export function metadataWithResearchSettings(metadata: string | null | undefined, settings: z.infer<typeof researchSettingsSchema>) {
  return JSON.stringify({ ...organizationMetadata(metadata), researchSettings: settings });
}
