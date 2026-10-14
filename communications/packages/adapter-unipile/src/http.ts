/** Provisional v2 transport. It supplies no account ownership, journal or delivery guarantee. */
import { BoundedUnipileHttp, boundedInteger, type UnipileRequestOptions } from "./http-core";
export type { UnipileHttpResult, UnipileRequestOptions } from "./http-core";
export interface UnipileV2TransportConfig {
    apiVersion: "v2";
    /** Explicit URL ending in /v2. No credentials, query or fragment are permitted. */
    baseUrl: string;
    apiKey: string;
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
    maxResponseBytes?: number;
    /** Only for synthetic HTTP fixtures bound to localhost/loopback. */
    allowLoopbackHttp?: boolean;
}
export interface UnipileMessagePayload {
    text: string;
    quote_id?: string;
}
function accountSegment(accountId: string) {
    if (!/^acc_[A-Za-z0-9_-]+$/.test(accountId) || accountId.length > 512) {
        throw new Error("Invalid Unipile request");
    }
    return encodeURIComponent(accountId);
}
function chatSegment(chatId: string) {
    if (!chatId || chatId === "." || chatId === ".." || chatId.length > 2048 || /[\u0000-\u001f\u007f]/.test(chatId)) {
        throw new Error("Invalid Unipile request");
    }
    return encodeURIComponent(chatId);
}
export class UnipileV2Transport {
    #http: BoundedUnipileHttp;
    constructor(config: UnipileV2TransportConfig) {
        if (config.apiVersion !== "v2")
            throw new Error("Invalid Unipile configuration");
        this.#http = new BoundedUnipileHttp({ ...config, basePath: "/v2" });
    }
    async listAccounts(pagination: {
        offset?: number;
        limit?: number;
    } = {}, options: UnipileRequestOptions = {}) {
        if ((pagination.offset !== undefined && !boundedInteger(pagination.offset, 0, Number.MAX_SAFE_INTEGER)) ||
            (pagination.limit !== undefined && !boundedInteger(pagination.limit, 1, 100))) {
            throw new Error("Invalid Unipile request");
        }
        const url = this.#http.url("accounts/");
        if (pagination.offset !== undefined)
            url.searchParams.set("offset", String(pagination.offset));
        if (pagination.limit !== undefined)
            url.searchParams.set("limit", String(pagination.limit));
        return this.#http.request("GET", url, undefined, options);
    }
    async getAccount(accountId: string, options: UnipileRequestOptions = {}) {
        return this.#http.request("GET", this.#http.url(`accounts/${accountSegment(accountId)}`), undefined, options);
    }
    /** Transport-only submit. Success means HTTP acceptance, never confirmed delivery. No retries. */
    async sendMessage(accountId: string, chatId: string, payload: UnipileMessagePayload, options: UnipileRequestOptions = {}) {
        if (typeof payload.text !== "string" ||
            (payload.quote_id !== undefined && (typeof payload.quote_id !== "string" || payload.quote_id.length === 0))) {
            throw new Error("Invalid Unipile request");
        }
        // Construct the whitelisted text-only payload; arbitrary provider options are not yet verified.
        const body = { text: payload.text, ...(payload.quote_id === undefined ? {} : { quote_id: payload.quote_id }) };
        const path = `${accountSegment(accountId)}/chats/${chatSegment(chatId)}/messages/send`;
        return this.#http.request("POST", this.#http.url(path), JSON.stringify(body), options, { "Content-Type": "application/json" });
    }
}
