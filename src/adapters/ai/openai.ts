import { providerJsonRequest } from "../observability/provider-request";
import { z } from "zod";
import type { FreeResearchRequest, FreeResearchUsage } from "./free-openrouter";
import { ResearchAiError } from "../../domain/research-ai-error";

// Benchmarked default for bounded, source-grounded acquisition work.
export const OPENAI_FALLBACK_MODEL = "gpt-6-luna";

export const OPENAI_RESEARCH_FALLBACK_MODEL = "gpt-5.6-luna";
export type OpenAiUsage = { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number };
class OpenAiRequestError extends ResearchAiError {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

export type OpenAiJsonRequest = {
  operation: string;
  messages: { role: string; content: string }[];
  json_schema: Record<string, unknown>;
  max_tokens: number;
  timeoutMs?: number;
};

/** One structured-output request to OpenAI; the caller validates the parsed JSON. */
export async function completeOpenAiJson(input: OpenAiJsonRequest, options: { apiKey?: string; model?: string; fetch?: typeof globalThis.fetch; jobId?: string; verbose?: boolean; onUsage?: (usage: OpenAiUsage, model: string) => void } = {}): Promise<{ response: unknown; model: string; usage: OpenAiUsage }> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) throw new ResearchAiError("OpenAI fallback unavailable: OPENAI_API_KEY is not configured");
  const model = options.model ?? process.env.OPENAI_MANDATE_MODEL ?? OPENAI_FALLBACK_MODEL;
  const requestId = crypto.randomUUID();
  let payload: { model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } }; error?: { code?: string }; choices?: { finish_reason?: string; message?: { content?: string } }[] };
  let response: Response;
  try {
    const result = await providerJsonRequest<typeof payload>(options.fetch ?? globalThis.fetch, "https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: input.messages,
        // Luna models reject any temperature other than the default, so none is sent; variety comes from the seed in the prompt.
        max_completion_tokens: input.max_tokens,
        ...(/^(gpt-6|gpt-5\.6|gpt-5\.4)/.test(model) ? { reasoning_effort: "none" } : {}),
        // Non-strict: zod length constraints are not accepted by strict mode, and the caller validates anyway.
        response_format: { type: "json_schema", json_schema: { name: "result", strict: false, schema: input.json_schema } },
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 40000),
    }, { provider: "openai", operation: input.operation, requestId, jobId: options.jobId, verbose: options.verbose, modelCandidates: [model] });
    response = result.response;
    payload = result.data;
  } catch {
    throw new OpenAiRequestError("OpenAI request timed out or transport failed", true);
  }
  // Do not log provider bodies: they can echo prompts or credentials.
  if (!response.ok || payload.error) throw new OpenAiRequestError(`OpenAI unavailable (HTTP ${response.status}).`,
    payload.error?.code !== "insufficient_quota" && ([404, 408, 429].includes(response.status) || response.status >= 500));
  const actualModel = payload.model || model;
  const usage = { inputTokens: payload.usage?.prompt_tokens ?? 0, cachedInputTokens: payload.usage?.prompt_tokens_details?.cached_tokens ?? 0, outputTokens: payload.usage?.completion_tokens ?? 0, reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0 };
  options.onUsage?.(usage, actualModel);
  const choice = payload.choices?.[0];
  if (!choice?.message?.content || choice.finish_reason === "length") throw new OpenAiRequestError("OpenAI returned an incomplete response", true);
  try { return { response: JSON.parse(choice.message.content), model: actualModel, usage }; }
  catch { throw new OpenAiRequestError("OpenAI returned invalid JSON", true); }
}

/** Same structured completion contract as the research Worker, without OpenRouter. */
export class OpenAiResearch {
  constructor(private readonly options: { apiKey: string; model?: string; fallbackModel?: string; fetch?: typeof globalThis.fetch; onRequest?: () => void; onUsage?: (usage: FreeResearchUsage) => void; jobId?: string; verbose?: boolean }) {}
  async complete(input: FreeResearchRequest): Promise<{ response: unknown }> {
    const deadline = Date.now() + 45000;
    const models = [...new Set([this.options.model || OPENAI_FALLBACK_MODEL, this.options.fallbackModel || OPENAI_RESEARCH_FALLBACK_MODEL])];
    const validator = z.fromJSONSchema(input.response_format.json_schema);
    let last: unknown = new ResearchAiError("OpenAI request deadline elapsed");
    for (const [index, model] of models.entries()) {
      const started = Date.now();
      if (Date.now() >= deadline - 1000) break;
      this.options.onRequest?.();
      try {
        const result = await completeOpenAiJson({ operation: input.operation || "structured_completion", messages: input.messages, json_schema: input.response_format.json_schema, max_tokens: input.max_tokens, timeoutMs: Math.min(30000, deadline - Date.now()) }, {
          ...this.options, model, onUsage: (usage, actualModel) => {
            // Standard short-context rates; billed completion tokens include reasoning.
            const rates = actualModel.startsWith("gpt-6-luna") ? [0.1, 0.01, 0.5] : actualModel.startsWith("gpt-5.6-luna") ? [0.2, 0.02, 1.2] : undefined;
            const long = usage.inputTokens > 272000;
            const cost = rates ? ((usage.inputTokens - usage.cachedInputTokens) * rates[0] * (long ? 2 : 1) + usage.cachedInputTokens * rates[1] * (long ? 2 : 1) + usage.outputTokens * rates[2] * (long ? 1.5 : 1)) / 1000000 : null;
            this.options.onUsage?.({ ...usage, model: actualModel, cost, elapsedMs: Date.now() - started, paidFallback: index > 0, route: index > 0 ? "paid-fallback" : "fast-paid" });
          },
        });
        const parsed = validator.safeParse(result.response);
        if (!parsed.success) throw new OpenAiRequestError("OpenAI response did not match the research schema", true);
        return { response: parsed.data };
      } catch (error) {
        last = error;
        if (!(error instanceof OpenAiRequestError) || !error.retryable) throw error;
      }
    }
    throw last;
  }
}
