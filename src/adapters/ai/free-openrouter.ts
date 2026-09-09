import { ResearchAiError } from "../../domain/research-ai-error";
import { z } from "zod";

// Explicit candidates, never openrouter/auto or a paid fallback. Update only
// after testing the new candidate against the research extraction cases.
export const FREE_RESEARCH_MODELS = [
  "nex-agi/nex-n2.5-pro:free",
  "nex-agi/nex-n2.5-mini:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
] as const;

export type FreeResearchRequest = {
  messages: { role: string; content: string }[];
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
  }) {
    this.options = privateOptions;
    this.models = [...new Set(privateOptions.models ?? FREE_RESEARCH_MODELS)];
    if (!this.models.length || this.models.length > 3 || this.models.some(m => !FREE_RESEARCH_MODELS.some(allowed => allowed === m))) {
      throw new ResearchAiError("Research requires one to three approved free OpenRouter models");
    }
  }
  private readonly options;

  async complete(input: FreeResearchRequest): Promise<{ response: unknown }> {
    if (!this.options.apiKey) throw new ResearchAiError("Research AI unavailable: OPENROUTER_API_KEY is not configured");
    const validator = z.fromJSONSchema(input.response_format.json_schema);
    // NEX supports disabling reasoning; Nemotron's advertised efforts do not.
    const models = input.reasoning_effort === "none" ? this.models.filter(m => m.startsWith("nex-agi/")) : this.models;
    if (!models.length) throw new ResearchAiError("No approved free model supports the requested reasoning mode");
    const started = Date.now();
    this.options.onRequest?.();
    let response: Response;
    try {
      response = await (this.options.fetch ?? globalThis.fetch)("https://openrouter.ai/api/v1/chat/completions", {
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
          provider: { require_parameters: true, data_collection: "deny", max_price: { prompt: 0, completion: 0 } },
        }),
        signal: AbortSignal.timeout(45000),
      });
    } catch {
      throw new ResearchAiError("Free research AI unavailable: request timed out or transport failed");
    }
    if (!response.ok) {
      // Do not log provider bodies: they can echo page content or credentials.
      const retryAfter = response.headers.get("retry-after");
      throw new ResearchAiError(`Free research AI unavailable (HTTP ${response.status})${retryAfter && /^\d+$/.test(retryAfter) ? `; retry after ${retryAfter} seconds` : ""}. No paid or Workers AI fallback was used.`);
    }
    const payload = await response.json() as {
      model?: string;
      error?: unknown;
      choices?: { finish_reason?: string; message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    this.options.onUsage?.({ model: payload.model ?? "unknown", inputTokens: payload.usage?.prompt_tokens ?? 0, outputTokens: payload.usage?.completion_tokens ?? 0, cost: payload.usage?.cost ?? null, elapsedMs: Date.now() - started });
    const choice = payload.choices?.[0];
    if (payload.error || !choice?.message?.content || choice.finish_reason === "length") throw new ResearchAiError(choice?.finish_reason === "length" ? "Free research AI reached its output token limit" : "Free research AI returned an incomplete response");
    let parsed: unknown;
    try { parsed = JSON.parse(choice.message.content); } catch { throw new ResearchAiError("Free research AI returned invalid JSON"); }
    const result = validator.safeParse(parsed);
    if (!result.success) throw new ResearchAiError("Free research AI response did not match the research schema");
    return { response: result.data };
  }
}
