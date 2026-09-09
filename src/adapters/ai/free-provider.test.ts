import { afterEach, expect, it, vi } from "vitest";
import { createAiProvider } from "./provider";
import { FreeOpenRouterAiProvider, FREE_DRAFT_MODELS } from "./free-provider";
import { FREE_RESEARCH_MODELS } from "./free-openrouter";

afterEach(() => vi.unstubAllEnvs());
it("selects the free provider without inheriting the paid outreach fallback", () => {
  vi.stubEnv("AI_PROVIDER", "openrouter-free");
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("OUTREACH_AI_MODELS", "paid/model");
  const ai = createAiProvider();
  expect(ai).toBeInstanceOf(FreeOpenRouterAiProvider);
  expect(ai.isConfigured()).toBe(true);
  expect(ai.model).toBe(FREE_DRAFT_MODELS.join(","));
});
it("returns the neutral app response with validated content and model usage", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ model: FREE_RESEARCH_MODELS[1], choices: [{ message: { content: '{"draft":"Example draft"}' } }], usage: { prompt_tokens: 20, completion_tokens: 10, cost: 0 } }));
  const ai = new FreeOpenRouterAiProvider("test-key", fetcher);
  expect(await ai.generateStructured({ name: "draft", system: "Draft using supplied facts", user: "Example", maxTokens: 3500, schema: { type: "object", properties: { draft: { type: "string" } }, required: ["draft"], additionalProperties: false } })).toEqual({ json: { draft: "Example draft" }, model: FREE_RESEARCH_MODELS[1], usage: { inputTokens: 20, outputTokens: 10 } });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ models: [...FREE_DRAFT_MODELS], max_tokens: 5548, reasoning: { effort: "none" } });
});
