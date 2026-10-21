import {parseLocalSyncEventProof,type LocalSyncEventProof} from '../../core/src/local-sync-event';
import { createHash, createHmac, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { assertSameBinding, type ConnectionBinding, type OperationSnapshot } from '../../contracts/src';
import { JournalCodec, type JournalEnvelope } from '../../core/src/journal-codec';
export interface AccountVaultOptions {
    activeVersion: string;
    keys: readonly {
        version: string;
        encryptionKey: Uint8Array;
        digestKey: Uint8Array;
    }[];
    identityKey: Uint8Array;
    identityKeyVersion: string;
}
export interface AccountSealed {
    encrypted: string;
    keyVersion: string;
    digest: string;
}
export interface ProviderReceiptScope {
    integrationId: string;
    providerConfigurationReference: string;
    id: string;
}
export interface ProviderReceiptPayload {
    localSync?:LocalSyncEventProof;
    providerAccountId: string;
    rawBody: Uint8Array;
    receivedAt: string;
}
export class AccountRuntimeVault {
    #codec: JournalCodec;
    #publicCodec: Pick<JournalCodec, 'keyVersion' | 'encode' | 'decode' | 'digest'>;
    #keys = new Map<string, Buffer>();
    #encryption = new Map<string, Buffer>();
    #identity: Buffer;
    #identityVersion: string;
    constructor(options: AccountVaultOptions) {
        try {
            const observed = (value: unknown) => { if (types.isPromise(value)) {
                void Promise.prototype.then.call(value, undefined, () => { });
                throw Error();
            } return value; };
            function record(value: unknown, keys: string[]): Record<string, unknown> { observed(value); if (!value || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
                throw Error(); const d = Object.getOwnPropertyDescriptors(value); if (Reflect.ownKeys(d).some(k => typeof k !== 'string' || !keys.includes(k) || !('value' in d[k])) || keys.some(k => !Object.hasOwn(d, k)))
                throw Error(); return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, observed(v.value)])); }
            const bytes = (value: unknown) => { observed(value); if (!types.isUint8Array(value) || types.isProxy(value) || ![Uint8Array.prototype, Buffer.prototype].includes(Object.getPrototypeOf(value)))
                throw Error(); const length = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(value); if (length !== 32 || Reflect.ownKeys(value).some(k => typeof k !== 'string' || !/^\d+$/.test(k)))
                throw Error(); return Buffer.from(value as Uint8Array); };
            const raw = record(options, ['activeVersion', 'keys', 'identityKey', 'identityKeyVersion']);
            if (typeof raw.identityKeyVersion !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.identityKeyVersion) || !Array.isArray(raw.keys) || types.isProxy(raw.keys) || Object.getPrototypeOf(raw.keys) !== Array.prototype || raw.keys.length < 1 || raw.keys.length > 32 || Reflect.ownKeys(raw.keys).length !== raw.keys.length + 1)
                throw Error();
            this.#identity = bytes(raw.identityKey);
            this.#identityVersion = raw.identityKeyVersion;
            const keys = [] as {
                version: string;
                encryptionKey: Buffer;
                digestKey: Buffer;
            }[];
            for (let i = 0; i < raw.keys.length; i++) {
                const d = Object.getOwnPropertyDescriptor(raw.keys, String(i));
                if (!d || !('value' in d))
                    throw Error();
                const key = record(d.value, ['version', 'encryptionKey', 'digestKey']);
                if (typeof key.version !== 'string')
                    throw Error();
                keys.push({ version: key.version, encryptionKey: bytes(key.encryptionKey), digestKey: bytes(key.digestKey) });
            }
            const all = [this.#identity, ...keys.flatMap(k => [k.encryptionKey, k.digestKey])];
            if (new Set(all.map(k => k.toString('hex'))).size !== all.length)
                throw Error();
            this.#codec = new JournalCodec({ activeVersion: raw.activeVersion as string, keys });
            this.#publicCodec = Object.freeze({ keyVersion: this.#codec.keyVersion, encode: Function.prototype.bind.call(this.#codec.encode, this.#codec), decode: Function.prototype.bind.call(this.#codec.decode, this.#codec), digest: Function.prototype.bind.call(this.#codec.digest, this.#codec) });
            for (const key of keys) {
                this.#keys.set(key.version, Buffer.from(key.digestKey));
                this.#encryption.set(key.version, Buffer.from(key.encryptionKey));
            }
        }
        catch {
            throw Error('Invalid account vault configuration');
        }
    }
    get journal(): Pick<JournalCodec, 'keyVersion' | 'encode' | 'decode' | 'digest'> { return this.#publicCodec; }
    get keyVersion(): string { return this.#codec.keyVersion; }
    get identityKeyVersion(): string { return this.#identityVersion; }
    #snapshot(binding: ConnectionBinding, purpose: string): OperationSnapshot {
        assertSameBinding(binding, binding);
        if (!['provider', 'metadata', 'alias', 'notification'].includes(purpose))
            throw Error('Invalid account vault data');
        const copied = structuredClone(binding);
        return { binding: copied, key: `account-runtime/${purpose}/v1`, operation: 'message', payloadDigest: createHash('sha256').update(JSON.stringify(['communications.account-runtime.v1', purpose, copied])).digest('hex') };
    }
    seal(binding: ConnectionBinding, purpose: 'provider' | 'metadata' | 'alias' | 'notification', payload: unknown): AccountSealed {
        try {
            const snapshot = this.#snapshot(binding, purpose), value = { domain: `communications.account-runtime.${purpose}.v1`, payload };
            const envelope = this.#codec.encode(snapshot, 'context', value);
            return { encrypted: JSON.stringify(envelope), keyVersion: envelope.keyVersion, digest: this.#codec.digest(snapshot, 'context', value, envelope.keyVersion) };
        }
        catch {
            throw Error('Invalid account vault data');
        }
    }
    open(binding: ConnectionBinding, purpose: 'provider' | 'metadata' | 'alias' | 'notification', sealed: AccountSealed): unknown {
        try {
            const snapshot = this.#snapshot(binding, purpose), envelope = this.envelope(sealed);
            if (envelope.keyVersion !== sealed.keyVersion)
                throw Error();
            const value = this.#codec.decode(snapshot, 'context', envelope) as {
                domain: string;
                payload: unknown;
            };
            const digest = this.#codec.digest(snapshot, 'context', value, sealed.keyVersion);
            if ((sealed.digest !== '' || purpose !== 'provider') && (!/^[a-f0-9]{64}$/.test(sealed.digest) || !timingSafeEqual(Buffer.from(sealed.digest, 'hex'), Buffer.from(digest, 'hex'))) || value.domain !== `communications.account-runtime.${purpose}.v1`)
                throw Error();
            return value.payload;
        }
        catch {
            throw Error('Invalid account vault data');
        }
    }
    #hmac(domain: string, value: unknown, keyVersion: string): string {
        const key = this.#keys.get(keyVersion);
        if (!key)
            throw Error('Invalid account vault data');
        return createHmac('sha256', key).update(JSON.stringify([domain, value])).digest('hex');
    }
    providerAccountDigest(providerAccountId: string, keyVersion = this.keyVersion): string {
        if (typeof providerAccountId !== 'string' || !providerAccountId.length || providerAccountId.length > 2048)
            throw Error('Invalid account vault data');
        return this.#hmac('communications.provider-account.v1', providerAccountId, keyVersion);
    }
    physicalIdentityDigest(identity: {
        namespace: string;
        value: string;
    }, keyVersion = this.identityKeyVersion): string {
        if (keyVersion !== this.identityKeyVersion || typeof identity.namespace !== 'string' || !identity.namespace.length || typeof identity.value !== 'string' || !identity.value.length || identity.value.length > 4096)
            throw Error('Invalid account vault data');
        return createHmac('sha256', this.#identity).update(JSON.stringify(['communications.physical-identity.v1', identity.namespace, identity.value])).digest('hex');
    }
    trackingDigest(input: {
        integrationId: string;
        providerConfigurationReference: string;
        providerAccountId: string;
        trackingId: string;
    }, keyVersion = this.keyVersion): string { return this.#hmac('communications.email-tracking.identity.v1', [input.integrationId, input.providerConfigurationReference, input.providerAccountId, input.trackingId], keyVersion); }
    versions(): readonly string[] { return [...this.#keys.keys()]; }
    envelope(sealed: AccountSealed): JournalEnvelope {
        if (typeof sealed.encrypted !== 'string' || sealed.encrypted.length > 2200000)
            throw Error('Invalid account vault data');
        return JSON.parse(sealed.encrypted) as JournalEnvelope;
    }
    #providerScope(input: ProviderReceiptScope): ProviderReceiptScope { if (!input || types.isProxy(input))
        throw Error(); const d = Object.getOwnPropertyDescriptors(input); if (Object.keys(d).sort().join(',') !== 'id,integrationId,providerConfigurationReference' || Object.values(d).some(p => !('value' in p)))
        throw Error(); for (const key of ['integrationId', 'providerConfigurationReference', 'id'] as const) {
        const v = d[key].value;
        if (types.isPromise(v)) {
            void Promise.prototype.then.call(v, undefined, () => { });
            throw Error();
        }
        if (typeof v !== 'string' || !v.length || v.length > (key === 'providerConfigurationReference' ? 2000 : 200) || v !== v.trim() || /[\u0000-\u001f\u007f]/.test(v))
            throw Error();
    } if (!/^[a-f0-9]{64}$/.test(input.id))
        throw Error(); return { ...input }; }
    #providerPayload(input: ProviderReceiptPayload) { if (!input || types.isProxy(input))
        throw Error(); const d = Object.getOwnPropertyDescriptors(input); if (!['providerAccountId,rawBody,receivedAt','localSync,providerAccountId,rawBody,receivedAt'].includes(Object.keys(d).sort().join(',')) || Object.values(d).some(p => !('value' in p)))
        throw Error(); for (const field of Object.values(d))
        if (types.isPromise(field.value)) {
            void Promise.prototype.then.call(field.value, undefined, () => { });
            throw Error();
        } if (typeof input.providerAccountId !== 'string' || !input.providerAccountId.length || input.providerAccountId.length > 2048 || input.providerAccountId !== input.providerAccountId.trim() || /[\u0000-\u001f\u007f]/.test(input.providerAccountId) || !types.isUint8Array(input.rawBody) || types.isProxy(input.rawBody) || input.rawBody.byteLength < 1 || input.rawBody.byteLength > 262144 || typeof input.receivedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.receivedAt) || !Number.isFinite(Date.parse(input.receivedAt)) || new Date(input.receivedAt).toISOString() !== input.receivedAt)
        throw Error(); const localSync=input.localSync===undefined?undefined:parseLocalSyncEventProof(input.localSync);if(localSync&&localSync.bodyDigest!==createHash('sha256').update(input.rawBody).digest('hex'))throw Error();return { providerAccountId: input.providerAccountId, rawBody: Buffer.from(input.rawBody).toString('base64'), receivedAt: input.receivedAt,...(localSync?{localSync}:{}) }; }
    #providerAad(scope: ProviderReceiptScope, version: string) { if (!this.#keys.has(version))
        throw Error(); return Buffer.from(JSON.stringify(['communications.provider-webhook.v1', scope.integrationId, scope.providerConfigurationReference, scope.id, version])); }
    providerReceiptId(input: {
        localSync?:LocalSyncEventProof;
        integrationId: string;
        providerConfigurationReference: string;
        providerAccountId: string;
        rawBody: Uint8Array;
    }): string { try {
        const payload = this.#providerPayload({ providerAccountId: input.providerAccountId, rawBody: input.rawBody, receivedAt: '2000-01-01T00:00:00.000Z',...(input.localSync===undefined?{}:{localSync:input.localSync}) }), scope = this.#providerScope({ integrationId: input.integrationId, providerConfigurationReference: input.providerConfigurationReference, id: '0'.repeat(64) });
        return createHmac('sha256', this.#identity).update(JSON.stringify([payload.localSync?'communications.provider-webhook.dedupe.local-sync.v1':'communications.provider-webhook.dedupe.v1', scope.integrationId, scope.providerConfigurationReference, payload.providerAccountId,...(payload.localSync?[payload.localSync.eventId]:[])])).update(payload.localSync?Buffer.alloc(0):Buffer.from(input.rawBody)).digest('hex');
    }
    catch {
        throw Error('Invalid provider receipt');
    } }
    sealProviderReceipt(input: ProviderReceiptScope, value: ProviderReceiptPayload): AccountSealed { try {
        const scope = this.#providerScope(input), payload = this.#providerPayload(value), version = this.keyVersion, aad = this.#providerAad(scope, version), plaintext = Buffer.from(JSON.stringify(payload)), nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.#encryption.get(version)!, nonce);
        cipher.setAAD(aad);
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return { encrypted: JSON.stringify({ format: 'communications-provider-webhook-v1', keyVersion: version, nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') }), keyVersion: version, digest: createHmac('sha256', this.#keys.get(version)!).update(aad).update(plaintext).digest('hex') };
    }
    catch {
        throw Error('Invalid provider receipt');
    } }
    openProviderReceipt(input: ProviderReceiptScope, sealed: AccountSealed): ProviderReceiptPayload { try {
        const scope = this.#providerScope(input);
        if (!sealed || types.isProxy(sealed) || typeof sealed.encrypted !== 'string' || sealed.encrypted.length > 500000 || typeof sealed.keyVersion !== 'string' || typeof sealed.digest !== 'string' || !/^[a-f0-9]{64}$/.test(sealed.digest))
            throw Error();
        const e = JSON.parse(sealed.encrypted);
        if (!e || Object.keys(e).sort().join(',') !== 'ciphertext,format,keyVersion,nonce,tag' || e.format !== 'communications-provider-webhook-v1' || e.keyVersion !== sealed.keyVersion)
            throw Error();
        const decode = (v: unknown, exact?: number) => { if (typeof v !== 'string' || !v.length || v.length > 500000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v))
            throw Error(); const b = Buffer.from(v, 'base64'); if (b.toString('base64') !== v || exact && b.length !== exact)
            throw Error(); return b; };
        const aad = this.#providerAad(scope, e.keyVersion), cipher = createDecipheriv('aes-256-gcm', this.#encryption.get(e.keyVersion)!, decode(e.nonce, 12));
        cipher.setAAD(aad);
        cipher.setAuthTag(decode(e.tag, 16));
        const plain = Buffer.concat([cipher.update(decode(e.ciphertext)), cipher.final()]);
        const expected = createHmac('sha256', this.#keys.get(e.keyVersion)!).update(aad).update(plain).digest();
        if (!timingSafeEqual(expected, Buffer.from(sealed.digest, 'hex')))
            throw Error();
        const payload = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(plain));
        if (!payload || !['providerAccountId,rawBody,receivedAt','localSync,providerAccountId,rawBody,receivedAt'].includes(Object.keys(payload).sort().join(',')))
            throw Error();
        const rawBody = decode(payload.rawBody);
        const result = { providerAccountId: payload.providerAccountId, rawBody, receivedAt: payload.receivedAt,...(payload.localSync===undefined?{}:{localSync:parseLocalSyncEventProof(payload.localSync)}) };
        if (JSON.stringify(this.#providerPayload(result)) !== plain.toString('utf8'))
            throw Error();
        return result;
    }
    catch {
        throw Error('Invalid provider receipt');
    } }
}
