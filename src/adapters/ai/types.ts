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

/** Canonical totals: input includes cache reads/writes; output includes reasoning. */
export type AiCompletionUsage={inputTokens:number;outputTokens:number;cachedInputTokens:number;reasoningTokens?:number;cacheWriteTokens?:number;cacheWrite5mTokens?:number;cacheWrite1hTokens?:number};
export type AiCompletionRequest={operation:string;messages:{role:string;content:string}[];json_schema:Record<string,unknown>;max_tokens:number;timeoutMs?:number;signal?:AbortSignal;requireUsage?:boolean;reasoning_effort?:'none'|'minimal'};
export type AiCompletionOptions={provider?:'openai'|'anthropic';model?:string;apiKey?:string;fetch?:typeof globalThis.fetch;jobId?:string;verbose?:boolean;onUsage?:(usage:AiCompletionUsage,model:string)=>void};
export type AiCompletionResult={response:unknown;model:string;usage:AiCompletionUsage};
export type AiCompletion=(input:AiCompletionRequest,options?:AiCompletionOptions)=>Promise<AiCompletionResult>;
