import { OpenAiResearch, OPENAI_FALLBACK_MODEL } from './openai';
import type { AiProvider, AiStructuredRequest } from './types';
import type { FreeResearchUsage } from './free-openrouter';
export class OpenAiStructuredProvider implements AiProvider {
  readonly name = 'openai';
  readonly model = process.env.OPENAI_RESEARCH_MODEL || OPENAI_FALLBACK_MODEL;
  constructor(private readonly apiKey = process.env.OPENAI_API_KEY || '', private readonly fetcher = globalThis.fetch) {}
  isConfigured() { return Boolean(this.apiKey); }
  async generateStructured(request: AiStructuredRequest) {
    let usage: FreeResearchUsage | undefined;
    const ai = new OpenAiResearch({ apiKey: this.apiKey, model: this.model, fallbackModel: process.env.OPENAI_RESEARCH_FALLBACK_MODEL, fetch: this.fetcher, onUsage: value => { usage = value; } });
    const result = await ai.complete({ operation: 'outreach_drafting', messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }], max_tokens: request.maxTokens || 3000, response_format: { type: 'json_schema', json_schema: request.schema } });
    return { json: result.response, model: usage?.model || this.model, usage: { inputTokens: usage?.inputTokens || 0, outputTokens: usage?.outputTokens || 0 } };
  }
}
