import type { Signal } from "./models";

export type SequenceStep = { step: number; businessDay: number; purpose: string };
export const DEFAULT_SEQUENCE: SequenceStep[] = [
  { step: 1, businessDay: 0, purpose: "Direct, evidence-led opener" },
  { step: 2, businessDay: 3, purpose: "Relevant sector insight" },
  { step: 3, businessDay: 7, purpose: "Buyer credibility" },
  { step: 4, businessDay: 12, purpose: "Not-selling objection reframe" },
  { step: 5, businessDay: 18, purpose: "Indicative valuation conversation" },
  { step: 6, businessDay: 25, purpose: "Short one-question nudge" },
  { step: 7, businessDay: 35, purpose: "Close the loop" },
];

export const OUTREACH_CHANNELS = ["email", "linkedin", "whatsapp"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];
export type OutreachChannelCopy = { subject?: string; body: string };
export type OutreachChannelCopies = Record<OutreachChannel, OutreachChannelCopy>;
export type DraftMessage = { step: number; subject: string; body: string; channels: OutreachChannelCopies; signalIds: string[]; scheduledFor: Date; approved: boolean };
export type StoredOutreachMetadata = { signalIds: string[]; channels: Partial<Pick<OutreachChannelCopies, "linkedin" | "whatsapp">> };
export type SendContext = { approved: boolean; suppressed: boolean; replied: boolean; stopped: boolean; sentToday: number; dailyCap: number };

export function readOutreachMetadata(value: unknown): StoredOutreachMetadata {
  if (Array.isArray(value)) return { signalIds: value.filter((id): id is string => typeof id === "string"), channels: {} };
  if (!value || typeof value !== "object") return { signalIds: [], channels: {} };
  const stored = value as Record<string, unknown>;
  const channelValue = stored.channels && typeof stored.channels === "object" ? stored.channels as Record<string, unknown> : {};
  const readChannel = (channel: "linkedin" | "whatsapp") => {
    const copy = channelValue[channel];
    if (!copy || typeof copy !== "object" || typeof (copy as Record<string, unknown>).body !== "string") return undefined;
    return { body: (copy as Record<string, unknown>).body as string };
  };
  return {
    signalIds: Array.isArray(stored.signalIds) ? stored.signalIds.filter((id): id is string => typeof id === "string") : [],
    channels: { linkedin: readChannel("linkedin"), whatsapp: readChannel("whatsapp") },
  };
}

export function writeOutreachMetadata(signalIds: string[], channels: Partial<Pick<OutreachChannelCopies, "linkedin" | "whatsapp">>) {
  return { signalIds, channels };
}

export function addBusinessDays(date: Date, count: number) {
  const output = new Date(date);
  let remaining = count;
  while (remaining > 0) {
    output.setUTCDate(output.getUTCDate() + 1);
    if (output.getUTCDay() !== 0 && output.getUTCDay() !== 6) remaining--;
  }
  return output;
}

export function scheduleSequence(start: Date, jitterMinutes: (step: number) => number = () => 0) {
  return DEFAULT_SEQUENCE.map((step) => {
    const scheduledFor = addBusinessDays(start, step.businessDay);
    scheduledFor.setUTCMinutes(scheduledFor.getUTCMinutes() + jitterMinutes(step.step));
    return { ...step, scheduledFor };
  });
}

export function assertMaySend(context: SendContext) {
  if (!context.approved) throw new Error("Message requires human approval");
  if (context.suppressed) throw new Error("Recipient is suppressed");
  if (context.replied) throw new Error("Sequence stopped after reply");
  if (context.stopped) throw new Error("Sequence is stopped");
  if (context.sentToday >= context.dailyCap) throw new Error("Daily send cap reached");
}

export function draftSequence(companyName: string, firstName: string, signals: Signal[], start: Date): DraftMessage[] {
  const strongest = signals.find((signal) => signal.direction === "positive");
  const evidence = strongest?.value.toLowerCase();
  const bodies = [
    `Hi ${firstName}, I came across ${companyName}${evidence ? ` and noticed ${evidence}` : " and wanted to introduce myself"}. I am looking to acquire and operate one Australian business for the long term. Would a discreet 15-minute conversation be unreasonable?`,
    `Hi ${firstName}, ${evidence ? `one reason ${companyName} stood out is ${evidence}` : `${companyName} appears relevant to the kind of business I hope to own and operate`}. I would be glad to share the perspective behind my interest.`,
    `Hi ${firstName}, for context, this is a principal-led search rather than a broker campaign. We can move carefully, protect confidentiality and keep the initial conversation exploratory.`,
    `I appreciate you may not be considering a sale. Many useful first conversations are simply about succession options and what a good outcome could look like over time.`,
    `If useful, I can outline how buyers typically think about an indicative valuation range for a business like ${companyName}, without obligation or a formal process.`,
    `Hi ${firstName} — is a brief, confidential introduction worth arranging?`,
    `Hi ${firstName}, I will close the loop after this note. If succession ever becomes relevant, I would welcome a conversation and will leave the door open.`,
  ];
  const schedules = scheduleSequence(start);
  return bodies.map((body, index) => {
    const subject = index ? `Re: ${companyName}` : `A confidential conversation about ${companyName}`;
    const linkedin = index === 0
      ? `Hi ${firstName}, I came across ${companyName} and wanted to introduce myself. I am looking to acquire and operate one Australian business for the long term. Open to a brief, private chat?`
      : `Hi ${firstName}, just following up on my note about ${companyName}. I would be glad to share why the business stood out and keep the conversation exploratory.`;
    const whatsapp = index === 0
      ? `Hi ${firstName}, it’s a private note about ${companyName}. I’m looking to acquire and operate one Australian business for the long term. Would a quick introductory call be okay?`
      : `Hi ${firstName}, just a quick follow-up about ${companyName}. Would a short, private introduction be useful?`;
    return { step: index + 1, subject, body, channels: { email: { subject, body }, linkedin: { body: linkedin }, whatsapp: { body: whatsapp } }, signalIds: strongest ? [strongest.id] : [], scheduledFor: schedules[index].scheduledFor, approved: false };
  });
}
