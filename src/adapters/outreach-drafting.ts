import { z } from "zod";
import { createAiProvider } from "./ai/provider";
import type { AiProvider } from "./ai/types";
import { publicBuyerProfile, type BuyerProfile } from "@/domain/buyer-profile";
import type { DraftMessage } from "@/domain/outreach";
import { scheduleSequence } from "@/domain/outreach";
import type { Signal } from "@/domain/models";

export type OutreachDraftingRequest = {
  companyName: string;
  contactFirstName: string;
  companyDescription?: string;
  buyerProfile: BuyerProfile;
  signals: Signal[];
  start: Date;
};

export interface OutreachDraftingProvider {
  readonly mode: "fixture" | "ai";
  readonly providerName: string;
  generateSequence(request: OutreachDraftingRequest): Promise<DraftMessage[]>;
}

export class FixtureOutreachDraftingProvider implements OutreachDraftingProvider {
  readonly mode = "fixture" as const;
  readonly providerName = "fixture";

  async generateSequence(request: OutreachDraftingRequest): Promise<DraftMessage[]> {
    const evidence = request.signals.filter((signal) => signal.direction === "positive");
    if (!evidence.length) throw new Error("At least one positive evidence signal is required to draft outreach");
    const strongest = evidence[0];
    const secondary = evidence[1] || strongest;
    const { buyerProfile: buyer, companyName, contactFirstName } = request;
    const sign = (body: string) => `${body}\n\n${buyer.signature}`;
    const bodies: Array<{ body: string; signalIds: string[] }> = [
      { body: sign(`Hi ${contactFirstName}, I came across ${companyName} and noticed ${strongest.value.toLowerCase()}. ${buyer.operatingIntent} ${buyer.callToAction}`), signalIds: [strongest.id] },
      { body: sign(`Hi ${contactFirstName}, another reason ${companyName} stood out is that ${secondary.value.toLowerCase()}. ${buyer.investmentThesis}`), signalIds: [secondary.id] },
      { body: sign(`Hi ${contactFirstName}, for context, ${buyer.background} This is a principal-led search and I would keep an initial conversation private and exploratory.`), signalIds: [] },
      { body: sign(`I appreciate a transaction may not be under consideration. My intent is simply to introduce myself and understand whether a long-term conversation could ever be useful. ${buyer.callToAction}`), signalIds: [] },
      { body: sign(`One detail that kept ${companyName} on my shortlist is that ${strongest.value.toLowerCase()}. I would be happy to explain how that fits the kind of company I hope to own and operate.`), signalIds: [strongest.id] },
      { body: sign(`Hi ${contactFirstName} — ${buyer.callToAction}`), signalIds: [] },
      { body: sign(`Hi ${contactFirstName}, I will close the loop after this note. If a confidential conversation is ever useful, I would be glad to make time and will otherwise leave the door open.`), signalIds: [] },
    ];
    const schedules = scheduleSequence(request.start);
    return bodies.map((draft, index) => ({
      step: index + 1,
      subject: index ? `Re: ${companyName}` : `A confidential introduction regarding ${companyName}`,
      body: draft.body,
      signalIds: draft.signalIds,
      scheduledFor: schedules[index].scheduledFor,
      approved: false,
    }));
  }
}

const aiDraftSchema = z.object({
  drafts: z.array(z.object({
    step: z.number().int().min(1).max(7),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(2_500),
    signalIds: z.array(z.string()),
  }).strict()).length(7),
}).strict().superRefine((value, context) => {
  const steps = value.drafts.map(({ step }) => step).sort((a, b) => a - b);
  if (steps.some((step, index) => step !== index + 1)) context.addIssue({ code: "custom", message: "Draft steps must contain each step from 1 to 7 exactly once" });
});

const outreachResponseSchema = (signalIds: string[]) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    drafts: {
      type: "array",
      minItems: 7,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          step: { type: "integer", minimum: 1, maximum: 7 },
          subject: { type: "string" },
          body: { type: "string" },
          signalIds: { type: "array", items: { type: "string", enum: signalIds } },
        },
        required: ["step", "subject", "body", "signalIds"],
      },
    },
  },
  required: ["drafts"],
} as const);

const OUTREACH_SYSTEM_PROMPT = `You write respectful, principal-led acquisition outreach to Australian business owners and senior decision-makers.

Return exactly seven messages as strict JSON matching the supplied schema. The messages form one sequence: direct evidence-led opener, relevant sector observation, buyer credibility, respectful not-selling reframe, low-pressure valuation or succession conversation, short one-question nudge, and close-the-loop note.

Never invent facts, financial performance, ownership, sale intent, succession intent, customer details, tenure, personal circumstances, or urgency. Company-specific factual claims may only come from the supplied evidence signals. Attach every signal ID used by a message in signalIds. A message with no company-specific factual claim may use an empty signalIds array. Do not mention data providers, evidence IDs, scoring, enrichment, automation, or AI.

For a trade buyer, focus on evidenced operational adjacency, continuity and industry experience using only the approved buyer profile. Do not promise staff retention, funding, certifications or group backing unless explicitly supplied. For a financial buyer, use their approved investment and operating approach. Never infer seller motivation from tenure or age.

Use Australian English. Be concise, natural, private, and non-manipulative. Do not claim the sender represents a fund or broker. Do not imply the recipient is considering a sale. Vary the messages rather than repeating the opener. Do not include a signature; the application appends the exact saved signature.`;

export class AiOutreachDraftingProvider implements OutreachDraftingProvider {
  readonly mode = "ai" as const;
  providerName: string;

  constructor(private readonly ai: AiProvider) {
    this.providerName = ai.name;
    if (!ai.isConfigured()) throw new Error(`${ai.name} is not configured for outreach drafting`);
  }

  async generateSequence(request: OutreachDraftingRequest): Promise<DraftMessage[]> {
    const positiveSignals = request.signals.filter((signal) => signal.direction === "positive");
    if (!positiveSignals.length) throw new Error("At least one positive evidence signal is required to draft outreach");
    const result = await this.ai.generateStructured({
      name: "outreach_sequence",
      system: OUTREACH_SYSTEM_PROMPT,
      user: JSON.stringify({
        company: { name: request.companyName, description: request.companyDescription || null },
        recipient: { firstName: request.contactFirstName },
        buyer: publicBuyerProfile(request.buyerProfile),
        evidenceSignals: request.signals.map((signal) => ({ id: signal.id, kind: signal.kind, value: signal.value, direction: signal.direction, source: signal.provenance.source, confidence: signal.provenance.confidence })),
      }),
      schema: outreachResponseSchema(request.signals.map(signal => signal.id)),
      maxTokens: 3_000,
      temperature: 0.35,
    });
    this.providerName = `${this.ai.name}:${result.model}`;
    const parsed = aiDraftSchema.parse(result.json);
    const knownSignalIds = new Set(request.signals.map(({ id }) => id));
    for (const draft of parsed.drafts) {
      const unknown = draft.signalIds.find((id) => !knownSignalIds.has(id));
      if (unknown) throw new Error(`AI draft cited unknown evidence signal: ${unknown}`);
    }
    if (!parsed.drafts.some(({ signalIds }) => signalIds.length)) throw new Error("AI drafts did not cite any stored evidence signal");
    const schedules = scheduleSequence(request.start);
    return parsed.drafts.sort((a, b) => a.step - b.step).map((draft, index) => ({
      ...draft,
      body: `${draft.body.trim()}\n\n${request.buyerProfile.signature}`,
      scheduledFor: schedules[index].scheduledFor,
      approved: false,
    }));
  }
}

export function createOutreachDraftingProvider(mode = process.env.OUTREACH_DRAFTING_PROVIDER, ai?: AiProvider) {
  if (mode === "fixture") return new FixtureOutreachDraftingProvider();
  if (mode === "ai") return new AiOutreachDraftingProvider(ai || createAiProvider());
  throw new Error('OUTREACH_DRAFTING_PROVIDER must be explicitly set to "fixture" or "ai"');
}
