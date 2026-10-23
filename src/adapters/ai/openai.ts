import { providerJsonRequest } from "../observability/provider-request";
import { z } from "zod";
import type { FreeResearchRequest, FreeResearchUsage } from "./free-openrouter";
import { ResearchAiError } from "../../domain/research-ai-error";

// Benchmarked default for bounded, source-grounded acquisition work.
export const OPENAI_FALLBACK_MODEL = "gpt-6-luna";

export const OPENAI_RESEARCH_FALLBACK_MODEL = "gpt-5.6-luna";
export type OpenAiUsage = { inputTokens: number; cachedInputTokens: number; cacheWriteTokens?:number; outputTokens: number; reasoningTokens: number };
class OpenAiRequestError extends ResearchAiError {
  constructor(message: string, readonly retryable: boolean) { super(message); }
}

/** Fixed response categories only; no provider body or content survives. */
export class OpenAiResponseFailure extends OpenAiRequestError{
 constructor(readonly category:'invalid_json'|'incomplete_response'|'usage_invalid'){
  super(category==='invalid_json'?'OpenAI returned invalid JSON':category==='incomplete_response'?'OpenAI returned an incomplete response':'OpenAI usage receipt is missing or inconsistent',category!=='usage_invalid');this.name='OpenAiResponseFailure';
 }
}
/** Typed positive HTTP rejection; never contains a provider message/body. */
export type OpenAiRejection={httpStatus:400|401|403|404|422;category:'invalid_request'|'authentication_or_policy'|'model_unavailable';code:'invalid_json_schema'|'invalid_api_key'|'model_not_found'|'unsupported_parameter'|'unsupported_value'|'other';parameter:'response_format'|'response_format.json_schema'|'reasoning_effort'|'model'|'max_completion_tokens'|'other'};
export class OpenAiProviderRejection extends OpenAiRequestError{
 constructor(readonly rejection:OpenAiRejection){super(`OpenAI unavailable (HTTP ${rejection.httpStatus}).`,rejection.httpStatus===404);this.name='OpenAiProviderRejection';}
}
export type OpenAiJsonRequest = {
  operation: string;
  messages: { role: string; content: string }[];
  json_schema: Record<string, unknown>;
  max_tokens: number;
  timeoutMs?: number;
  requireUsage?: boolean;
  reasoning_effort?: 'none'|'minimal';
};

/** One structured-output request to OpenAI; the caller validates the parsed JSON. */
export async function completeOpenAiJson(input: OpenAiJsonRequest, options: { apiKey?: string; model?: string; fetch?: typeof globalThis.fetch; jobId?: string; verbose?: boolean; onUsage?: (usage: OpenAiUsage, model: string) => void } = {}): Promise<{ response: unknown; model: string; usage: OpenAiUsage }> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) throw new ResearchAiError("OpenAI fallback unavailable: OPENAI_API_KEY is not configured");
  const model = options.model ?? process.env.OPENAI_MANDATE_MODEL ?? OPENAI_FALLBACK_MODEL;
  const requestId = crypto.randomUUID();
  let payload: { model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?:number }; completion_tokens_details?: { reasoning_tokens?: number } }; error?: { code?: string; type?:string; param?:string }; choices?: { finish_reason?: string; message?: { content?: string } }[] };
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
        ...(input.reasoning_effort?{reasoning_effort:input.reasoning_effort}:/^(gpt-6|gpt-5\.6|gpt-5\.4)/.test(model)?{reasoning_effort:'none'}:{}),
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
  if (!response.ok && [400,401,403,404,422].includes(response.status) && payload.error && !payload.usage && !payload.choices?.length && ['invalid_request_error','authentication_error','permission_error','not_found_error'].includes(payload.error.type??'')) {
    const codes=['invalid_json_schema','invalid_api_key','model_not_found','unsupported_parameter','unsupported_value'],parameters=['response_format','response_format.json_schema','reasoning_effort','model','max_completion_tokens'];
    throw new OpenAiProviderRejection({httpStatus:response.status as OpenAiRejection['httpStatus'],category:response.status===401||response.status===403?'authentication_or_policy':response.status===404?'model_unavailable':'invalid_request',code:(codes.includes(payload.error.code??'')?payload.error.code:'other') as OpenAiRejection['code'],parameter:(parameters.includes(payload.error.param??'')?payload.error.param:'other') as OpenAiRejection['parameter']});
  }
  if (!response.ok || payload.error) throw new OpenAiRequestError(`OpenAI unavailable (HTTP ${response.status}).`,
    payload.error?.code !== "insufficient_quota" && ([404, 408, 429].includes(response.status) || response.status >= 500));
  const actualModel = payload.model || model;
  const writes=payload.usage?.prompt_tokens_details?.cache_write_tokens;
  const usage = { ...(writes===undefined?{}:{cacheWriteTokens:writes}), inputTokens: payload.usage?.prompt_tokens ?? 0, cachedInputTokens: payload.usage?.prompt_tokens_details?.cached_tokens ?? 0, outputTokens: payload.usage?.completion_tokens ?? 0, reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0 };
  if(input.requireUsage&&(!payload.usage||!Number.isSafeInteger(usage.inputTokens)||usage.inputTokens<=0||!Number.isSafeInteger(usage.outputTokens)||usage.outputTokens<0||!Number.isSafeInteger(usage.cachedInputTokens)||usage.cachedInputTokens<0||usage.cachedInputTokens>usage.inputTokens||writes!==undefined&&(!Number.isSafeInteger(writes)||writes<0||writes+usage.cachedInputTokens>usage.inputTokens)||!Number.isSafeInteger(usage.reasoningTokens)||usage.reasoningTokens<0||usage.reasoningTokens>usage.outputTokens))throw new OpenAiResponseFailure("usage_invalid");
  options.onUsage?.(usage, actualModel);
  const choice = payload.choices?.[0];
  if (!choice?.message?.content || choice.finish_reason === "length") throw new OpenAiResponseFailure("incomplete_response");
  try { return { response: JSON.parse(choice.message.content), model: actualModel, usage }; }
  catch { throw new OpenAiResponseFailure("invalid_json"); }
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
