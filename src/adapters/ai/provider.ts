import type { AiProvider } from "./types";
import { OpenRouterAiProvider } from "./openrouter";
import { FreeOpenRouterAiProvider } from "./free-provider";

export type AiProviderName = "openrouter" | "openrouter-free";

export function createAiProvider(name = process.env.AI_PROVIDER): AiProvider {
  if (name === "openrouter") return new OpenRouterAiProvider();
  if (name === "openrouter-free") return new FreeOpenRouterAiProvider();
  throw new Error('AI_PROVIDER must be explicitly set to "openrouter" or "openrouter-free"');
}
