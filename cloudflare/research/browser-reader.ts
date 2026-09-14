import { providerJsonRequest, providerDiagnostics } from '../../src/adapters/observability/provider-request';
import { ResearchProviderError, providerFailure } from '../../src/domain/research-provider-error';

export type BrowserReaderEnv = { CF_ACCOUNT_ID?: string; CF_BROWSER_TOKEN?: string };
export async function browserMarkdown(env: BrowserReaderEnv, url: string, options: {
  jobId?: string; requestId?: string; operation: string;
  permit(): Promise<{ granted: boolean; retryAfterMs: number }>;
  onRequest?(): void;
}, fetcher: typeof fetch = fetch) {
  // Rate admission occurs before every attempt, across all app jobs. Keep a
  // single call below the app callback deadline; retries happen in the workflow.
  for (let attempt = 0; attempt < 2; attempt++) {
    options.onRequest?.();
    const permit = await options.permit();
    if (permit.granted) break;
    if (attempt === 1) throw new ResearchProviderError('request_rate', 429);
    await new Promise(resolve => setTimeout(resolve, Math.min(11000, permit.retryAfterMs)));
  }
  options.onRequest?.();
  try {
    const { response, data } = await providerJsonRequest<{ success?: boolean; result?: unknown }>(fetcher,
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/markdown`, {
        method: 'POST', headers: { authorization: `Bearer ${env.CF_BROWSER_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, gotoOptions: { waitUntil: 'domcontentloaded', timeout: 20000 } }),
        signal: AbortSignal.timeout(25000),
      }, { provider: 'cloudflare-browser', operation: options.operation, jobId: options.jobId, requestId: options.requestId });
    if (!response.ok || !data.success) throw new ResearchProviderError(providerDiagnostics(response.status, response.headers, data).category, response.status);
    if (typeof data.result !== 'string') throw new ResearchProviderError('provider_error');
    return data.result;
  } catch (error) { throw providerFailure(error); }
}
