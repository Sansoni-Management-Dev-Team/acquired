import { providerJsonRequest, providerDiagnostics } from '../../src/adapters/observability/provider-request';
import { ResearchProviderError, providerFailure, BrowserAdmissionDeferred } from '../../src/domain/research-provider-error';
import { localReaderEndpoint, type LocalReaderEnv } from './local-reader';
import { publicResearchUrl } from '../../src/domain/research';
import { researchFetch } from './local-policy';

export type BrowserReaderEnv = LocalReaderEnv & { CF_ACCOUNT_ID?: string; CF_BROWSER_TOKEN?: string };
export async function browserMarkdown(env: BrowserReaderEnv, url: string, options: {
  jobId?: string; requestId?: string; operation: string;
  permit(): Promise<{ granted: boolean; retryAfterMs: number }>;
  onRequest?(): void;
}, fetcher: typeof fetch = fetch) {
  if (!publicResearchUrl(url)) throw new Error('Unsupported public URL');
  const local = env.LOCAL_DEVELOPMENT === 'true';
  // Resolve before admission: a bad local endpoint can never fall back to CF.
  const endpoint = local ? localReaderEndpoint(env) : `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/markdown`;
  // Rate admission occurs before every attempt, across all app jobs. Keep a
  // single call below the app callback deadline; retries happen in the workflow.
  for (let attempt = 0; attempt < 2; attempt++) {
    options.onRequest?.();
    const permit = await options.permit();
    if (permit.granted) {
      if (permit.retryAfterMs > 0) await new Promise(resolve => setTimeout(resolve, Math.min(22000, permit.retryAfterMs)));
      break;
    }
    if (attempt === 1) throw new BrowserAdmissionDeferred();
    await new Promise(resolve => setTimeout(resolve, Math.min(11000, permit.retryAfterMs)));
  }
  options.onRequest?.();
  try {
    const { response, data } = await providerJsonRequest<{ success?: boolean; result?: unknown; url?: string; markdown?: unknown }>(researchFetch(env, fetcher),
      endpoint, {
        method: 'POST', headers: { ...(!local ? { authorization: `Bearer ${env.CF_BROWSER_TOKEN}` } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, gotoOptions: { waitUntil: 'domcontentloaded', timeout: 20000 } }),
        signal: AbortSignal.timeout(25000),
      }, { provider: local ? 'local-crawl4ai' : 'cloudflare-browser', operation: options.operation, jobId: options.jobId, requestId: options.requestId });
    if (!response.ok || (!local && !data.success)) throw new ResearchProviderError(providerDiagnostics(response.status, response.headers, data).category, response.status);
    const markdown = local ? data.markdown : data.result;
    if (local && (!data.url || !publicResearchUrl(data.url))) throw new ResearchProviderError('provider_error');
    if (typeof markdown !== 'string' || !markdown.trim()) throw new ResearchProviderError('provider_error');
    return markdown;
  } catch (error) { throw providerFailure(error); }
}
