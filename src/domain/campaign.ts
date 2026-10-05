import { z } from "zod";

const campaignPosition = z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).strict();
const emailStep = z.object({ id: z.string().uuid(), kind: z.literal("email"), title: z.string().trim().min(1).max(100), subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(10000), position: campaignPosition.optional() }).strict();
const waitStep = z.object({ id: z.string().uuid(), kind: z.literal("wait"), title: z.string().trim().min(1).max(100), days: z.number().int().min(1).max(30), position: campaignPosition.optional() }).strict();
const linkedinStep = emailStep.omit({ subject: true }).extend({
  kind: z.literal("linkedin"), action: z.enum(["message", "connect"]).optional(),
  body: z.string().trim().max(10000),
}).superRefine((step, context) => {
  if (step.action === "message" && step.body.length > 4000) context.addIssue({ code: "custom", message: "LinkedIn messages must be at most 4000 characters" });
  if (step.action === "connect" ? step.body.length > 200 : !step.body.length)
    context.addIssue({ code: "custom", message: step.action === "connect" ? "Connection notes must be at most 200 characters" : "LinkedIn messages need a body" });
});
const whatsappStep = emailStep.omit({ subject: true }).extend({ kind: z.literal("whatsapp") });
export const campaignStep = z.discriminatedUnion("kind", [emailStep, waitStep, linkedinStep, whatsappStep]);
export const campaignSplit = z.object({
  id: z.string().uuid(), title: z.string().trim().min(1).max(100), afterStepId: z.union([z.string().uuid(), z.literal("start")]),
  percentage: z.number().int().min(1).max(99),
  condition: z.object({ kind: z.literal("linkedin_connected"), timeoutDays: z.number().int().min(1).max(30) }).strict().optional(),
  position: campaignPosition.optional(),
  pathA: z.array(campaignStep).min(1).max(24), pathB: z.array(campaignStep).min(1).max(24),
}).strict();
export const campaignDefinition = z.object({ schemaVersion: z.literal(1), steps: z.array(campaignStep).min(1).max(25), splits: z.array(campaignSplit).max(6).optional() }).strict().superRefine((definition, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  const validateChain = (steps: CampaignStep[], branch = false) => {
    if ((steps[0]?.kind === "wait") !== branch) issue(branch ? "Each split path must start with a wait" : "The first step must be a message");
    if (steps.at(-1)?.kind === "wait") issue("The last step must be a message");
    for (let index = 1; index < steps.length; index++) {
      if ((steps[index].kind === "wait") === (steps[index - 1].kind === "wait")) issue("Message and wait steps must alternate");
    }
  };
  const startSplit = definition.splits?.find(split => split.afterStepId === "start");
  validateChain(definition.steps, Boolean(startSplit));
  const anchors = new Set<string>();
  for (const split of definition.splits || []) {
    const anchor = definition.steps.find(step => step.id === split.afterStepId);
    if (split.afterStepId !== "start" && (!anchor || anchor.kind === "wait")) issue("Split paths must follow a message in the main sequence");
    if (split.condition && (anchor?.kind !== "linkedin" || anchor.action !== "connect")) issue("Wait for acceptance must follow a LinkedIn connection request in the main sequence");
    if (anchors.has(split.afterStepId)) issue("A message can have only one split");
    anchors.add(split.afterStepId);
    validateChain(split.pathA, split.afterStepId !== "start");
    validateChain(split.pathB, split.afterStepId !== "start");
  }
  const steps = campaignStepEntries(definition).map(entry => entry.step);
  if (steps.length > 25) issue("Sequences can contain at most 25 message and wait nodes across all paths");
  const ids = [...steps.map(step => step.id), ...(definition.splits || []).map(split => split.id)];
  if (new Set(ids).size !== ids.length) issue("Step and split IDs must be unique");
});
export type CampaignDefinition = z.infer<typeof campaignDefinition>;
export type CampaignStep = z.infer<typeof campaignStep>;
export type CampaignSplit = z.infer<typeof campaignSplit>;
export type CampaignDraft = { steps: CampaignStep[]; schemaVersion?: 1; splits?: CampaignSplit[] };
export type CampaignStepEntry = { step: CampaignStep; split?: CampaignSplit; path?: "pathA" | "pathB" };

// Keep runtime indices monotonic on either path, and unchanged for old versions.
export function campaignStepEntries(definition: CampaignDraft): CampaignStepEntry[] {
  const start = definition.splits?.find(split => split.afterStepId === "start");
  const branches = start ? (["pathA", "pathB"] as const).flatMap(path => start[path].map(step => ({ step, split: start, path }))) : [];
  return [...branches, ...definition.steps.flatMap(step => {
    const split = definition.splits?.find(item => item.afterStepId === step.id);
    return [{ step }, ...(split ? (["pathA", "pathB"] as const).flatMap(path => split[path].map(step => ({ step, split, path }))) : [])];
  })];
}

export function campaignPathFor(split: CampaignSplit, routingKey: string): "pathA" | "pathB" {
  if (split.condition) throw new Error("Condition branches require an observed outcome");
  // A stable bucket per enrolment and split survives retries and worker restarts.
  let hash = 2166136261;
  for (const char of `${routingKey}:${split.id}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 100 < split.percentage ? "pathA" : "pathB";
}

export function campaignFirstStepIndex(definition: CampaignDraft, routingKey: string) {
  const split = definition.splits?.find(split => split.afterStepId === "start");
  if (!split) return 0;
  const step = split[campaignPathFor(split, routingKey)][0];
  return campaignStepEntries(definition).findIndex(entry => entry.step.id === step.id);
}

export function campaignNextOptions(definition: CampaignDraft, sentIndex: number) {
  const entries = campaignStepEntries(definition);
  const current = entries[sentIndex];
  if (!current || current.step.kind === "wait") throw new Error("Invalid published campaign version");
  const mainIndex = definition.steps.findIndex(step => step.id === (current.split?.afterStepId || current.step.id));
  const nextIn = (chain: CampaignStep[], index: number) => {
    const wait = chain[index + 1];
    if (!wait) return [];
    const message = chain[index + 2];
    if (wait.kind !== "wait" || !message || message.kind === "wait") throw new Error("Invalid published campaign version");
    return [{ index: entries.findIndex(entry => entry.step.id === message.id), days: wait.days }];
  };
  if (current.split && current.path) {
    const chain = current.split[current.path];
    const index = chain.findIndex(step => step.id === current.step.id);
    return index === chain.length - 1 ? nextIn(definition.steps, mainIndex) : nextIn(chain, index);
  }
  const split = definition.splits?.find(item => item.afterStepId === current.step.id);
  return split ? (["pathA", "pathB"] as const).flatMap(path => nextIn(split[path], -1).map(next => ({ ...next, split, path }))) : nextIn(definition.steps, mainIndex);
}

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

export function nextCampaignStepAfter(definition: CampaignDefinition, sentIndex: number, sentAt: Date, routingKey = "", conditionPath?: "pathA" | "pathB") {
  const options = campaignNextOptions(definition, sentIndex);
  if (!options.length) return null;
  const split = definition.splits?.find(item => item.afterStepId === campaignStepEntries(definition)[sentIndex].step.id);
  if (split && !routingKey) throw new Error("Split paths require an enrolment routing key");
  if (split?.condition && !conditionPath) throw new Error("Condition branch has not been resolved");
  const next = options[split && (split.condition ? conditionPath : campaignPathFor(split, routingKey)) === "pathB" ? 1 : 0];
  const nextAt = new Date(sentAt);
  nextAt.setUTCDate(nextAt.getUTCDate() + next.days);
  return { index: next.index, at: nextAt };
}

export function nextEmailAfter(definition: CampaignDefinition, sentIndex: number, sentAt: Date, routingKey = "") {
  const next = nextCampaignStepAfter(definition, sentIndex, sentAt, routingKey);
  if (next && campaignStepEntries(definition)[next.index].step.kind !== "email") throw new Error("Invalid published campaign version");
  return next;
}

export function campaignStepLabel(step: CampaignStep) {
  return step.kind === "linkedin" ? step.action === "connect" ? "LinkedIn connection request" : "LinkedIn message" : step.kind === "email" ? "Email" : step.kind === "wait" ? "Wait" : "WhatsApp";
}

export function acceptancePath(connected: boolean | null, sentAt: Date, timeoutDays: number, now: Date): "pathA" | "pathB" | null {
  // Unknown provider responses never mean rejected/not connected.
  if (connected === null) return null;
  if (connected) return "pathA";
  return now.getTime() >= sentAt.getTime() + timeoutDays * 86400_000 ? "pathB" : null;
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
