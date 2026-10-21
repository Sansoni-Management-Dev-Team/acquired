const categories = ['reader_busy', 'domain_backoff', 'origin_rate_limit', 'origin_http_error', 'page_unavailable', 'reader_timeout', 'reader_failure', 'unsupported_public_url', 'dns_resolution_failed', 'browser_admission', 'native_budget_admission_required', 'native_provider_reconciliation_required', 'native_budget_not_configured', 'native_search_upstream_not_allowed', 'daily_quota', 'request_rate', 'concurrency', 'upstream_capacity', 'credits', 'authentication_or_policy', 'rate_limit_unspecified', 'provider_error', 'timeout', 'transport', 'unsupported_search', 'invalid_search_results'] as const;
export class ResearchProviderError extends Error {
  readonly category: string;
  constructor(category: string, public readonly status = 502) {
    const safe = categories.includes(category as typeof categories[number]) ? category : 'provider_error';
    super(`Research provider unavailable (${safe}, HTTP ${status})`);
    this.category = safe;
  }
}
// Admission contention is deferred work, distinct from a provider HTTP 429.
export class BrowserAdmissionDeferred extends ResearchProviderError {
  constructor(reason?: string) { super('browser_admission', 503); if (reason) this.message = reason; }
}
/** Shared Retry-After interpretation; an absent header is not permission to burst. */
export function providerRetryDelay(value: string | null, now = Date.now()) {
  const seconds = value && /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : value ? Date.parse(value) - now : NaN;
  return Math.max(1000, Number.isFinite(delay) ? delay : 30_000);
}
export class FirmableCooldown extends ResearchProviderError {
  constructor(public readonly retryAfterMs: number) { super('rate_limit_unspecified', 429); }
}
export function providerFailure(error: unknown) {
  if(error instanceof ResearchProviderError)return error;
  // Preserve allowlisted admission failures from the existing service boundary;
  // these never imply an upstream network attempt or permission to retry it.
  if(error instanceof Error&&'category'in error&&'status'in error&&typeof error.category==='string'&&categories.includes(error.category as typeof categories[number])&&typeof error.status==='number'&&Number.isInteger(error.status)&&error.status>=400&&error.status<=599)return new ResearchProviderError(error.category,error.status);
  return new ResearchProviderError(error instanceof Error && /Timeout|Abort/.test(error.name) ? 'timeout' : 'transport');
}
