export function requestBudgetStop(used: number, localDevelopment: boolean) {
  // Local Workflows have no need for the deployed Worker's conservative reserve.
  // The runner still enforces the saved page, AI-call, time and cancellation limits.
  return !localDevelopment && used >= 32
    ? "Worker request budget reached; saved evidence retained. Start another research run to continue."
    : undefined;
}

export class CrawlerRequestError extends Error {
  constructor(public readonly status: number) { super(`Crawler unavailable (${status})`); }
}

export function crawlRetryUrl(records: { url: string; status: string; metadata?: { status?: number } }[]) {
  return records.find(record => record.status === "errored" && record.metadata?.status === 422)?.url;
}

export async function cancelCrawl(id: string, request: (path: string, method: string) => Promise<unknown>) {
  try { await request(`/${id}`, "DELETE"); }
  catch (error) {
    if (!(error instanceof CrawlerRequestError) || error.status !== 400) throw error;
    // A crawl can finish between the last poll and cancellation. Confirm its
    // terminal state before accepting a 400; never hide real cancellation errors.
    const state = await request(`/${id}`, "GET") as { status?: string };
    if (!["completed", "cancelled", "errored", "failed"].includes(state.status || "")) throw error;
  }
}
