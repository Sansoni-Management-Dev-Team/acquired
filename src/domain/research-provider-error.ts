const categories = ['reader_busy', 'domain_backoff', 'origin_rate_limit', 'origin_http_error', 'page_unavailable', 'reader_timeout', 'reader_failure', 'browser_admission', 'daily_quota', 'request_rate', 'concurrency', 'upstream_capacity', 'credits', 'authentication_or_policy', 'rate_limit_unspecified', 'provider_error', 'timeout', 'transport', 'unsupported_search', 'invalid_search_results'] as const;
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
export function providerFailure(error: unknown) {
  return error instanceof ResearchProviderError ? error : new ResearchProviderError(error instanceof Error && /Timeout|Abort/.test(error.name) ? 'timeout' : 'transport');
}
