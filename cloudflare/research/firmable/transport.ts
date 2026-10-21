import {providerRetryDelay} from '../../../src/domain/research-provider-error';
export type RecordData = Record<string, unknown>;
export class ServiceError extends Error {
  constructor(readonly status: number, readonly category: string, readonly retryAfter = 0) { super(category); }
}
export function retryDelay(value: string | null, now = Date.now()) {
  return providerRetryDelay(value, now);
}
export async function upstream(fetcher: typeof fetch, url: string, init: RequestInit) {
  let response: Response;
  try { response = await fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) }); }
  catch (error) { if(error instanceof ServiceError)throw error;throw new ServiceError(502, 'upstream_unavailable'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ServiceError(response.status === 429 ? 429 : [401, 403, 404].includes(response.status) ? response.status : 502,
      response.status === 429 ? 'rate_limited' : [401, 403].includes(response.status) ? 'upstream_authentication' : response.status === 404 ? 'not_found' : 'upstream_error',
      response.status === 429 ? retryDelay(response.headers.get('retry-after')) : 0);
  }
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ServiceError(502, 'invalid_upstream_response');
  return { data: data as RecordData, headers: response.headers };
}
export function labels(value: unknown): unknown {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.values(value).filter(item => typeof item === 'string').join(', ') : value;
}
export function normalize(data: RecordData) {
  const output: RecordData = { ...data, browserResponse: data };
  for (const key of ['revenue', 'company_size', 'seniority', 'department']) if (key in output) output[key] = labels(output[key]);
  if (data.industries && typeof data.industries === "object" && !Array.isArray(data.industries)) output.industries = Object.values(data.industries).filter(item => typeof item === "string");
  return output;
}
export function domain(value: string) {
  try { return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}
