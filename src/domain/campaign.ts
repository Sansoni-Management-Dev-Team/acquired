import { z } from "zod";

const emailStep = z.object({ id: z.string().uuid(), kind: z.literal("email"), title: z.string().trim().min(1).max(100), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(10000) }).strict();
const waitStep = z.object({ id: z.string().uuid(), kind: z.literal("wait"), title: z.string().trim().min(1).max(100), days: z.number().int().min(1).max(30) }).strict();
const linkedinStep = emailStep.omit({ subject: true }).extend({ kind: z.literal("linkedin") });
const whatsappStep = emailStep.omit({ subject: true }).extend({ kind: z.literal("whatsapp") });
export const campaignStep = z.discriminatedUnion("kind", [emailStep, waitStep, linkedinStep, whatsappStep]);
export const campaignDefinition = z.object({ schemaVersion: z.literal(1), steps: z.array(campaignStep).min(1).max(25) }).strict().superRefine((definition, context) => {
  if (definition.steps[0]?.kind === "wait") context.addIssue({ code: "custom", message: "The first step must be a message" });
  if (definition.steps.at(-1)?.kind === "wait") context.addIssue({ code: "custom", message: "The last step must be a message" });
  for (let index = 1; index < definition.steps.length; index++) {
    if ((definition.steps[index].kind === "wait") === (definition.steps[index - 1].kind === "wait")) context.addIssue({ code: "custom", message: "Message and wait steps must alternate" });
  }
  const ids = definition.steps.map(step => step.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Step IDs must be unique" });
});
export type CampaignDefinition = z.infer<typeof campaignDefinition>;
export type CampaignStep = z.infer<typeof campaignStep>;

export const createCampaignRequest = z.object({ mandateId: z.string().uuid(), name: z.string().trim().min(1).max(120), definition: campaignDefinition }).strict();
export const saveCampaignRequest = z.object({ name: z.string().trim().min(1).max(120), definition: campaignDefinition }).strict();
export const enrolCampaignRequest = z.object({ contactIds: z.array(z.string().uuid()).min(1).max(50), confirmation: z.literal(true) }).strict();
export const enrolmentActionRequest = z.object({ action: z.enum(["pause", "resume", "stop", "review_existing_conversation", "retry_preflight"]) }).strict();

export function normalizeEmail(value: string) { return value.trim().toLowerCase(); }

export function renderCampaignTemplate(template: string, contact: { displayName: string; companyName: string }) {
  const firstName = contact.displayName.trim().split(/\s+/)[0] || contact.displayName;
  return template.replace(/{{\s*(first_name|full_name|company_name)\s*}}/g, (_whole, key: string) => {
    if (key === "first_name") return firstName;
    if (key === "full_name") return contact.displayName;
    return contact.companyName;
  });
}

export function nextEmailAfter(definition: CampaignDefinition, sentIndex: number, sentAt: Date) {
  const wait = definition.steps[sentIndex + 1];
  if (!wait) return null;
  if (wait.kind !== "wait" || definition.steps[sentIndex + 2]?.kind !== "email") throw new Error("Invalid published campaign version");
  const nextAt = new Date(sentAt);
  nextAt.setUTCDate(nextAt.getUTCDate() + wait.days);
  return { index: sentIndex + 2, at: nextAt };
}

export function campaignSendWindowOpen(input: Date, timeZone = "Australia/Melbourne") {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" });
  const parts = formatter.formatToParts(input);
  const day = parts.find(part => part.type === "weekday")?.value;
  const hour = Number(parts.find(part => part.type === "hour")?.value);
  return day !== "Sat" && day !== "Sun" && hour >= 9 && hour < 17;
}

export function nextAllowedCampaignSend(input: Date, timeZone = "Australia/Melbourne") {
  if (campaignSendWindowOpen(input, timeZone)) return new Date(input);
  const candidate = new Date(input);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  for (let index = 0; index < 7 * 24 * 60; index++) {
    if (campaignSendWindowOpen(candidate, timeZone)) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new Error("Could not find an allowed sending window");
}
