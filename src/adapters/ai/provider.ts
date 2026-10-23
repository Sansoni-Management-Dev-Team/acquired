import { OpenAiStructuredProvider } from "./openai-provider";
import type { AiProvider } from "./types";
import { OpenRouterAiProvider } from "./openrouter";
import { FreeOpenRouterAiProvider } from "./free-provider";

export type AiProviderName = "openrouter" | "openrouter-free" | "openai";

export function createAiProvider(name = process.env.AI_PROVIDER): AiProvider {
  if (name === "openai") return new OpenAiStructuredProvider();
  if (name === "openrouter") return new OpenRouterAiProvider();
  if (name === "openrouter-free") return new FreeOpenRouterAiProvider();
  throw new Error('AI_PROVIDER must be explicitly set to "openai", "openrouter" or "openrouter-free"');
}
