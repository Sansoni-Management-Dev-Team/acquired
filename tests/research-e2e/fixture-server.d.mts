export const COMPANIES: string[];
export function fixtureHtml(slug: string): string;
export function fixtureSearchHtml(query?: string): string;
export function fixtureCompletion(input: {
 messages?: { content?: unknown }[];
 response_format?: { json_schema?: unknown };
 models?: string[];
}): { model: string; choices: { finish_reason: string; message: { content: string } }[]; usage: { prompt_tokens: number; completion_tokens: number; cost: number } };
export function safeEvent(input: unknown): Record<string, unknown>;
export function startFixtureServer(options?: { port?: number; host?: string }): Promise<{ origin: string; close: () => Promise<void> }>;
