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

export type DraftMessage = { step: number; subject: string; body: string; signalIds: string[]; scheduledFor: Date; approved: boolean };
export type SendContext = { approved: boolean; suppressed: boolean; replied: boolean; stopped: boolean; sentToday: number; dailyCap: number };

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
  if (!strongest) throw new Error("At least one evidence signal is required to draft outreach");
  const evidence = strongest.value.toLowerCase();
  const bodies = [
    `Hi ${firstName}, I came across ${companyName} and noticed ${evidence}. I am looking to acquire and operate one Australian business for the long term. Would a discreet 15-minute conversation be unreasonable?`,
    `Hi ${firstName}, one reason ${companyName} stood out is ${evidence}. We are seeing durable demand for well-run operators in this sector and I would be glad to share the perspective behind our interest.`,
    `Hi ${firstName}, for context, this is a principal-led search rather than a broker campaign. We can move carefully, protect confidentiality and keep the initial conversation exploratory.`,
    `I appreciate you may not be considering a sale. Many useful first conversations are simply about succession options and what a good outcome could look like over time.`,
    `If useful, I can outline how buyers typically think about an indicative valuation range for a business like ${companyName}, without obligation or a formal process.`,
    `Hi ${firstName} — is a brief, confidential introduction worth arranging?`,
    `Hi ${firstName}, I will close the loop after this note. If succession ever becomes relevant, I would welcome a conversation and will leave the door open.`,
  ];
  const schedules = scheduleSequence(start);
  return bodies.map((body, index) => ({ step: index + 1, subject: index ? `Re: ${companyName}` : `A confidential conversation about ${companyName}`, body, signalIds: [strongest.id], scheduledFor: schedules[index].scheduledFor, approved: false }));
}
