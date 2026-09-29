import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { AiProvider } from "./ai/types";
import { AiOutreachDraftingProvider, createOutreachDraftingProvider, FixtureOutreachDraftingProvider } from "./outreach-drafting";

const request = {
  companyName: "Example Co", contactFirstName: "Morgan", companyDescription: "A fictional operator.", start: new Date("2026-08-31T00:00:00.000Z"),
  buyerProfile: { senderName: "Alex Buyer", background: "I have operated service businesses for fifteen years.", investmentThesis: "I am seeking one durable Victorian services company.", operatingIntent: "I intend to lead the company for the long term.", callToAction: "Would a private fifteen-minute introduction be reasonable?", signature: "Alex Buyer" },
  signals: [{ id: "signal-1", kind: "longevity", value: "Example Co has operated since 1984", weight: "low" as const, direction: "positive" as const, provenance: { source: "Firmable", capturedAt: "2026-08-31T00:00:00.000Z", confidence: 75 } }],
};
const aiDraft = (index: number, signalIds: string[] = []) => ({
  step: index + 1,
  email: { subject: index ? "Re: Example Co" : "A private introduction", body: `Hi Morgan, email ${index + 1}` },
  linkedin: { body: `Hi Morgan, LinkedIn message ${index + 1}` },
  whatsapp: { body: `Hi Morgan, WhatsApp message ${index + 1}` },
  signalIds,
});

describe("fixture outreach drafting", () => {
  it("generates seven editable drafts whose company claims cite stored evidence", async () => {
    const drafts = await new FixtureOutreachDraftingProvider().generateSequence(request);
    expect(drafts).toHaveLength(7);
    expect(drafts[0]).toMatchObject({ step: 1, signalIds: ["signal-1"], approved: false });
    expect(drafts[0].body).toContain(request.buyerProfile.background);
    expect(drafts.every((draft) => draft.body.endsWith(request.buyerProfile.signature))).toBe(true);
    expect(drafts.every((draft) => draft.channels.linkedin.body && draft.channels.whatsapp.body)).toBe(true);
  });

  it("generates editable drafts from saved company data without evidence signals", async () => {
    const drafts = await new FixtureOutreachDraftingProvider().generateSequence({
      ...request,
      signals: [],
      companyProfile: { industries: ["Industrial services"] },
    });
    expect(drafts).toHaveLength(7);
    expect(drafts.every((draft) => draft.signalIds.length === 0)).toBe(true);
    expect(drafts[0].body).toContain("researching businesses in Industrial services");
  });

  it("fails closed instead of silently selecting a live provider", () => {
    expect(() => createOutreachDraftingProvider(undefined)).toThrow(/explicitly set/);
    expect(() => createOutreachDraftingProvider("live")).toThrow(/fixture.*ai/);
  });

  it("builds seven validated drafts through a provider-neutral AI boundary", async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      json: { drafts: Array.from({ length: 7 }, (_, index) => aiDraft(index, index < 2 ? ["signal-1"] : [])) },
      model: "test/model",
      usage: { inputTokens: 100, outputTokens: 200 },
    });
    const ai: AiProvider = { name: "test-ai", model: "test/model", isConfigured: () => true, generateStructured };

    const provider = new AiOutreachDraftingProvider(ai);
    const drafts = await provider.generateSequence(request);

    expect(drafts).toHaveLength(7);
    expect(drafts[0]).toMatchObject({ step: 1, signalIds: ["signal-1"], approved: false });
    expect(drafts.every((draft) => draft.body.endsWith(request.buyerProfile.signature))).toBe(true);
    expect(drafts[0].channels).toMatchObject({ linkedin: { body: "Hi Morgan, LinkedIn message 1" }, whatsapp: { body: "Hi Morgan, WhatsApp message 1" } });
    expect(provider.providerName).toBe("test-ai:test/model");
    expect(generateStructured).toHaveBeenCalledWith(expect.objectContaining({
      name: "outreach_sequence",
      system: expect.stringContaining("Never invent"),
      user: expect.stringContaining("signal-1"),
    }));
    expect(generateStructured.mock.calls[0][0].schema.properties.drafts.items.properties.signalIds.items.enum).toEqual(["signal-1"]);
  });

  it("rejects AI drafts that cite evidence outside the stored signal set", async () => {
    const ai: AiProvider = {
      name: "test-ai",
      model: "test/model",
      isConfigured: () => true,
      generateStructured: vi.fn().mockResolvedValue({
        json: { drafts: Array.from({ length: 7 }, (_, index) => aiDraft(index, index === 0 ? ["invented"] : [])) },
        model: "test/model",
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    };

    await expect(new AiOutreachDraftingProvider(ai).generateSequence(request)).rejects.toThrow(/unknown evidence signal/);
  });

  it("allows AI drafts with no signal citations when only company profile data is available", async () => {
    const generateStructured = vi.fn().mockResolvedValue({
      json: { drafts: Array.from({ length: 7 }, (_, index) => aiDraft(index)) },
      model: "test/model",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const ai: AiProvider = { name: "test-ai", model: "test/model", isConfigured: () => true, generateStructured };
    const drafts = await new AiOutreachDraftingProvider(ai).generateSequence({ ...request, signals: [], companyProfile: { industries: ["Industrial services"] } });
    expect(drafts).toHaveLength(7);
    expect(drafts.every((draft) => draft.signalIds.length === 0)).toBe(true);
    expect(generateStructured.mock.calls[0][0].schema.properties.drafts.items.properties.signalIds).toMatchObject({ maxItems: 0 });
  });
});
