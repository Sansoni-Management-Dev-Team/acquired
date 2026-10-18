import { FreeOpenRouter } from './free-openrouter';
import { OpenAiResearch } from './openai';
export type ResearchAiEnvironment = {
  RESEARCH_AI_PROVIDER?: string; OPENAI_API_KEY?: string; OPENROUTER_API_KEY?: string;
  OPENAI_RESEARCH_MODEL?: string; OPENAI_RESEARCH_FALLBACK_MODEL?: string;
};
type Options = Omit<ConstructorParameters<typeof FreeOpenRouter>[0], 'apiKey'>;
/** Provider choice is server configuration, never a conversation-supplied field. */
export function createResearchAi(env: ResearchAiEnvironment, options: Options = {}) {
  if (env.RESEARCH_AI_PROVIDER === 'openai') return new OpenAiResearch({ ...options, apiKey: env.OPENAI_API_KEY || '', model: env.OPENAI_RESEARCH_MODEL, fallbackModel: env.OPENAI_RESEARCH_FALLBACK_MODEL });
  if (env.RESEARCH_AI_PROVIDER && env.RESEARCH_AI_PROVIDER !== 'openrouter') throw new Error('Unsupported research AI provider');
  return new FreeOpenRouter({ ...options, apiKey: env.OPENROUTER_API_KEY || '' });
}
/** Node-only entry point; Worker callers pass their own bindings to createResearchAi. */
export function configuredResearchAi(options: Options = {}) {
  return createResearchAi({
    RESEARCH_AI_PROVIDER: process.env.RESEARCH_AI_PROVIDER, OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, OPENAI_RESEARCH_MODEL: process.env.OPENAI_RESEARCH_MODEL,
    OPENAI_RESEARCH_FALLBACK_MODEL: process.env.OPENAI_RESEARCH_FALLBACK_MODEL,
  }, options);
}
