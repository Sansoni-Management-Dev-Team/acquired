import { z } from "zod";
import { outreachEmail } from "./outreach-contact";
import { campaignStepEntries, type CampaignDefinition } from "./campaign";
import type { ReplyChannel } from "./campaign-replies";

export function contactLinkedin(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !/(^|\.)linkedin\.com$/.test(url.hostname) || !/^\/in\/[^/]+\/?$/.test(url.pathname)) return null;
    return `https://www.linkedin.com${url.pathname.replace(/\/$/, "")}`;
  } catch { return null; }
}

export function contactPhone(value: unknown): string | null {
  const phone = typeof value === "string" ? value.trim().replace(/[\s().-]/g, "") : "";
  return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : null;
}

const optionalText = z.string().trim().max(500).optional();
export const createContactRequest = z.object({
  fullName: optionalText,
  linkedinUrl: optionalText.refine(value => !value || contactLinkedin(value) !== null, "Enter a LinkedIn person profile URL"),
  email: optionalText.refine(value => !value || outreachEmail(value) !== null, "Enter a valid email address"),
  company: optionalText,
  jobTitle: optionalText,
  phone: optionalText,
}).strict();
export type CreateContactRequest = z.infer<typeof createContactRequest>;

export function campaignChannels(definition: CampaignDefinition): ReplyChannel[] {
  return [...new Set(campaignStepEntries(definition).flatMap(({ step }) => step.kind === "wait" ? [] : [step.kind]))];
}

export function missingCampaignDetails(definition: CampaignDefinition, contact: { email?: unknown; phone?: unknown; linkedinUrl?: unknown }): string[] {
  return campaignChannels(definition).flatMap(channel => {
    if (channel === "email") return outreachEmail(contact.email) ? [] : ["email"];
    if (channel === "whatsapp") return contactPhone(contact.phone) ? [] : ["phone with international country code"];
    return contactLinkedin(contact.linkedinUrl) ? [] : ["LinkedIn profile"];
  });
}

export type ContactFilter = "all" | "linkedin" | "email" | "phone";
export function matchesContactFilter(contact: { email?: unknown; phone?: unknown; linkedinUrl?: unknown }, filter: ContactFilter) {
  if (filter === "linkedin") return Boolean(contactLinkedin(contact.linkedinUrl));
  if (filter === "email") return Boolean(outreachEmail(contact.email));
  if (filter === "phone") return typeof contact.phone === "string" && Boolean(contact.phone.trim());
  return true;
}
