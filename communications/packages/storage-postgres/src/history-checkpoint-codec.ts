import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { assertSameBinding, type ConnectionBinding } from '../../contracts/src';
export interface HistoryCheckpointEnvelope {
    format: 'communications-history-v1';
    keyVersion: string;
    nonce: string;
    ciphertext: string;
    tag: string;
}
const vector = (b: ConnectionBinding) => [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.accountId, b.generation, b.channel, b.platform, b.backend];
function fail(): never { throw Error('History checkpoint unavailable'); }
const text = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && !types.isProxy(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)) && Reflect.ownKeys(Object.getOwnPropertyDescriptors(v)).every(k => typeof k === 'string' && 'value' in Object.getOwnPropertyDescriptor(v, k)!);
function material(input: unknown): Buffer {
    if (!types.isUint8Array(input) || types.isProxy(input) || ![Uint8Array.prototype, Buffer.prototype].includes(Object.getPrototypeOf(input)) || Reflect.ownKeys(input).some(k => typeof k !== 'string' || !/^(0|[1-9][0-9]*)$/.test(k)))
        fail();
    const n = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(input);
    if (n !== 32)
        fail();
    return Buffer.from(input);
}
function copiedKeys(input: unknown): unknown[] {
    if (!Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length < 1 || input.length > 32)
        fail();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(descriptors).length !== input.length + 1)
        fail();
    const list: unknown[] = [];
    for (let i = 0; i < input.length; i++) {
        const d = descriptors[String(i)];
        if (!d || !('value' in d))
            fail();
        list.push(d.value);
    }
    return list;
}
export class HistoryCheckpointCodec {
    readonly keyVersion: string;
    #keys: Map<string, {
        encryption: Buffer;
        digest: Buffer;
    }>;
    constructor(config: {
        activeVersion: string;
        keys: readonly {
            version: string;
            encryptionKey: Uint8Array;
            digestKey: Uint8Array;
        }[];
    }) {
        if (!plain(config) || !text(config.activeVersion))
            fail();
        this.#keys = new Map();
        const used = new Set<string>();
        for (const key of copiedKeys(config.keys)) {
            if (!plain(key) || !text(key.version) || this.#keys.has(key.version))
                fail();
            const e = material(key.encryptionKey), d = material(key.digestKey);
            for (const value of [e, d]) {
                if (used.has(value.toString('hex')))
                    fail();
                used.add(value.toString('hex'));
            }
            this.#keys.set(key.version, { encryption: e, digest: d });
        }
        if (!this.#keys.has(config.activeVersion))
            fail();
        this.keyVersion = config.activeVersion;
        Object.freeze(this);
    }
    versions(): string[] { return [...this.#keys.keys()]; }
    digest(binding: ConnectionBinding, scope: string, version = this.keyVersion): string {
        assertSameBinding(binding, binding);
        if (typeof scope !== 'string' || scope.length < 1 || scope.length > 200 || !this.#keys.has(version))
            fail();
        return createHmac('sha256', this.#keys.get(version)!.digest).update(JSON.stringify(['communications.history.scope.v1', vector(binding), scope])).digest('hex');
    }
    seal(binding: ConnectionBinding, scope: string, input: unknown): HistoryCheckpointEnvelope {
        const version = this.keyVersion, aad = JSON.stringify(['communications.history.v1', vector(binding), scope, version]), body = JSON.stringify(input);
        if (typeof body !== 'string' || Buffer.byteLength(body) > 2097152)
            fail();
        const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.#keys.get(version)!.encryption, nonce);
        cipher.setAAD(Buffer.from(aad));
        return { format: 'communications-history-v1', keyVersion: version, nonce: nonce.toString('base64'), ciphertext: Buffer.concat([cipher.update(body), cipher.final()]).toString('base64'), tag: cipher.getAuthTag().toString('base64') };
    }
    open(binding: ConnectionBinding, scope: string, input: unknown): unknown {
        if (!plain(input) || input.format !== 'communications-history-v1' || !text(input.keyVersion) || !this.#keys.has(input.keyVersion) || Object.keys(input).sort().join(',') !== 'ciphertext,format,keyVersion,nonce,tag')
            fail();
        const bytes = (v: unknown, n?: number) => {
            if (typeof v !== 'string' || v.length > 2800000)
                fail();
            const value = Buffer.from(v, 'base64');
            if (value.toString('base64') !== v || n !== undefined && value.length !== n)
                fail();
            return value;
        };
        try {
            const cipher = createDecipheriv('aes-256-gcm', this.#keys.get(input.keyVersion)!.encryption, bytes(input.nonce, 12));
            cipher.setAAD(Buffer.from(JSON.stringify(['communications.history.v1', vector(binding), scope, input.keyVersion])));
            cipher.setAuthTag(bytes(input.tag, 16));
            return JSON.parse(Buffer.concat([cipher.update(bytes(input.ciphertext)), cipher.final()]).toString('utf8'));
        }
        catch {
            fail();
        }
    }
}
