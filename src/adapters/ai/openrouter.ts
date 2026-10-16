import { z } from "zod";
import type { AiProvider, AiStructuredRequest, AiStructuredResponse } from "./types";

const completionSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({ content: z.string().nullable().optional(), reasoning: z.string().nullable().optional() }).passthrough(),
  }).passthrough()).min(1),
  usage: z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    completion_tokens_details: z.object({ reasoning_tokens: z.number().optional() }).passthrough().optional(),
  }).passthrough().optional(),
}).passthrough();

const reasoningOptionalModels = new Set([
  "z-ai/glm-5.2:free",
  "dots-studio/dots-3-note-preview:free",
  "qwen/qwen3.8-flash",
]);

function aiLog(event: string, details: Record<string, unknown>) {
  if (process.env.AI_VERBOSE_LOGGING === "true") console.info(`[ai-provider] ${event}`, JSON.stringify(details));
}

export class AiProviderError extends Error {
  constructor(public provider: string, public status: number, message: string) {
    super(message);
  }
}

export type OpenRouterAiProviderOptions = {
  apiKey?: string;
  model?: string;
  models?: string[];
  baseUrl?: string;
  appUrl?: string;
  fetch?: typeof globalThis.fetch;
  fallbackDelayMs?: number;
};

export class OpenRouterAiProvider implements AiProvider {
  readonly name = "openrouter";
  readonly model: string;
  private readonly models: string[];
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly appUrl: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly fallbackDelayMs: number;

  constructor(options: OpenRouterAiProviderOptions = {}) {
    this.apiKey = options.apiKey || process.env.OPENROUTER_API_KEY || "";
    const environmentModels = (process.env.OUTREACH_AI_MODELS || "").split(",").map((model) => model.trim()).filter(Boolean);
    this.models = options.models?.filter(Boolean) || (options.model ? [options.model] : environmentModels.length ? environmentModels : process.env.OUTREACH_AI_MODEL ? [process.env.OUTREACH_AI_MODEL] : []);
    this.model = this.models[0] || "";
    this.baseUrl = options.baseUrl || process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
    this.appUrl = options.appUrl || process.env.APP_URL || "http://localhost:3000";
    this.fetcher = options.fetch || globalThis.fetch;
    this.fallbackDelayMs = options.fallbackDelayMs ?? 250;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.model);
  }

  async generateStructured(request: AiStructuredRequest): Promise<AiStructuredResponse> {
    if (!this.apiKey) throw new AiProviderError(this.name, 0, "OPENROUTER_API_KEY is not configured");
    if (!this.model) throw new AiProviderError(this.name, 0, "OUTREACH_AI_MODEL is not configured");
    const finalModel = this.models[this.models.length - 1];
    if (!finalModel) throw new AiProviderError(this.name, 0, "No OpenRouter model waterfall is configured");
    let lastError: AiProviderError | undefined;
    const attemptModels = [...this.models, finalModel];
    for (const [index, model] of attemptModels.entries()) {
      const attempt = index + 1;
      const hasFallback = attempt < attemptModels.length;
      const nextModel = attemptModels[index + 1];
      const body = JSON.stringify({
        model,
        messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
        max_tokens: request.maxTokens || 3_000,
        temperature: request.temperature ?? 0.35,
        response_format: { type: "json_schema", json_schema: { name: request.name, strict: true, schema: request.schema } },
        provider: { require_parameters: true, data_collection: "allow" },
        ...(reasoningOptionalModels.has(model) ? { reasoning: { effort: "none", exclude: true } } : {}),
      });
      aiLog("request", { provider: this.name, model, attempt, totalAttempts: attemptModels.length, responseSchema: request.name, maxTokens: request.maxTokens || 3_000, temperature: request.temperature ?? 0.35, reasoning: reasoningOptionalModels.has(model) ? "disabled" : "model_default", dataCollection: "allow" });
      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          signal: AbortSignal.timeout(45_000),
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": this.appUrl,
            "X-OpenRouter-Title": "Acquired",
          },
          body,
        });
      } catch (caught) {
        lastError = new AiProviderError(this.name, 0, caught instanceof Error ? `OpenRouter transport failed: ${caught.message}` : "OpenRouter transport failed");
        if (!hasFallback) throw lastError;
        aiLog("fallback", { provider: this.name, failedModel: model, nextModel, reason: "transport", delayMs: this.fallbackDelayMs });
        if (this.fallbackDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.fallbackDelayMs));
        continue;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: { message?: unknown } } | null;
        const detail = typeof payload?.error?.message === "string" ? `: ${payload.error.message.slice(0, 300)}` : "";
        lastError = new AiProviderError(this.name, response.status, `OpenRouter request failed (${response.status})${detail}`);
        const fallbackEligible = response.status === 404 || response.status === 429 || response.status >= 500;
        if (fallbackEligible && hasFallback) {
          aiLog("fallback", { provider: this.name, failedModel: model, nextModel, status: response.status, delayMs: this.fallbackDelayMs });
          if (this.fallbackDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.fallbackDelayMs));
          continue;
        }
        aiLog("failed", { provider: this.name, model, status: response.status, message: detail || "No provider detail" });
        throw lastError;
      }
      try {
        const completion = completionSchema.parse(await response.json());
        const choice = completion.choices[0];
        const content = choice?.message.content;
        if (!content) {
          aiLog("empty", { provider: this.name, model, attempt, finishReason: choice?.finish_reason || "unknown", outputTokens: completion.usage?.completion_tokens || 0, reasoningTokens: completion.usage?.completion_tokens_details?.reasoning_tokens || 0, hasReasoning: Boolean(choice?.message.reasoning) });
          throw new Error("OpenRouter returned no structured content");
        }
        const json: unknown = JSON.parse(content);
        const result = {
          json,
          model: completion.model || model,
          usage: { inputTokens: completion.usage?.prompt_tokens || 0, outputTokens: completion.usage?.completion_tokens || 0 },
        };
        aiLog("complete", { provider: this.name, requestedModel: model, responseModel: result.model, attempt, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
        return result;
      } catch (caught) {
        lastError = new AiProviderError(this.name, 200, caught instanceof SyntaxError ? "OpenRouter did not return valid JSON" : caught instanceof Error ? caught.message : "OpenRouter returned an invalid structured response");
        if (!hasFallback) throw lastError;
        aiLog("fallback", { provider: this.name, failedModel: model, nextModel, reason: "invalid_structured_response", delayMs: this.fallbackDelayMs });
        if (this.fallbackDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.fallbackDelayMs));
      }
    }
    throw lastError || new AiProviderError(this.name, 0, "OpenRouter request exhausted its model waterfall");
  }
}
