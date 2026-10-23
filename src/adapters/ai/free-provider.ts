import { FreeOpenRouter, PAID_RESEARCH_MODELS, FREE_RESEARCH_MODELS, type FreeResearchUsage } from "./free-openrouter";
import type { AiProvider, AiStructuredRequest } from "./types";
export const FREE_DRAFT_MODELS = FREE_RESEARCH_MODELS;

/** Local/server application adapter using the same free-first routing as research. */
export class FreeOpenRouterAiProvider implements AiProvider {
  readonly name = "openrouter-free";
  readonly model = [...FREE_DRAFT_MODELS, ...PAID_RESEARCH_MODELS].join(",");
  constructor(private readonly apiKey = process.env.OPENROUTER_API_KEY || "", private readonly fetcher = globalThis.fetch) {}
  isConfigured() { return Boolean(this.apiKey); }
  async generateStructured(request: AiStructuredRequest) {
    let usage: FreeResearchUsage | undefined;
    const ai = new FreeOpenRouter({ apiKey: this.apiKey, models: FREE_DRAFT_MODELS, fetch: this.fetcher, verbose: process.env.AI_VERBOSE_LOGGING === "true", onUsage: value => {
      usage = value;
      if (process.env.AI_VERBOSE_LOGGING === "true") console.info("draft-ai", JSON.stringify(value));
    } });
    const result = await ai.complete({
      operation: "outreach_drafting",
      messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
      // Drafting is bounded composition; disable reasoning and allow a full sequence.
      max_tokens: (request.maxTokens ?? 3000) + 2048, temperature: request.temperature ?? 0.35,
      reasoning_effort: "none",
      response_format: { type: "json_schema", json_schema: request.schema },
    });
    return { json: result.response, model: usage?.model ?? this.model, usage: { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 } };
  }
}
