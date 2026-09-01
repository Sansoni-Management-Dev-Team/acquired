import type { AiProvider } from "./types";
import { OpenRouterAiProvider } from "./openrouter";

export type AiProviderName = "openrouter";

export function createAiProvider(name = process.env.AI_PROVIDER): AiProvider {
  if (name === "openrouter") return new OpenRouterAiProvider();
  throw new Error('AI_PROVIDER must be explicitly set to "openrouter"');
}
