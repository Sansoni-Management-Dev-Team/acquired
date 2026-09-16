import { providerJsonRequest, providerDiagnostics } from '../../src/adapters/observability/provider-request';
import { ResearchProviderError, providerFailure, BrowserAdmissionDeferred } from '../../src/domain/research-provider-error';
import { localReaderEndpoint, type LocalReaderEnv } from './local-reader';
import { publicResearchUrl } from '../../src/domain/research';
import { researchFetch } from './local-policy';

export type BrowserReaderEnv = LocalReaderEnv & { CF_ACCOUNT_ID?: string; CF_BROWSER_TOKEN?: string };
export async function browserMarkdown(env: BrowserReaderEnv, url: string, options: {
  jobId?: string; requestId?: string; operation: string;
  permit(): Promise<{ granted: boolean; retryAfterMs: number; expired?: boolean }>;
  onRequest?(): void;
  cooldown?(retryAfterMs: number): Promise<unknown>;
  release?(): Promise<unknown>;
}, fetcher: typeof fetch = fetch) {
  if (!publicResearchUrl(url)) throw new Error('Unsupported public URL');
  const local = env.LOCAL_DEVELOPMENT === 'true';
  // Resolve before admission: a bad local endpoint can never fall back to CF.
  const endpoint = local ? localReaderEndpoint(env) : `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/markdown`;
  const requestId = options.requestId || crypto.randomUUID();
  const started = Date.now();
  const admissionLog = (event: string, fields: object) => console.info('research-browser-admission', JSON.stringify({
    timestamp: new Date().toISOString(), jobId: options.jobId, requestId,
    operation: options.operation, provider: local ? 'local-crawl4ai' : 'cloudflare-browser',
    failureOrigin: 'application_admission', event, elapsedMs: Date.now() - started, ...fields,
  }));
  // Rate admission occurs before every attempt, across all app jobs. Keep a
  // single call below the app callback deadline; retries happen in the workflow.
  for (let attempt = 0; attempt < 2; attempt++) {
    options.onRequest?.();
    let permit: Awaited<ReturnType<typeof options.permit>>;
    try { permit = await options.permit(); }
    catch (error) {
      admissionLog('permit_callback_failed', { attempt: attempt + 1, category: providerFailure(error).category });
      throw new BrowserAdmissionDeferred('Browser admission callback delayed; queued for retry');
    }
    admissionLog('permit_result', { attempt: attempt + 1, granted: permit.granted, retryAfterMs: permit.retryAfterMs, expired: permit.expired === true });
    if (permit.granted) {
      if (permit.retryAfterMs > 0) await new Promise(resolve => setTimeout(resolve, Math.min(22000, permit.retryAfterMs)));
      break;
    }
    if (permit.expired || attempt === 1) {
      admissionLog('admission_deferred', { reason: permit.expired ? 'reservation_expired' : 'permit_attempts_exhausted', upstreamRequestSent: false });
      throw new BrowserAdmissionDeferred();
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(11000, permit.retryAfterMs)));
  }
  options.onRequest?.();
  try {
    const { response, data } = await providerJsonRequest<{ success?: boolean; result?: unknown; url?: string; markdown?: unknown }>(researchFetch(env, fetcher),
      endpoint, {
        method: 'POST', headers: { ...(!local ? { authorization: `Bearer ${env.CF_BROWSER_TOKEN}` } : {}), 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, gotoOptions: { waitUntil: 'domcontentloaded', timeout: 20000 } }),
        signal: AbortSignal.timeout(25000),
      }, { provider: local ? 'local-crawl4ai' : 'cloudflare-browser', operation: options.operation, jobId: options.jobId, requestId });
    if (response.status === 429 && options.cooldown && providerDiagnostics(response.status, response.headers, data).category !== "daily_quota") {
      const header = response.headers.get('retry-after');
      const seconds = header ? Number(header) : NaN;
      const retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : header && Number.isFinite(Date.parse(header)) ? Date.parse(header) - Date.now() : 30000;
      await options.cooldown(Math.max(1000, retryAfterMs));
      throw new BrowserAdmissionDeferred('Browser rate limited; queued for retry');
    }
    if (!response.ok || (!local && !data.success)) throw new ResearchProviderError(providerDiagnostics(response.status, response.headers, data).category, response.status);
    const markdown = local ? data.markdown : data.result;
    if (local && (!data.url || !publicResearchUrl(data.url))) throw new ResearchProviderError('provider_error');
    if (typeof markdown !== 'string' || !markdown.trim()) throw new ResearchProviderError('provider_error');
    return markdown;
  } catch (error) { throw providerFailure(error); }
  finally { await options.release?.().catch(() => {}); }
}
