import { providerJsonRequest, providerDiagnostics } from '../../src/adapters/observability/provider-request';
import { ResearchProviderError, providerFailure, BrowserAdmissionDeferred } from '../../src/domain/research-provider-error';
import { localReaderEndpoint, type LocalReaderEnv } from './local-reader';
import { publicResearchUrl } from '../../src/domain/research';
import { pdfMarkdown, type ResearchPdfConverter } from './pdf-reader';
import { researchFetch } from './local-policy';

// Claims retry for up to 20 seconds (at most six attempts) inside one admitted request.
export const ADMISSION_WINDOW_MS = 20000;
export const MAX_ADMISSION_ATTEMPTS = 6;
export type BrowserReaderEnv = LocalReaderEnv & { CF_ACCOUNT_ID?: string; CF_BROWSER_TOKEN?: string; AI?: ResearchPdfConverter };
export async function browserMarkdown(env: BrowserReaderEnv, url: string, options: {
  jobId?: string; requestId?: string; operation: string;
  permit(): Promise<{ granted: boolean; retryAfterMs: number; expired?: boolean }>;
  onRequest?(): void;
  cooldown?(retryAfterMs: number, domain?: string): Promise<unknown>;
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
  // Rate admission occurs before every attempt, across all app jobs. A granted
  // reservation stays valid for 90 seconds, so claims retry within a bounded
  // window (below the app callback deadline) rather than a fixed two attempts:
  // concurrent searches on the shared host push each other's start back.
  const admissionDeadline = started + ADMISSION_WINDOW_MS;
  for (let attempt = 0; ; attempt++) {
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
    const delay = Math.min(11000, Math.max(250, permit.retryAfterMs));
    if (permit.expired || attempt + 1 >= MAX_ADMISSION_ATTEMPTS || Date.now() + delay > admissionDeadline) {
      admissionLog('admission_deferred', { reason: permit.expired ? 'reservation_expired' : 'permit_attempts_exhausted', upstreamRequestSent: false });
      throw new BrowserAdmissionDeferred();
    }
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  options.onRequest?.();
  try {
    if (!local && /\.pdf$/i.test(new URL(url).pathname)) return await pdfMarkdown(env.AI, url, researchFetch(env, fetcher));
    const { response, data } = await providerJsonRequest<{ success?: boolean; result?: unknown; url?: string; markdown?: unknown }>(researchFetch(env, fetcher),
      endpoint, {
        method: 'POST', headers: { ...(!local ? { authorization: `Bearer ${env.CF_BROWSER_TOKEN}` } : { 'x-request-id': requestId, ...(options.jobId ? { 'x-research-job-id': options.jobId } : {}) }), 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, gotoOptions: { waitUntil: 'domcontentloaded', timeout: 20000 } }),
        signal: AbortSignal.timeout(25000),
      }, { provider: local ? 'local-crawl4ai' : 'cloudflare-browser', operation: options.operation, jobId: options.jobId, requestId });
    const diagnostics = providerDiagnostics(response.status, response.headers, data, local ? 'local-crawl4ai' : 'cloudflare-browser');
    if (response.status === 429 && options.cooldown && diagnostics.category !== "daily_quota") {
      const header = response.headers.get('retry-after');
      const seconds = header ? Number(header) : NaN;
      const retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : header && Number.isFinite(Date.parse(header)) ? Date.parse(header) - Date.now() : 30000;
      const domain = ['domain_backoff', 'origin_rate_limit'].includes(diagnostics.category) ? new URL(url).hostname.toLowerCase().replace(/^www\./, '') : undefined;
      admissionLog('reader_deferred', { failureOrigin: 'upstream_response', category: diagnostics.category, retryAfterMs: Math.max(1000, retryAfterMs), cooldownScope: domain ? 'website' : 'shared_browser_queue', ...('reader' in diagnostics ? { reader: diagnostics.reader } : {}) });
      await options.cooldown(Math.max(1000, retryAfterMs), ...(domain ? [domain] : []));
      throw new BrowserAdmissionDeferred('Browser rate limited; queued for retry');
    }
    if (!response.ok || (!local && !data.success)) throw new ResearchProviderError(diagnostics.category, response.status);
    const markdown = local ? data.markdown : data.result;
    if (local && (!data.url || !publicResearchUrl(data.url))) throw new ResearchProviderError('provider_error');
    if (typeof markdown !== 'string' || !markdown.trim()) throw new ResearchProviderError('provider_error');
    return markdown;
  } catch (error) { throw providerFailure(error); }
  finally { await options.release?.().catch(() => {}); }
}
