import { BoundedUnipileHttp, boundedInteger, type UnipileRequestOptions, type UnipileHttpResult } from './http-core';
export interface UnipileV1TransportConfig {
    apiVersion: 'v1';
    /** Explicit HTTPS DSN URL ending in /api/v1. Never inferred from a key. */
    baseUrl: string;
    apiKey: string;
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
    maxResponseBytes?: number;
    allowLoopbackHttp?: boolean;
}
/** Bounded subset of the documented v1 list queries; v2 offsets and sync triggers are unavailable. */
export interface UnipileV1ReadPagination { cursor?: string; limit?: number; }
export interface UnipileV1EmailPayload {
    to: {
        identifier: string;
        display_name?: string;
    }[];
    /** V1 email body is HTML. Callers must escape plain text explicitly. */
    body: string;
    subject?: string;
    /** Parent email ID, not a thread ID or Reply-To address. */
    reply_to?: string;
    custom_headers?: {
        name: string;
        value: string;
    }[];
}
function invalid(): never { throw new Error('Invalid Unipile request'); }
function segment(value: string): string {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value === '.' || value === '..' || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value))
        invalid();
    return encodeURIComponent(value);
}
function exactFields(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
        invalid();
}
function text(value: unknown, max = 1000000): asserts value is string {
    if (typeof value !== 'string' || value.length > max)
        invalid();
}
function headerValue(value: unknown, max = 8192): asserts value is string {
    text(value, max);
    if (/[\r\n\u0000]/.test(value))
        invalid();
}
function emailForm(accountId: string, payload: UnipileV1EmailPayload): FormData {
    segment(accountId);
    exactFields(payload, ['to', 'body', 'subject', 'reply_to', 'custom_headers']);
    text(payload.body);
    if (!Array.isArray(payload.to) || !payload.to.length || payload.to.length > 100)
        invalid();
    for (const attendee of payload.to) {
        exactFields(attendee, ['identifier', 'display_name']);
        headerValue(attendee.identifier);
        if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(attendee.identifier))
            invalid();
        if (attendee.display_name !== undefined)
            headerValue(attendee.display_name);
    }
    if (payload.subject !== undefined)
        headerValue(payload.subject);
    if (payload.reply_to !== undefined)
        segment(payload.reply_to);
    if (payload.custom_headers !== undefined) {
        if (!Array.isArray(payload.custom_headers) || payload.custom_headers.length > 32)
            invalid();
        for (const header of payload.custom_headers) {
            exactFields(header, ['name', 'value']);
            headerValue(header.name);
            headerValue(header.value);
            if (!/^(?:[xX]-[A-Za-z0-9-]+|List-Unsubscribe|List-Unsubscribe-Post|Reply-To|Content-Type)$/.test(header.name))
                invalid();
        }
    }
    const form = new FormData();
    form.set('account_id', accountId);
    form.set('to', JSON.stringify(payload.to));
    form.set('body', payload.body);
    if (payload.subject !== undefined)
        form.set('subject', payload.subject);
    if (payload.reply_to !== undefined)
        form.set('reply_to', payload.reply_to);
    if (payload.custom_headers !== undefined)
        form.set('custom_headers', JSON.stringify(payload.custom_headers));
    return form;
}
function singleAccount(value: string) {
    segment(value);
    // GET /chats treats commas as multiple accounts; one recorded scope must remain one account.
    if (value.includes(',')) invalid();
}
function applyReadPagination(url: URL, pagination: UnipileV1ReadPagination) {
    if (!pagination || typeof pagination !== 'object' || Array.isArray(pagination)) invalid();
    const prototype = Object.getPrototypeOf(pagination);
    if (prototype !== null && prototype !== Object.prototype) invalid();
    const descriptors = Object.getOwnPropertyDescriptors(pagination);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' ||
        !['cursor', 'limit'].includes(key) || !('value' in descriptors[key]!))) invalid();
    // Read once from data descriptors; accessors cannot change validated values between checks and I/O.
    pagination = { cursor: descriptors.cursor?.value, limit: descriptors.limit?.value };
    if (pagination.cursor !== undefined) { segment(pagination.cursor); url.searchParams.set('cursor', pagination.cursor); }
    if (pagination.limit !== undefined) {
        if (!boundedInteger(pagination.limit, 1, 250)) invalid();
        url.searchParams.set('limit', String(pagination.limit));
    }
}
/** V1 transport only: successful HTTP does not establish recipient, delivery or durable idempotency. */
export class UnipileV1Transport {
    #http: BoundedUnipileHttp;
    constructor(config: UnipileV1TransportConfig) {
        if (config.apiVersion !== 'v1')
            throw new Error('Invalid Unipile configuration');
        this.#http = new BoundedUnipileHttp({ ...config, basePath: '/api/v1', strictWriteRejections: true });
    }
    async listAccounts(pagination: {
        cursor?: string;
        limit?: number;
    } = {}, options: UnipileRequestOptions = {}) {
        exactFields(pagination, ['cursor', 'limit']);
        if (pagination.cursor !== undefined)
            segment(pagination.cursor);
        if (pagination.limit !== undefined && !boundedInteger(pagination.limit, 1, 250))
            invalid();
        const url = this.#http.url('accounts');
        if (pagination.cursor !== undefined)
            url.searchParams.set('cursor', pagination.cursor);
        if (pagination.limit !== undefined)
            url.searchParams.set('limit', String(pagination.limit));
        return this.#http.request('GET', url, undefined, options);
    }
    /** Single recorded account only. Raw pages do not prove fresh or complete reply coverage. */
    async listChats(accountId: string, pagination: UnipileV1ReadPagination = {}, options: UnipileRequestOptions = {}) {
        singleAccount(accountId);
        const url = this.#http.url('chats');
        url.searchParams.set('account_id', accountId);
        applyReadPagination(url, pagination);
        return this.#http.request('GET', url, undefined, options);
    }
    /** V1 list messages has no account_id query; verify the exact chat first on every read. */
    async listChatMessages(accountId: string, chatId: string, pagination: UnipileV1ReadPagination = {}, options: UnipileRequestOptions = {}): Promise<UnipileHttpResult> {
        singleAccount(accountId);
        const url = this.#http.url(`chats/${segment(chatId)}/messages`);
        applyReadPagination(url, pagination);
        const requestOptions = { signal: options.signal };
        const preflight = await this.#verifyChatReadScope(accountId, chatId, requestOptions);
        if (preflight) return preflight;
        return this.#http.request('GET', url, undefined, requestOptions);
    }
    /** V1 attendee list documents neither pagination nor account query. Validate every returned attendee upstream. */
    async getChatAttendees(accountId: string, chatId: string, options: UnipileRequestOptions = {}): Promise<UnipileHttpResult> {
        singleAccount(accountId);
        const url = this.#http.url(`chats/${segment(chatId)}/attendees`);
        const requestOptions = { signal: options.signal };
        const preflight = await this.#verifyChatReadScope(accountId, chatId, requestOptions);
        if (preflight) return preflight;
        return this.#http.request('GET', url, undefined, requestOptions);
    }
    async #verifyChatReadScope(accountId: string, chatId: string, options: UnipileRequestOptions): Promise<UnipileHttpResult | undefined> {
        const url = this.#http.url(`chats/${segment(chatId)}`);
        url.searchParams.set('account_id', accountId);
        const result = await this.#http.request('GET', url, undefined, options);
        if (result.kind !== 'success') return result;
        const chat = result.data;
        if (result.status !== 200 || !chat || typeof chat !== 'object' || Array.isArray(chat) ||
            !('object' in chat) || chat.object !== 'Chat' || !('id' in chat) || chat.id !== chatId ||
            !('account_id' in chat) || chat.account_id !== accountId) {
            throw new Error('Invalid Unipile read scope');
        }
        return undefined;
    }
    async getAccount(id: string, options: UnipileRequestOptions = {}) { return this.#http.request('GET', this.#http.url(`accounts/${segment(id)}`), undefined, options); }
    async getChat(accountId: string, id: string, options: UnipileRequestOptions = {}) {
        segment(accountId);
        const url = this.#http.url(`chats/${segment(id)}`);
        url.searchParams.set('account_id', accountId);
        return this.#http.request('GET', url, undefined, options);
    }
    /** Caller must validate returned account_id, chat_id, exact message ID and direction. */
    async getMessage(id: string, options: UnipileRequestOptions = {}) { return this.#http.request('GET', this.#http.url(`messages/${segment(id)}`), undefined, options); }
    async getEmail(accountId: string, id: string, options: UnipileRequestOptions = {}) {
        segment(accountId);
        const url = this.#http.url(`emails/${segment(id)}`);
        url.searchParams.set('account_id', accountId);
        url.searchParams.set('include_headers', 'true');
        return this.#http.request('GET', url, undefined, options);
    }
    async sendMessage(accountId: string, chatId: string, payload: {
        text: string;
        quote_id?: string;
    }, options: UnipileRequestOptions = {}) {
        segment(accountId);
        exactFields(payload, ['text', 'quote_id']);
        text(payload.text);
        if (payload.quote_id !== undefined)
            segment(payload.quote_id);
        const form = new FormData();
        form.set('account_id', accountId);
        form.set('text', payload.text);
        if (payload.quote_id !== undefined)
            form.set('quote_id', payload.quote_id);
        return this.#http.request('POST', this.#http.url(`chats/${segment(chatId)}/messages`), form, options);
    }
    /** Provider's key cache is memory-only, email-only and time-limited; never a durable service journal. */
    async sendEmail(accountId: string, payload: UnipileV1EmailPayload, idempotencyKey: string, options: UnipileRequestOptions = {}) {
        headerValue(idempotencyKey, 255);
        if (!idempotencyKey.length)
            invalid();
        const form = emailForm(accountId, payload);
        return this.#http.request('POST', this.#http.url('emails'), form, options, { 'Idempotency-Key': idempotencyKey });
    }
    async createDraft(accountId: string, payload: UnipileV1EmailPayload, options: UnipileRequestOptions = {}) {
        const form = emailForm(accountId, payload);
        return this.#http.request('POST', this.#http.url('drafts'), form, options);
    }
    async invite(accountId: string, providerId: string, message?: string, options: UnipileRequestOptions = {}) {
        segment(accountId);
        segment(providerId);
        if (message !== undefined)
            text(message, 300);
        const body = { account_id: accountId, provider_id: providerId, ...(message === undefined ? {} : { message }) };
        return this.#http.request('POST', this.#http.url('users/invite'), JSON.stringify(body), options, { 'Content-Type': 'application/json' });
    }
}
