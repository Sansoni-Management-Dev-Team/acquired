import { providerJsonRequest } from "../observability/provider-request";
import { ResearchAiError } from "../../domain/research-ai-error";

// Cheap paid fallback used only after every approved free OpenRouter model fails.
export const OPENAI_FALLBACK_MODEL = "gpt-6-luna";

export type OpenAiJsonRequest = {
  operation: string;
  messages: { role: string; content: string }[];
  json_schema: Record<string, unknown>;
  max_tokens: number;
  timeoutMs?: number;
};

/** One structured-output request to OpenAI; the caller validates the parsed JSON. */
export async function completeOpenAiJson(input: OpenAiJsonRequest, options: { apiKey?: string; model?: string; fetch?: typeof globalThis.fetch } = {}): Promise<{ response: unknown; model: string }> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) throw new ResearchAiError("OpenAI fallback unavailable: OPENAI_API_KEY is not configured");
  const model = options.model ?? process.env.OPENAI_MANDATE_MODEL ?? OPENAI_FALLBACK_MODEL;
  const requestId = crypto.randomUUID();
  let payload: { error?: unknown; choices?: { finish_reason?: string; message?: { content?: string } }[] };
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
        // Non-strict: zod length constraints are not accepted by strict mode, and the caller validates anyway.
        response_format: { type: "json_schema", json_schema: { name: "result", strict: false, schema: input.json_schema } },
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 40000),
    }, { provider: "openai", operation: input.operation, requestId, modelCandidates: [model] });
    response = result.response;
    payload = result.data;
  } catch {
    throw new ResearchAiError("OpenAI fallback unavailable: request timed out or transport failed");
  }
  // Do not log provider bodies: they can echo prompts or credentials.
  if (!response.ok || payload.error) throw new ResearchAiError(`OpenAI fallback unavailable (HTTP ${response.status}).`);
  const choice = payload.choices?.[0];
  if (!choice?.message?.content || choice.finish_reason === "length") throw new ResearchAiError("OpenAI fallback returned an incomplete response");
  try { return { response: JSON.parse(choice.message.content), model }; }
  catch { throw new ResearchAiError("OpenAI fallback returned invalid JSON"); }
}
