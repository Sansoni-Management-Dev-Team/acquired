import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { types } from 'node:util';
import { assertSameBinding, type CanonicalIdentity, type CommunicationEvent, type ConnectionBinding } from '../../contracts/src';
import type { NormalizedWebhookOutcome } from './webhook-events';
export interface EventScope { binding: ConnectionBinding; key: string }
export interface EventPayload { outcome: Extract<NormalizedWebhookOutcome, { kind: 'event' | 'review' }>; fingerprint: string; receivedAt: string }
export interface EventEnvelope { format: 'communications-event-v1'; keyVersion: string; nonce: string; ciphertext: string; tag: string }
export interface EventCodecConfig { activeVersion: string; keys: readonly { version: string; encryptionKey: Uint8Array; digestKey: Uint8Array }[]; maxPlaintextBytes?: number }
const FORMAT = 'communications-event-v1' as const;
const bindingFields = ['applicationId','tenantId','ownerId','connectionId','accountId','generation','channel','platform','backend'] as const;
function fail(): never { throw new Error('Invalid event data'); }
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
function scope(input: unknown): EventScope {
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
const fingerprint = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const providerId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2048 && value.trim() === value && value !== '.' && value !== '..' && !/[\u0000-\u001f\u007f]/.test(value);
function reference(input: unknown, external: EventScope) {
  const raw = record(input,['binding','id']), original = binding(raw.binding);
  assertSameBinding(external.binding,original);
  if (!providerId(raw.id)) fail();
  return { binding: original, id: raw.id };
}
function identity(input: unknown, external: EventScope): CanonicalIdentity {
  const raw = record(input,['kind','value']);
  if (!providerId(raw.value)) fail();
  if (external.binding.channel === 'whatsapp') {
    if (raw.kind !== 'phone' || !/^\+[1-9]\d{6,14}$/.test(raw.value)) fail();
  } else if (external.binding.channel === 'email') {
    if (raw.kind !== 'email' || raw.value !== raw.value.toLowerCase() || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(raw.value)) fail();
    const [local,domain] = raw.value.split('@');
    if (raw.value.length > 254 || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !domain.includes('.') || domain.includes('..') || domain.split('.').some(part => part.startsWith('-') || part.endsWith('-') || part.length > 63)) fail();
  } else {
    if (raw.kind !== 'linkedin_profile') fail();
    const url = new URL(raw.value);
    if (url.protocol !== 'https:' || !['linkedin.com','www.linkedin.com'].includes(url.hostname) || !/^\/in\/[^/]+\/?$/.test(url.pathname) || url.username || url.password || url.port || url.search || url.hash) fail();
  }
  return { kind: raw.kind, value: raw.value } as CanonicalIdentity;
}
function message(input: unknown, external: EventScope, receivedAt: string): Extract<CommunicationEvent,{type:'message'}>|Extract<CommunicationEvent,{type:'email_change';change:'bounce'}> {
  if(input&&typeof input==='object'&&!types.isProxy(input)&&Object.getOwnPropertyDescriptor(input,'type')?.value==='email_change'){
   const raw=record(input,['type','reference','change','recipient','occurredAt']);
   if(external.binding.channel!=='email'||raw.change!=='bounce'||!validDate(raw.occurredAt)||Date.parse(raw.occurredAt)>Date.parse(receivedAt))fail();
   return {type:'email_change',change:'bounce',reference:reference(raw.reference,external),recipient:identity(raw.recipient,external),occurredAt:raw.occurredAt};
  }
  const raw = record(input,['type','reference','direction','sender','occurredAt'],['conversation']);
  if (raw.type !== 'message' || typeof raw.direction !== 'string' || !['inbound','outbound','self','group'].includes(raw.direction) || !validDate(raw.occurredAt) || Date.parse(raw.occurredAt) > Date.parse(receivedAt)) fail();
  return { type: 'message', reference: reference(raw.reference,external),
    ...(Object.hasOwn(raw,'conversation') ? { conversation: reference(raw.conversation,external) } : {}),
    direction: raw.direction as 'inbound'|'outbound'|'self'|'group', sender: identity(raw.sender,external), occurredAt: raw.occurredAt };
}
function payload(input: unknown, external: EventScope): EventPayload {
  const raw = record(input,['outcome','fingerprint','receivedAt']);
  if (!fingerprint(raw.fingerprint) || !validDate(raw.receivedAt)) fail();
  const kind = record(raw.outcome,['kind'],['event','eventKey','fingerprint','code']).kind;
  let outcome: EventPayload['outcome'];
  if (kind === 'event') {
    const event = record(raw.outcome,['kind','event','eventKey','fingerprint']);
    if (event.eventKey !== external.key || event.fingerprint !== raw.fingerprint) fail();
    outcome = { kind: 'event', event: message(event.event,external,raw.receivedAt), eventKey: external.key, fingerprint: raw.fingerprint };
  } else if (kind === 'review') {
    const review = record(raw.outcome,['kind','code']);
    if (typeof review.code !== 'string' || !['protocol','account_changed','identity_pending'].includes(review.code)) fail();
    outcome = { kind: 'review', code: review.code as 'protocol'|'account_changed'|'identity_pending' };
  } else fail();
  return { outcome, fingerprint: raw.fingerprint, receivedAt: raw.receivedAt };
}
/** Strict typed projection for trusted service/application coordinators. This validates data;
 * it does not authenticate ciphertext, prove a database commit or certify reply coverage. */
export function parseEventPayload(external:EventScope,input:unknown):EventPayload {
  try{return payload(input,scope(external));}catch{fail();}
}
function base64(input: unknown, max: number, length?: number, allowEmpty = false): Buffer {
  if (typeof input !== 'string' || (!allowEmpty && !input.length) || input.length > Math.ceil(max / 3) * 4 || input.length % 4 !== 0 || (input !== '' && !/^[A-Za-z0-9+/]+={0,2}$/.test(input))) fail();
  const decoded = Buffer.from(input,'base64');
  if (decoded.toString('base64') !== input || decoded.length > max || (length !== undefined && decoded.length !== length)) fail();
  return decoded;
}

/** Pure typed normalized-event/review encryption. No database, application policy or provider I/O.
 * Dedicated versioned keys and the normalized_event domain/purpose separate outbox data from wire
 * capture and send journals. Repository callers must independently recheck grants, leases, source
 * semantic keys/fingerprints and atomically commit subscriber outboxes; this codec proves none of
 * those persistence facts. Input metadata is rejected if unrecognized rather than silently copied. */
export class EventCodec {
  #keys = new Map<string,{ encryption: Buffer; digest: Buffer }>();
  #version: string;
  #max: number;
  constructor(config: EventCodecConfig) {
    try {
      const options = record(config,['activeVersion','keys'],['maxPlaintextBytes']);
      const max = options.maxPlaintextBytes ?? 65536;
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
      this.#version = options.activeVersion; this.#max = max as number;
    } catch { fail(); }
  }
  get keyVersion(): string { return this.#version; }
  #aad(external: EventScope, version: string): Buffer {
    if (!versionValid(version) || !this.#keys.has(version)) fail();
    return Buffer.from(JSON.stringify(['communications.event.aead',FORMAT,'normalized_event',version,bindingFields.map(key => external.binding[key]),external.key]),'utf8');
  }
  #plaintext(external: EventScope, input: unknown): string {
    const json = JSON.stringify(payload(input,external));
    if (Buffer.byteLength(json,'utf8') > this.#max) fail();
    return json;
  }
  encode(externalInput: EventScope, input: EventPayload): EventEnvelope {
    try {
      const external = scope(externalInput), plaintext = this.#plaintext(external,input), nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm',this.#keys.get(this.#version)!.encryption,nonce,{ authTagLength: 16 });
      cipher.setAAD(this.#aad(external,this.#version));
      const ciphertext = Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
      return { format: FORMAT, keyVersion: this.#version, nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
    } catch { fail(); }
  }
  decode(externalInput: EventScope, envelope: unknown): EventPayload {
    try {
      const external = scope(externalInput), raw = record(envelope,['format','keyVersion','nonce','ciphertext','tag']);
      if (raw.format !== FORMAT || !versionValid(raw.keyVersion)) fail();
      const aad = this.#aad(external,raw.keyVersion), nonce = base64(raw.nonce,12,12), tag = base64(raw.tag,16,16), ciphertext = base64(raw.ciphertext,this.#max);
      const decipher = createDecipheriv('aes-256-gcm',this.#keys.get(raw.keyVersion)!.encryption,nonce,{ authTagLength: 16 });
      decipher.setAAD(aad); decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext),decipher.final()]);
      const text = new TextDecoder('utf-8',{ fatal: true, ignoreBOM: true }).decode(plaintext), decoded = payload(JSON.parse(text),external);
      if (this.#plaintext(external,decoded) !== text) fail();
      return decoded;
    } catch { fail(); }
  }
  digest(externalInput: EventScope, input: EventPayload, keyVersion = this.#version): string {
    try {
      const external = scope(externalInput), aad = this.#aad(external,keyVersion), json = this.#plaintext(external,input);
      return createHmac('sha256',this.#keys.get(keyVersion)!.digest).update('communications.event.digest.v1\0').update(aad).update('\0').update(json).digest('hex');
    } catch { fail(); }
  }
}
