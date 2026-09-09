import { liveFetch } from "./live-inference-checks";
import { expect, it } from "vitest";
import { FreeOpenRouterAiProvider } from "./free-provider";
import { AiOutreachDraftingProvider } from "../outreach-drafting";

it.skipIf(process.env.OPENROUTER_RESEARCH_LIVE !== "1")("generates seven validated local drafts through free inference without sending", async () => {
  const provider = new AiOutreachDraftingProvider(new FreeOpenRouterAiProvider(process.env.OPENROUTER_API_KEY, liveFetch));
  const drafts = await provider.generateSequence({
    companyName: "Example Co", contactFirstName: "Morgan", companyDescription: "A fictional operator.", start: new Date("2026-09-09T00:00:00Z"),
    buyerProfile: { senderName: "Alex Example", background: "I have operated service businesses for fifteen years.", investmentThesis: "I am seeking one durable services company.", operatingIntent: "I intend to lead the company for the long term.", callToAction: "Would a private fifteen-minute introduction be reasonable?", signature: "Alex Example" },
    signals: [{ id: "example-signal", kind: "longevity", value: "Example Co has operated since 1984", weight: "low", direction: "positive", provenance: { source: "Fictional test source", capturedAt: "2026-09-09T00:00:00Z", confidence: 75 } }],
  });
  expect(drafts).toHaveLength(7);
  expect(drafts.every(d => !d.approved && d.body.endsWith("Alex Example"))).toBe(true);
  expect(provider.providerName).toContain("openrouter-free:");
}, 60000);
