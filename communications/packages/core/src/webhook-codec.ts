import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { types } from 'node:util';
import { assertSameBinding, type ConnectionBinding } from '../../contracts/src';
import type { WebhookCapture } from './reply-ingress';

export interface WebhookScope { binding: ConnectionBinding; key: string }
export interface WebhookEnvelope { format: 'communications-webhook-v1'; keyVersion: string; nonce: string; ciphertext: string; tag: string }
export interface WebhookCodecConfig { activeVersion: string; keys: readonly { version: string; encryptionKey: Uint8Array; digestKey: Uint8Array }[]; maxPayloadBytes?: number }
const FORMAT = 'communications-webhook-v1' as const;
const bindingFields = ['applicationId','tenantId','ownerId','connectionId','accountId','generation','channel','platform','backend'] as const;
function fail(): never { throw new Error('Invalid webhook data'); }
const versionValid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 255 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);

/** Validate descriptors before reading values; arbitrary input must not execute getters or proxies. */
function record(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || types.isProxy(input)) fail();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string' || ![...required,...optional].includes(key)) || required.some(key => !Object.hasOwn(descriptors,key))) fail();
  const copied: Record<string,unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (!('value' in descriptor) || !descriptor.enumerable) fail();
    copied[key] = descriptor.value;
  }
  return copied;
}
function list(input: unknown): unknown[] {
  if (!Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length < 1 || input.length > 32) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1) fail();
  const copied: unknown[] = [];
  for (let index = 0; index < input.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail();
    copied.push(descriptor.value);
  }
  return copied;
}
function bytes(input: unknown, max: number): Buffer {
  if (!types.isUint8Array(input) || types.isProxy(input)) fail();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) fail();
  // Read the intrinsic byte length, rejecting oversized data before enumerating byte indexes.
  const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength')!.get!.call(input) as number;
  if (byteLength > max) fail();
  // Custom metadata/iteration hooks on otherwise valid byte arrays are not accepted.
  if (Reflect.ownKeys(input).some(key => typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key))) fail();
  return Buffer.from(input);
}
function binding(input: unknown): ConnectionBinding {
  const raw = record(input,bindingFields);
  for (const key of bindingFields) if (key !== 'generation' && !identifier(raw[key])) fail();
  const result = { applicationId: raw.applicationId, tenantId: raw.tenantId, ownerId: raw.ownerId, connectionId: raw.connectionId, accountId: raw.accountId, generation: raw.generation, channel: raw.channel, platform: raw.platform, backend: raw.backend } as ConnectionBinding;
  assertSameBinding(result,result);
  return result;
}
function scope(input: unknown): WebhookScope {
  const raw = record(input,['binding','key']);
  if (!identifier(raw.key)) fail();
  return { binding: binding(raw.binding), key: raw.key };
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [year,month,day,hour,minute,second] = match.slice(1,7).map(Number), zone = match[7];
  return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year,month,0)).getUTCDate() && hour <= 23 && minute <= 59 && second <= 59 &&
    (zone === 'Z' || (Number(zone.slice(1,3)) <= 23 && Number(zone.slice(4,6)) <= 59)) && Number.isFinite(Date.parse(value));
}
function capture(input: unknown, max: number): WebhookCapture {
  const raw = record(input,['binding','key','rawBody','receivedAt']);
  const validated = scope({ binding: raw.binding, key: raw.key });
  if (!validDate(raw.receivedAt)) fail();
  return { ...validated, rawBody: new Uint8Array(bytes(raw.rawBody,max)), receivedAt: raw.receivedAt };
}
function captureJson(input: WebhookCapture): string {
  // Fixed field order and exact known types define the sole canonical plaintext representation.
  return JSON.stringify({ binding: input.binding, key: input.key, rawBody: Buffer.from(input.rawBody).toString('base64'), receivedAt: input.receivedAt });
}
function base64(input: unknown, max: number, length?: number, allowEmpty = false): Buffer {
  if (typeof input !== 'string' || (!allowEmpty && !input.length) || input.length > Math.ceil(max / 3) * 4 || input.length % 4 !== 0 || (input !== '' && !/^[A-Za-z0-9+/]+={0,2}$/.test(input))) fail();
  const decoded = Buffer.from(input,'base64');
  if (decoded.toString('base64') !== input || decoded.length > max || (length !== undefined && decoded.length !== length)) fail();
  return decoded;
}

/** Pure encrypted wire-payload codec, with no provider/env/persistence access.
 * Use dedicated independent encryption/digest keys, retaining explicit versions during rotation.
 * Every encryption authenticates external exact binding, receipt key, version and capture purpose;
 * wire bytes and receivedAt are preserved in authenticated canonical plaintext. This is not durable
 * capture/ack, freshness or worker fencing proof; the repository must enforce those separately. */
export class WebhookCodec {
  #keys = new Map<string,{ encryption: Buffer; digest: Buffer }>();
  #version: string;
  #max: number;
  constructor(config: WebhookCodecConfig) {
    try {
      const options = record(config,['activeVersion','keys'],['maxPayloadBytes']);
      const max = options.maxPayloadBytes ?? 1048576;
      if (!versionValid(options.activeVersion) || !Number.isSafeInteger(max) || (max as number) < 1 || (max as number) > 1048576) fail();
      for (const input of list(options.keys)) {
        const key = record(input,['version','encryptionKey','digestKey']);
        if (!versionValid(key.version) || this.#keys.has(key.version)) fail();
        const encryption = bytes(key.encryptionKey,32), digest = bytes(key.digestKey,32);
        if (encryption.length !== 32 || digest.length !== 32 || timingSafeEqual(encryption,digest)) fail();
        for (const retained of this.#keys.values()) {
          if ([retained.encryption,retained.digest].some(previous => timingSafeEqual(previous,encryption) || timingSafeEqual(previous,digest))) fail();
        }
        this.#keys.set(key.version,{ encryption,digest });
      }
      if (!this.#keys.has(options.activeVersion)) fail();
      this.#version = options.activeVersion;
      this.#max = max as number;
    } catch { fail(); }
  }
  get keyVersion(): string { return this.#version; }
  #aad(external: WebhookScope, version: string): Buffer {
    if (!versionValid(version) || !this.#keys.has(version)) fail();
    return Buffer.from(JSON.stringify(['communications.webhook.aead',FORMAT,'webhook_capture',version,bindingFields.map(key => external.binding[key]),external.key]),'utf8');
  }
  encode(input: WebhookCapture): WebhookEnvelope {
    try {
      const validated = capture(input,this.#max), external = { binding: validated.binding, key: validated.key }, nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm',this.#keys.get(this.#version)!.encryption,nonce,{ authTagLength: 16 });
      cipher.setAAD(this.#aad(external,this.#version));
      const ciphertext = Buffer.concat([cipher.update(captureJson(validated),'utf8'),cipher.final()]);
      return { format: FORMAT, keyVersion: this.#version, nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
    } catch { fail(); }
  }
  decode(externalInput: WebhookScope, envelope: unknown): WebhookCapture {
    try {
      const external = scope(externalInput), raw = record(envelope,['format','keyVersion','nonce','ciphertext','tag']);
      if (raw.format !== FORMAT || !versionValid(raw.keyVersion)) fail();
      const aad = this.#aad(external,raw.keyVersion), nonce = base64(raw.nonce,12,12), tag = base64(raw.tag,16,16);
      const maxPlaintext = Math.ceil(this.#max / 3) * 4 + 16384;
      const ciphertext = base64(raw.ciphertext,maxPlaintext);
      const decipher = createDecipheriv('aes-256-gcm',this.#keys.get(raw.keyVersion)!.encryption,nonce,{ authTagLength: 16 });
      decipher.setAAD(aad); decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext),decipher.final()]);
      const text = new TextDecoder('utf-8',{ fatal: true, ignoreBOM: true }).decode(plaintext);
      const decoded = record(JSON.parse(text),['binding','key','rawBody','receivedAt']);
      const result = capture({ ...decoded, rawBody: base64(decoded.rawBody,this.#max,undefined,true) },this.#max);
      assertSameBinding(external.binding,result.binding);
      if (result.key !== external.key || captureJson(result) !== text) fail();
      return result;
    } catch { fail(); }
  }
  digest(externalInput: WebhookScope, rawBody: Uint8Array, keyVersion = this.#version): string {
    try {
      const external = scope(externalInput), body = bytes(rawBody,this.#max), aad = this.#aad(external,keyVersion);
      return createHmac('sha256',this.#keys.get(keyVersion)!.digest).update('communications.webhook.digest.v1\0').update(aad).update('\0').update(body).digest('hex');
    } catch { fail(); }
  }
}
