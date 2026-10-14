import { BoundedUnipileHttp, type UnipileRequestOptions } from './http-core';
import type { UnipileV1TransportConfig } from './v1-http';
import type { HistoryListRequest, V1HistoryTransport } from './v1-history';
import { plain, opaque, utc, unavailable, validateV1ReadConfig } from './v1-read-guard';
/** Always account-bound, uncached, all-folder original-source history; no provider writes. */
export class UnipileV1HistoryHttp implements V1HistoryTransport {
    #http: BoundedUnipileHttp;
    constructor(config: UnipileV1TransportConfig) { validateV1ReadConfig(config); this.#http = new BoundedUnipileHttp({ ...config, basePath: '/api/v1', strictWriteRejections: true }); }
    getAccount(accountId: string, options: UnipileRequestOptions = {}) {
        if (!opaque(accountId) || accountId.includes(','))
            unavailable();
        return this.#http.request('GET', this.#http.url(`accounts/${encodeURIComponent(accountId)}`), undefined, options);
    }
    list(input: HistoryListRequest, options: UnipileRequestOptions = {}) {
        if (!plain(input) || !opaque(input.accountId) || input.accountId.includes(',') || !['email', 'linkedin', 'whatsapp'].includes(input.channel) || !utc(input.after) || !utc(input.before) || Date.parse(input.after) >= Date.parse(input.before) || input.cursor !== null && !opaque(input.cursor, 16384) || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 250)
            unavailable();
        const url = this.#http.url(input.channel === 'email' ? 'emails' : 'messages');
        url.searchParams.set('account_id', input.accountId);
        url.searchParams.set('after', input.after);
        url.searchParams.set('before', input.before);
        url.searchParams.set('limit', String(input.limit));
        if (input.cursor !== null)
            url.searchParams.set('cursor', input.cursor);
        if (input.channel === 'email') {
            url.searchParams.set('meta_only', 'false');
            url.searchParams.set('include_headers', 'true');
        }
        return this.#http.request('GET', url, undefined, options);
    }
}
