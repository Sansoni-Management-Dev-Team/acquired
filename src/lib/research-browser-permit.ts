import { consumeResearchProvider, reserveResearchProvider } from './research-provider-queue';

// Short synchronous callers and durably waiting Workflows share one browser
// queue. A reservation is single-use and bound to its authenticated job.
export async function researchBrowserPermit(jobId: string, token?: string) {
  if (token && await consumeResearchProvider(jobId, token)) return { granted: true, retryAfterMs: 0 };
  return reserveResearchProvider(jobId, crypto.randomUUID(), 'search', 22000);
}
