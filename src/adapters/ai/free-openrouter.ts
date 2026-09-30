import { providerJsonRequest } from "../observability/provider-request";
import { ResearchAiError } from "../../domain/research-ai-error";
import { z } from "zod";

// Explicit free candidates, never openrouter/auto. Update only
// after testing the new candidate against the research extraction cases.
export const FREE_RESEARCH_MODELS = [
  "nex-agi/nex-n2.5-pro:free",
  "nex-agi/nex-n2.5-mini:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
] as const;

export const FREE_MANDATE_MODELS = ["dots-studio/dots-3-note-preview:free", "nex-agi/nex-n2.5-mini:free", "qwen/qwen3.8-27b:free"] as const;
const supportsDisabledReasoning = (model: string) => model.startsWith("nex-agi/") || model.startsWith("qwen/") || model === "dots-studio/dots-3-note-preview:free";

export const MERCURY_FALLBACK_MODEL = "inception/mercury-2.5";
// USD per million tokens. Fail closed if current promotional pricing increases.
export const MERCURY_PRICE_CAP = { prompt: 0.04, completion: 0.15 };
class FallbackEligibleError extends ResearchAiError {}

export type FreeResearchRequest = {
  messages: { role: string; content: string }[];
  operation?: "business_extraction" | "people_extraction" | "headcount_extraction" | "followup_planning" | "outreach_drafting" | "mandate_generation";
  max_tokens: number;
  temperature?: number;
  reasoning_effort?: "medium" | "none";
  response_format: { type: string; json_schema: Record<string, unknown> };
};

export type FreeResearchUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
  elapsedMs: number;
  paidFallback?: boolean;
  route?: "free" | "paid-fallback" | "fast-paid";
};

/** Shared by Node test harnesses and Workers: no process globals or AI binding. */
export class FreeOpenRouter {
  private readonly models: string[];
  constructor(privateOptions: {
    apiKey: string;
    models?: readonly string[];
    fetch?: typeof globalThis.fetch;
    onRequest?: () => void;
    onUsage?: (usage: FreeResearchUsage) => void;
    jobId?: string;
    verbose?: boolean;
    paidFallback?: boolean;
    /** Explicit opt-in; preserves approved model allowlist and price ceiling. */
    primaryRoute?: "free" | "fast-paid";
    freeAttemptTimeoutMs?: number;
    extractionReasoning?: "medium" | "none";
    /** Free-only mode: try models separately within 45 seconds; never use paid fallback. */
    sequentialFreeFallback?: boolean;
  }) {
    this.options = privateOptions;
    this.models = [...new Set(privateOptions.models ?? FREE_RESEARCH_MODELS)];
    if (!this.models.length || this.models.length > 3 || this.models.some(m => ![...FREE_RESEARCH_MODELS, ...FREE_MANDATE_MODELS].some(allowed => allowed === m))) {
      throw new ResearchAiError("Research requires one to three approved free OpenRouter models");
    }
  }
  private readonly options;

  async complete(input: FreeResearchRequest): Promise<{ response: unknown }> {
    const deadline = Date.now() + 45000;
    const boundedExtraction = input.operation && ["business_extraction", "people_extraction", "headcount_extraction"].includes(input.operation);
    if (boundedExtraction && this.options.extractionReasoning) input = { ...input, reasoning_effort: this.options.extractionReasoning };
    if (this.options.primaryRoute === "fast-paid") {
      if (this.options.paidFallback === false || this.options.sequentialFreeFallback) throw new ResearchAiError("Fast paid routing conflicts with free-only mode");
      console.info("research-provider", JSON.stringify({ timestamp: new Date().toISOString(), provider: "openrouter", operation: input.operation || "structured_completion", jobId: this.options.jobId, event: "fast_primary_started", model: MERCURY_FALLBACK_MODEL, priceCapPerMillion: MERCURY_PRICE_CAP }));
      return this.attempt(input, true, deadline);
    }
    if (this.options.sequentialFreeFallback) {
      const models = input.reasoning_effort === "none" ? this.models.filter(supportsDisabledReasoning) : this.models;
      if (!models.length) throw new ResearchAiError("No approved free model supports the requested reasoning mode");
      for (const [index, model] of models.entries()) {
        const remainingModels = models.length - index;
        const attemptDeadline = Date.now() + Math.floor((deadline - Date.now()) / remainingModels);
        try { return await this.attempt(input, false, attemptDeadline, [model]); }
        catch (error) {
          if (!(error instanceof FallbackEligibleError) || remainingModels === 1 || Date.now() >= deadline - 1000) throw error;
        }
      }
    }
    try { return await this.attempt(input, false, deadline); }
    catch (error) {
      if (this.options.paidFallback === false || !(error instanceof FallbackEligibleError) || Date.now() >= deadline - 1000) throw error;
      console.info("research-provider", JSON.stringify({ timestamp: new Date().toISOString(), provider: "openrouter", operation: input.operation || "structured_completion", jobId: this.options.jobId, event: "paid_fallback_started", model: MERCURY_FALLBACK_MODEL, priceCapPerMillion: MERCURY_PRICE_CAP }));
      return this.attempt(input, true, deadline);
    }
  }

  private async attempt(input: FreeResearchRequest, paid: boolean, deadline: number, freeModels = this.models): Promise<{ response: unknown }> {
    if (!this.options.apiKey) throw new ResearchAiError("Research AI unavailable: OPENROUTER_API_KEY is not configured");
    const validator = z.fromJSONSchema(input.response_format.json_schema);
    // NEX and Dots support disabling reasoning; Nemotron does not.
    const models = paid ? [MERCURY_FALLBACK_MODEL] : input.reasoning_effort === "none" ? freeModels.filter(supportsDisabledReasoning) : freeModels;
    if (!models.length) throw new ResearchAiError("No approved free model supports the requested reasoning mode");
    const started = Date.now();
    const requestId = crypto.randomUUID();
    this.options.onRequest?.();
    let response: Response;
    let payload: {
      model?: string;
      error?: unknown;
      choices?: { finish_reason?: string; message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    try {
      const result = await providerJsonRequest<typeof payload>(this.options.fetch ?? globalThis.fetch, "https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json", "X-OpenRouter-Title": "Acquired Research" },
        // OpenRouter tries these in order on provider overload/unavailability.
        // One external request, bounded below the workflow's 60-second step.
        body: JSON.stringify({
          models,
          messages: input.messages,
          max_tokens: Math.max(input.max_tokens, 2048),
          temperature: input.temperature ?? 0,
          // Medium is supported by every candidate; NEX does not support low.
          reasoning: { effort: input.reasoning_effort ?? "medium", exclude: true },
          response_format: { type: "json_schema", json_schema: { name: "research_result", strict: true, schema: input.response_format.json_schema } },
          provider: { require_parameters: true, data_collection: "deny", max_price: paid ? MERCURY_PRICE_CAP : { prompt: 0, completion: 0 } },
        }),
        signal: AbortSignal.timeout(Math.max(1, Math.min(deadline - Date.now(), !paid && this.options.paidFallback !== false ? Math.max(1000, Math.min(25000, this.options.freeAttemptTimeoutMs || 25000)) : 45000))),
      }, { provider: "openrouter", operation: input.operation || "structured_completion", requestId, jobId: this.options.jobId, modelCandidates: models, verbose: this.options.verbose });
      response = result.response;
      payload = result.data;
    } catch {
      throw new FallbackEligibleError(`${paid ? "Mercury fallback" : "Free research AI"} unavailable: request timed out or transport failed`);
    }
    if (!response.ok) {
      // Do not log provider bodies: they can echo page content or credentials.
      const retryAfter = response.headers.get("retry-after");
      const ErrorType = [404, 408, 429].includes(response.status) || response.status >= 500 ? FallbackEligibleError : ResearchAiError;
      throw new ErrorType(`${paid ? "Mercury fallback" : "Free research AI"} unavailable (HTTP ${response.status})${retryAfter && /^\d+$/.test(retryAfter) ? `; retry after ${retryAfter} seconds` : ""}.`);
    }
    this.options.onUsage?.({ model: payload.model ?? "unknown", inputTokens: payload.usage?.prompt_tokens ?? 0, outputTokens: payload.usage?.completion_tokens ?? 0, cost: payload.usage?.cost ?? null, paidFallback: paid && this.options.primaryRoute !== "fast-paid", route: paid ? this.options.primaryRoute === "fast-paid" ? "fast-paid" : "paid-fallback" : "free", elapsedMs: Date.now() - started });
    const rejectOutput = (message: string, category: string): never => {
      console.info("research-provider", JSON.stringify({ timestamp: new Date().toISOString(), provider: "openrouter", operation: input.operation || "structured_completion", requestId, jobId: this.options.jobId, event: "response_rejected", category, elapsedMs: Date.now() - started }));
      throw new FallbackEligibleError(message);
    };
    if (payload.error && typeof payload.error === "object" && "code" in payload.error && [400, 401, 402, 403].includes(Number(payload.error.code))) throw new ResearchAiError("Research AI rejected the request or account credentials");
    const choice = payload.choices?.[0];
    if (payload.error || !choice?.message?.content || choice.finish_reason === "length") return rejectOutput(choice?.finish_reason === "length" ? "Free research AI reached its output token limit" : "Free research AI returned an incomplete response", choice?.finish_reason === "length" ? "output_token_limit" : "incomplete_response");
    let parsed: unknown;
    try { parsed = JSON.parse(choice.message.content); } catch { return rejectOutput("Free research AI returned invalid JSON", "invalid_output_json"); }
    const result = validator.safeParse(parsed);
    if (!result.success) return rejectOutput("Free research AI response did not match the research schema", "schema_validation");
    return { response: result.data };
  }
}
