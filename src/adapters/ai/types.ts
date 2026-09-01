export type AiUsage = { inputTokens: number; outputTokens: number };

export type AiStructuredRequest = {
  name: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
};

export type AiStructuredResponse = {
  json: unknown;
  model: string;
  usage: AiUsage;
};

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  isConfigured(): boolean;
  generateStructured(request: AiStructuredRequest): Promise<AiStructuredResponse>;
}
