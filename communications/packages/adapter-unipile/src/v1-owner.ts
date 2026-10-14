import { types } from 'node:util';
import type { CanonicalIdentity, Capabilities, ConnectionStatus, Platform } from '../../contracts/src';
import { validateV1ReadConfig } from './v1-read-guard';
import { BoundedUnipileHttp, type UnipileHttpResult } from './http-core';
import type { UnipileV1TransportConfig } from './v1-http';
export interface VerifiedUnipileOwner {
    platform: Platform;
    providerAccountId: string;
    sourceId: string;
    providerOwner: {
        namespace: string;
        value: string;
    };
    physicalOwner: {
        namespace: 'mailbox_address' | 'e164' | 'linkedin_member';
        value: string;
    };
    canonicalIdentity: CanonicalIdentity;
    aliases: CanonicalIdentity[];
    status: ConnectionStatus;
    capabilities: Capabilities;
}
export type UnipileOwnerResult = {
    kind: 'verified';
    owner: VerifiedUnipileOwner;
} | {
    kind: 'review';
    code: 'identity_pending' | 'account_changed' | 'protocol';
} | {
    kind: 'unavailable';
};
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 2048 && v === v.trim() && v !== '.' && v !== '..' && !/[\u0000-\u001f\u007f]/.test(v);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && !types.isProxy(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)) && Reflect.ownKeys(Object.getOwnPropertyDescriptors(v)).every(k => typeof k === 'string' && 'value' in Object.getOwnPropertyDescriptor(v, k)!);
function email(v: unknown): string | null { return typeof v === 'string' && v.length <= 320 && /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(v) ? v.toLowerCase() : null; }
/** OAuth primary mailbox is established by AccountOwnerProfile.email, never Account.name,
 * login username or an opaque account ID. IMAP username is not mailbox address proof. */
export function projectV1CanonicalOwner(account: unknown, profile: unknown, input: {
    platform: Platform;
    providerAccountId: string;
    sourceId?: string;
}): UnipileOwnerResult {
    const review = (code: 'identity_pending' | 'account_changed' | 'protocol' = 'protocol'): UnipileOwnerResult => ({ kind: 'review', code });
    if (!object(account) || account.object !== 'Account' || !id(input.providerAccountId) || account.id !== input.providerAccountId || account.type !== { gmail: 'GOOGLE_OAUTH', outlook: 'OUTLOOK', imap: 'MAIL', whatsapp: 'WHATSAPP', linkedin: 'LINKEDIN' }[input.platform])
        return review('account_changed');
    if (!object(account.connection_params) || !Array.isArray(account.sources) || !account.sources.length || account.sources.length > 100 || !account.sources.every(s => object(s) && id(s.id) && typeof s.status === 'string'))
        return review();
    const sources = input.sourceId ? account.sources.filter(s => s.id === input.sourceId) : account.sources;
    // Multiple products are never guessed from an OK source; configure the product source explicitly.
    if (sources.length !== 1)
        return review('identity_pending');
    const source = sources[0];
    const status: Record<string, ConnectionStatus> = { OK: 'connected', CONNECTING: 'connecting', STOPPED: 'disconnected', CREDENTIALS: 'verification_required', PERMISSIONS: 'verification_required', ERROR: 'failed' };
    if (!Object.hasOwn(status, source.status))
        return review();
    const platform = input.platform, product = account.connection_params[platform === 'whatsapp' || platform === 'linkedin' ? 'im' : 'mail'];
    if (!object(product))
        return review();
    if (platform === 'imap')
        return review('identity_pending');
    let physicalOwner: VerifiedUnipileOwner['physicalOwner'], canonicalIdentity: CanonicalIdentity, providerOwner: VerifiedUnipileOwner['providerOwner'], aliases: CanonicalIdentity[] = [];
    if (platform === 'whatsapp') {
        if (typeof product.phone_number !== 'string' || !/^\+[1-9]\d{6,14}$/.test(product.phone_number))
            return review('identity_pending');
        physicalOwner = { namespace: 'e164', value: product.phone_number };
        providerOwner = { namespace: 'unipile.v1.whatsapp.im.phone_number', value: product.phone_number };
        canonicalIdentity = { kind: 'phone', value: product.phone_number };
    }
    else {
        if (!object(profile) || profile.object !== 'AccountOwnerProfile' || !id(product.id))
            return review('identity_pending');
        if (platform === 'gmail' || platform === 'outlook') {
            if (profile.provider !== (platform === 'gmail' ? 'GMAIL' : 'OUTLOOK'))
                return review('account_changed');
            const address = email(profile.email);
            if (!address)
                return review('identity_pending');
            if (platform === 'outlook' && profile.id !== product.id)
                return review('account_changed');
            physicalOwner = { namespace: 'mailbox_address', value: address };
            canonicalIdentity = { kind: 'email', value: address };
            providerOwner = { namespace: platform === 'gmail' ? 'unipile.v1.google.mail.id' : 'unipile.v1.outlook.mail.id', value: platform === 'gmail' ? product.id : JSON.stringify([product.id, product.mailbox_id ?? null]) };
            if (platform === 'gmail' && Array.isArray(profile.aliases))
                for (const alias of profile.aliases) {
                    if (!object(alias))
                        return review();
                    const address = email(alias.email);
                    if (!address)
                        return review();
                    if (alias.verification_status === 'accepted')
                        aliases.push({ kind: 'email', value: address });
                }
        }
        else {
            if (profile.provider !== 'LINKEDIN' || profile.provider_id !== product.id || !id(profile.provider_id))
                return review('account_changed');
            let url: URL;
            try {
                if (typeof profile.public_profile_url === 'string')
                    url = new URL(profile.public_profile_url);
                else if (typeof profile.public_identifier === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(profile.public_identifier))
                    url = new URL(`https://www.linkedin.com/in/${profile.public_identifier}`);
                else
                    return review('identity_pending');
                if (url.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname) || url.port || url.username || url.password || url.search || url.hash || !/^\/in\/[^/]+\/?$/.test(url.pathname))
                    return review();
            }
            catch {
                return review();
            }
            physicalOwner = { namespace: 'linkedin_member', value: profile.provider_id };
            providerOwner = { namespace: 'unipile.v1.linkedin.im.id', value: profile.provider_id };
            canonicalIdentity = { kind: 'linkedin_profile', value: url.href };
        }
    }
    aliases = [canonicalIdentity, ...aliases.filter(a => a.value !== canonicalIdentity.value)];
    aliases = aliases.filter((a, i, all) => all.findIndex(b => a.kind === b.kind && a.value === b.value) === i);
    const capabilities: Capabilities = { messaging: { send: true, durableIdempotency: false, receiptLookup: true }, events: { read: false, history: false, realtime: false }, ...(platform === 'gmail' || platform === 'outlook' ? { email: { drafts: false, threading: true, rfcMessageId: false } } : {}), ...(platform === 'linkedin' ? { linkedin: { resolveProfile: true, relationships: true, invitations: true } } : {}) };
    return { kind: 'verified', owner: { platform, providerAccountId: input.providerAccountId, sourceId: source.id, providerOwner, physicalOwner, canonicalIdentity, aliases, status: status[source.status], capabilities } };
}
/** Version-specific account-scoped read transport; no profile visits, sync triggers or writes. */
export class UnipileV1OwnerReader {
    #http: BoundedUnipileHttp;
    constructor(config: UnipileV1TransportConfig) {
        validateV1ReadConfig(config);
        if (config.apiVersion !== 'v1')
            throw Error('Invalid owner reader configuration');
        this.#http = new BoundedUnipileHttp({ ...config, basePath: '/api/v1', strictWriteRejections: true });
    }
    getAccount(accountId: string, signal?: AbortSignal): Promise<UnipileHttpResult> {
        if (!id(accountId))
            throw Error('Invalid owner request');
        return this.#http.request('GET', this.#http.url(`accounts/${encodeURIComponent(accountId)}`), undefined, { signal });
    }
    getOwnProfile(accountId: string, signal?: AbortSignal): Promise<UnipileHttpResult> {
        if (!id(accountId))
            throw Error('Invalid owner request');
        const url = this.#http.url('users/me');
        url.searchParams.set('account_id', accountId);
        return this.#http.request('GET', url, undefined, { signal });
    }
    listThread(accountId: string, threadId: string, signal?: AbortSignal): Promise<UnipileHttpResult> {
        if (!id(accountId) || !id(threadId))
            throw Error('Invalid owner request');
        const url = this.#http.url('emails');
        url.searchParams.set('account_id', accountId);
        url.searchParams.set('thread_id', threadId);
        url.searchParams.set('limit', '20');
        url.searchParams.set('meta_only', 'false');
        url.searchParams.set('include_headers', 'true');
        return this.#http.request('GET', url, undefined, { signal });
    }
    async verify(input: {
        platform: Platform;
        providerAccountId: string;
        sourceId?: string;
    }, signal?: AbortSignal): Promise<UnipileOwnerResult> {
        try {
            const account = await this.getAccount(input.providerAccountId, signal);
            if (account.kind !== 'success' || account.status !== 200)
                return { kind: 'unavailable' };
            let profile: unknown = null;
            if (input.platform !== 'whatsapp' && input.platform !== 'imap') {
                const response = await this.getOwnProfile(input.providerAccountId, signal);
                if (response.kind !== 'success' || response.status !== 200)
                    return { kind: 'unavailable' };
                profile = response.data;
            }
            return projectV1CanonicalOwner(account.data, profile, input);
        }
        catch {
            return { kind: 'unavailable' };
        }
    }
}
/** Revalidates encrypted runtime metadata shape; decryption alone is not typed owner authority. */
export function parseVerifiedV1Owner(input: unknown): VerifiedUnipileOwner {
    function fail(): never { throw Error('Invalid verified account metadata'); }
    function exact(v: unknown, keys: string[]): Record<string, unknown> { if (types.isPromise(v)) {
        void Promise.prototype.then.call(v, undefined, () => { });
        fail();
    } if (!object(v) || Object.keys(v).sort().join(',') !== [...keys].sort().join(','))
        fail(); for (const value of Object.values(v))
        if (types.isPromise(value)) {
            void Promise.prototype.then.call(value, undefined, () => { });
            fail();
        } return v; }
    const r = exact(input, ['platform', 'providerAccountId', 'sourceId', 'providerOwner', 'physicalOwner', 'canonicalIdentity', 'aliases', 'status', 'capabilities']);
    if (!['gmail', 'outlook', 'whatsapp', 'linkedin'].includes(r.platform as string) || !id(r.providerAccountId) || !id(r.sourceId) || !['connecting', 'connected', 'syncing', 'verification_required', 'disconnected', 'failed'].includes(r.status as string))
        fail();
    const physical = exact(r.physicalOwner, ['namespace', 'value']), provider = exact(r.providerOwner, ['namespace', 'value']);
    if (!id(provider.value) || provider.namespace !== { gmail: 'unipile.v1.google.mail.id', outlook: 'unipile.v1.outlook.mail.id', whatsapp: 'unipile.v1.whatsapp.im.phone_number', linkedin: 'unipile.v1.linkedin.im.id' }[r.platform as 'gmail' | 'outlook' | 'whatsapp' | 'linkedin'])
        fail();
    const identity = (v: unknown) => { const a = exact(v, ['kind', 'value']); if (!id(a.value))
        fail(); if (a.kind === 'email') {
        if (email(a.value) !== a.value)
            fail();
    }
    else if (a.kind === 'phone') {
        if (!/^\+[1-9]\d{6,14}$/.test(a.value))
            fail();
    }
    else if (a.kind === 'linkedin_profile') {
        const u = new URL(a.value);
        if (u.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(u.hostname) || u.port || u.username || u.password || u.search || u.hash || !/^\/in\/[^/]+\/?$/.test(u.pathname))
            fail();
    }
    else
        fail(); return a as unknown as CanonicalIdentity; };
    const canonical = identity(r.canonicalIdentity);
    if (r.platform === 'whatsapp') {
        if (physical.namespace !== 'e164' || physical.value !== canonical.value || canonical.kind !== 'phone' || provider.value !== physical.value)
            fail();
    }
    else if (r.platform === 'linkedin') {
        if (physical.namespace !== 'linkedin_member' || physical.value !== provider.value || canonical.kind !== 'linkedin_profile')
            fail();
    }
    else if (physical.namespace !== 'mailbox_address' || physical.value !== canonical.value || canonical.kind !== 'email')
        fail();
    if (!Array.isArray(r.aliases) || types.isProxy(r.aliases) || r.aliases.length < 1 || r.aliases.length > 100)
        fail();
    const aliases = r.aliases.map(identity);
    if (aliases.some(a => a.kind !== canonical.kind) || !aliases.some(a => a.value === canonical.value) || new Set(aliases.map(a => a.value)).size !== aliases.length)
        fail();
    const c = r.capabilities;
    if (!object(c) || Object.keys(c).some(k => !['messaging', 'events', 'email', 'linkedin'].includes(k)))
        fail();
    const booleans = (v: unknown, keys: string[]) => { const values = exact(v, keys); if (Object.values(values).some(value => typeof value !== 'boolean'))
        fail(); };
    booleans(c.messaging, ['send', 'durableIdempotency', 'receiptLookup']);
    booleans(c.events, ['read', 'history', 'realtime']);
    if (c.email !== undefined) {
        if (canonical.kind !== 'email')
            fail();
        booleans(c.email, ['drafts', 'threading', 'rfcMessageId']);
    }
    if (c.linkedin !== undefined) {
        if (r.platform !== 'linkedin')
            fail();
        booleans(c.linkedin, ['resolveProfile', 'relationships', 'invitations']);
    }
    return structuredClone(r) as unknown as VerifiedUnipileOwner;
}
