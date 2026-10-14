import { BoundedUnipileHttp, type UnipileRequestOptions } from './http-core';
import type { UnipileV1TransportConfig } from './v1-http';
import { opaque, unavailable, validateV1ReadConfig } from './v1-read-guard';
import type { V1RelationshipTransport } from './v1-relationships';
/** Profile notify=false avoids intentional visit notification; invitation list is read-only. */
export class UnipileV1RelationshipsHttp implements V1RelationshipTransport {
    #http: BoundedUnipileHttp;
    constructor(config: UnipileV1TransportConfig) { validateV1ReadConfig(config); this.#http = new BoundedUnipileHttp({ ...config, basePath: '/api/v1', strictWriteRejections: true }); }
    getAccount(account: string, o: UnipileRequestOptions = {}) {
        if (!opaque(account) || account.includes(','))
            unavailable();
        return this.#http.request('GET', this.#http.url(`accounts/${encodeURIComponent(account)}`), undefined, o);
    }
    getProfile(account: string, identifier: string, o: UnipileRequestOptions = {}) {
        if (!opaque(account) || account.includes(',') || !opaque(identifier) || identifier === '.' || identifier === '..')
            unavailable();
        const url = this.#http.url(`users/${encodeURIComponent(identifier)}`);
        url.searchParams.set('account_id', account);
        url.searchParams.set('notify', 'false');
        return this.#http.request('GET', url, undefined, o);
    }
    listInvitations(account: string, cursor: string | null, o: UnipileRequestOptions = {}) {
        if (!opaque(account) || account.includes(',') || cursor !== null && !opaque(cursor, 16384))
            unavailable();
        const url = this.#http.url('users/invite/sent');
        url.searchParams.set('account_id', account);
        url.searchParams.set('limit', '250');
        if (cursor !== null)
            url.searchParams.set('cursor', cursor);
        return this.#http.request('GET', url, undefined, o);
    }
}
