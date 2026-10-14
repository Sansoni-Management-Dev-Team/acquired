import { describe, expect, it } from 'vitest';
import { createCipheriv, createDecipheriv } from 'node:crypto';
import type { ConnectionBinding } from '../../contracts/src';
import type { WebhookCapture } from './reply-ingress';
import { WebhookCodec, type WebhookCodecConfig, type WebhookEnvelope } from './webhook-codec';
const binding: ConnectionBinding = { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'connection', accountId: 'account', generation: 2, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' };
const scope = () => ({ binding: { ...binding }, key: 'synthetic-webhook-key' });
const capture = (): WebhookCapture => ({ ...scope(), receivedAt: '2026-10-12T08:00:00.000Z', rawBody: Uint8Array.from([0,1,255,239,187,191,13,10,123,34,97,34,58,49,125]) });
const key = (version = 'v1', seed = 1) => ({ version, encryptionKey: new Uint8Array(32).fill(seed), digestKey: new Uint8Array(32).fill(seed + 1) });
const config = (): WebhookCodecConfig => ({ activeVersion: 'v1', keys: [key()] });
const codec = () => new WebhookCodec(config());
const invalid = /^Invalid webhook data$/;

describe('encrypted scoped webhook payload codec', () => {
  it('preserves exact bytes and capture metadata without plaintext', () => { const c = codec(), input = capture(), envelope = c.encode(input), result = c.decode(scope(), envelope); expect(result).toEqual(input); expect(result.rawBody).toBeInstanceOf(Uint8Array); expect(Object.keys(envelope).sort()).toEqual(['ciphertext','format','keyVersion','nonce','tag']); expect(envelope.format).toBe('communications-webhook-v1'); expect(envelope.keyVersion).toBe('v1'); expect(Buffer.from(envelope.nonce,'base64')).toHaveLength(12); expect(Buffer.from(envelope.tag,'base64')).toHaveLength(16); expect(JSON.stringify(envelope)).not.toContain('receivedAt'); });
  it('encrypts identical bytes with independent random nonces', () => { const c = codec(), first = c.encode(capture()), second = c.encode(capture()); expect(first.nonce).not.toBe(second.nonce); expect(first.ciphertext).not.toBe(second.ciphertext); });
  it('does not canonicalize the captured wire bytes', () => { const c = codec(), first = capture(), second = capture(); first.rawBody = Buffer.from('{"x":1}'); second.rawBody = Buffer.from('{ "x": 1 }\r\n'); expect(c.decode(scope(),c.encode(first)).rawBody).toEqual(new Uint8Array(first.rawBody)); expect(c.digest(scope(),first.rawBody)).not.toBe(c.digest(scope(),second.rawBody)); });
  it('preserves a sliced buffer without surrounding bytes and empty bodies', () => { const c = codec(), input = capture(); input.rawBody = Uint8Array.from([99,10,20,88]).subarray(1,3); expect(c.decode(scope(),c.encode(input)).rawBody).toEqual(Uint8Array.from([10,20])); input.rawBody = new Uint8Array(); expect(c.decode(scope(),c.encode(input)).rawBody).toHaveLength(0); });
  it('returns detached snapshots and freshly allocated bytes', () => { const c = codec(), input = capture(), envelope = c.encode(input); input.binding.ownerId = 'mutated'; input.rawBody.fill(0); const first = c.decode(scope(),envelope); first.binding.ownerId = 'mutated'; first.rawBody.fill(0); expect(c.decode(scope(),envelope)).toEqual(capture()); });
  it.each(['applicationId','tenantId','ownerId','connectionId','accountId','generation'] as const)('binds authentication and digest to %s', field => { const c = codec(), envelope = c.encode(capture()), changed = scope(); Object.assign(changed.binding,{[field]: field === 'generation' ? 3 : 'other'}); expect(() => c.decode(changed,envelope)).toThrow(invalid); expect(c.digest(changed,capture().rawBody)).not.toBe(c.digest(scope(),capture().rawBody)); });
  it('binds valid changed channel/platform/backend and external key', () => { const c = codec(), envelope = c.encode(capture()); for (const other of [{ ...scope(), key: 'other-key' },{ ...scope(), binding: { ...binding, backend: 'baileys' as const } },{ ...scope(), binding: { ...binding, channel: 'linkedin' as const, platform: 'linkedin' as const } }]) expect(() => c.decode(other,envelope)).toThrow(invalid); });
  it.each(['nonce','ciphertext','tag'] as const)('rejects tampered %s', field => { const c = codec(), envelope = c.encode(capture()), bytes = Buffer.from(envelope[field],'base64'); bytes[0] ^= 1; envelope[field] = bytes.toString('base64'); expect(() => c.decode(scope(),envelope)).toThrow(invalid); });
  it.each([{ format:'wrong' },{ keyVersion:'missing' },{ nonce:'non-base64!' },{ nonce:'YQ==' },{ tag:'YQ==' },{ ciphertext:'' },{ ciphertext:'YQ=' },{ extra:'private-metadata' }])('rejects malformed envelope %#', patch => { const c = codec(), envelope = c.encode(capture()); expect(() => c.decode(scope(),{...envelope,...patch})).toThrow(invalid); });
  it('rejects noncanonical base64 encodings', () => { const c = codec(), envelope = c.encode(capture()); expect(() => c.decode(scope(),{ ...envelope, tag:envelope.tag.replace(/=+$/,'') })).toThrow(invalid); });
  it('retains explicit old versions without fallback and emits active version', () => { const old = codec(), envelope = old.encode(capture()), rotated = new WebhookCodec({ activeVersion:'v2',keys:[key(),key('v2',3)] }); expect(rotated.keyVersion).toBe('v2'); expect(rotated.decode(scope(),envelope)).toEqual(capture()); expect(rotated.encode(capture()).keyVersion).toBe('v2'); expect(rotated.digest(scope(),capture().rawBody,'v1')).toBe(old.digest(scope(),capture().rawBody)); expect(rotated.digest(scope(),capture().rawBody)).not.toBe(old.digest(scope(),capture().rawBody)); expect(() => rotated.digest(scope(),capture().rawBody,'missing')).toThrow(invalid); expect(() => new WebhookCodec({ activeVersion:'v2',keys:[key('v2',3)] }).decode(scope(),envelope)).toThrow(invalid); });
  it('copies options and key material and exposes no key values', () => { const options = config(), c = new WebhookCodec(options), envelope = c.encode(capture()), digest = c.digest(scope(),capture().rawBody); options.activeVersion = 'other'; options.maxPayloadBytes = 1; options.keys[0].encryptionKey.fill(20); options.keys[0].digestKey.fill(30); (options.keys as unknown[]).splice(0); expect(c.decode(scope(),envelope)).toEqual(capture()); expect(c.digest(scope(),capture().rawBody)).toBe(digest); expect(c.keyVersion).toBe('v1'); expect(JSON.stringify(c)).toBe('{}'); });
  it.each([{ maxPayloadBytes:0 },{ maxPayloadBytes:1048577 },{ activeVersion:'missing' },{ activeVersion:'bad.version' },{ keys:[] },{ keys:[key(),key()] },{ keys:[{...key(),encryptionKey:new Uint8Array(31)}] },{ keys:[{...key(),digestKey:new Uint8Array(33)}] },{ keys:[{...key(),digestKey:key().encryptionKey}] },{ keys:[key(),{...key('v2',3),encryptionKey:key().encryptionKey}] },{ keys:[key(),{...key('v2',3),digestKey:key().digestKey}] },{ keys:[key(),{...key('v2',3),encryptionKey:key().digestKey}] },{ keys:[key(),{...key('v2',3),digestKey:key().encryptionKey}] }])('rejects invalid options, role/version key reuse %#', patch => { expect(() => new WebhookCodec({...config(),...patch})).toThrow(invalid); });
  it('enforces exact payload limit at encode, digest and decode', () => { const c = new WebhookCodec({...config(),maxPayloadBytes:8}), input = capture(); input.rawBody = new Uint8Array(8).fill(42); expect(c.decode(scope(),c.encode(input))).toEqual(input); input.rawBody = new Uint8Array(9).fill(42); expect(() => c.encode(input)).toThrow(invalid); expect(() => c.digest(scope(),input.rawBody)).toThrow(invalid); expect(() => c.decode(scope(),codec().encode(input))).toThrow(invalid); });
  it.each(['2026-02-30T08:00:00Z','2026-10-12T08:00:00+24:00','2026-10-12','2026-10-12T08:60:00Z'])('rejects invalid receivedAt %s', receivedAt => { expect(() => codec().encode({...capture(),receivedAt})).toThrow(invalid); });
  it.each([{ key:'' },{ key:'a\n' },{ key:'x'.repeat(256) },{ extra:'private' },{ rawBody:'private payload' }])('rejects malformed capture %#', patch => { expect(() => codec().encode({...capture(),...patch} as unknown as WebhookCapture)).toThrow(invalid); });
  it('rejects unknown binding fields, invalid scopes and unsafe object forms without evaluating accessors', () => { const c = codec(); expect(() => c.encode({...capture(),binding:{...binding,generation:0}})).toThrow(invalid); expect(() => c.encode({...capture(),binding:{...binding,private:'sensitive'} as ConnectionBinding})).toThrow(invalid); let invoked = false; const accessor = { ...capture(),get receivedAt(){invoked = true;return 'private';} }; expect(() => c.encode(accessor)).toThrow(invalid); expect(invoked).toBe(false); const proxied = new Proxy(capture(),{ownKeys(target){invoked=true;return Reflect.ownKeys(target);}}); expect(() => c.encode(proxied)).toThrow(invalid); expect(invoked).toBe(false); });
  it('accepts real leap-day timestamps and explicit timezone offsets unchanged', () => { const input = {...capture(),receivedAt:'2024-02-29T08:00:00+08:00'}, c = codec(); expect(c.decode(scope(),c.encode(input))).toEqual(input); });
  it('returns only sanitized errors for arbitrary external envelopes and scope', () => { const c = codec(); for (const envelope of [null,[],{body:'private-secret'},'private-secret']) expect(() => c.decode(scope(),envelope)).toThrow(invalid); expect(() => c.digest({ ...scope(),binding:null as unknown as ConnectionBinding },capture().rawBody)).toThrow(invalid); });
});

// Simulate corrupted-but-authenticated repository data using only synthetic test keys.
// Validation must reject malformed plaintext even when GCM authentication succeeds.
const fixtureAad = () => Buffer.from(JSON.stringify(['communications.webhook.aead','communications-webhook-v1','webhook_capture','v1',['app','tenant','owner','connection','account',2,'whatsapp','whatsapp','unipile'],'synthetic-webhook-key']));
function sealFixture(plaintext: Uint8Array): WebhookEnvelope {
  const nonce = Buffer.alloc(12,17), cipher = createCipheriv('aes-256-gcm',key().encryptionKey,nonce,{authTagLength:16}); cipher.setAAD(fixtureAad());
  return { format:'communications-webhook-v1',keyVersion:'v1',nonce:nonce.toString('base64'),ciphertext:Buffer.concat([cipher.update(plaintext),cipher.final()]).toString('base64'),tag:cipher.getAuthTag().toString('base64') };
}
function fixturePlaintext(): string {
  const envelope = codec().encode(capture()), decipher = createDecipheriv('aes-256-gcm',key().encryptionKey,Buffer.from(envelope.nonce,'base64'),{authTagLength:16}); decipher.setAAD(fixtureAad()); decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8');
}
describe('authenticated webhook plaintext validation', () => {
  it.each(['leading-whitespace','trailing-whitespace','duplicate-key','wrong-binding','wrong-key','extra-field','invalid-date','noncanonical-body','invalid-body','utf8-bom','invalid-utf8'])('rejects authenticated %s', variant => {
    const text = fixturePlaintext(), parsed = JSON.parse(text); let bytes: Buffer;
    if (variant === 'leading-whitespace') bytes = Buffer.from(' '+text);
    else if (variant === 'trailing-whitespace') bytes = Buffer.from(text+'\n');
    else if (variant === 'duplicate-key') bytes = Buffer.from(text.replace('"key":','"key":"other","key":'));
    else if (variant === 'utf8-bom') bytes = Buffer.concat([Buffer.from([239,187,191]),Buffer.from(text)]);
    else if (variant === 'invalid-utf8') bytes = Buffer.from([255]);
    else {
      if (variant === 'wrong-binding') parsed.binding.tenantId = 'other';
      if (variant === 'wrong-key') parsed.key = 'other';
      if (variant === 'extra-field') parsed.private = 'sensitive';
      if (variant === 'invalid-date') parsed.receivedAt = '2026-02-30T08:00:00Z';
      if (variant === 'noncanonical-body') parsed.rawBody = 'YR==';
      if (variant === 'invalid-body') parsed.rawBody = '!invalid';
      bytes = Buffer.from(JSON.stringify(parsed));
    }
    expect(() => codec().decode(scope(),sealFixture(bytes))).toThrow(invalid);
  });
  it('separates webhook capture from another encryption purpose', () => {
    const nonce = Buffer.alloc(12,18), cipher = createCipheriv('aes-256-gcm',key().encryptionKey,nonce,{authTagLength:16});
    cipher.setAAD(Buffer.from(fixtureAad().toString('utf8').replace('webhook_capture','normalized_event')));
    const envelope:WebhookEnvelope = {format:'communications-webhook-v1',keyVersion:'v1',nonce:nonce.toString('base64'),ciphertext:Buffer.concat([cipher.update(fixturePlaintext()),cipher.final()]).toString('base64'),tag:cipher.getAuthTag().toString('base64')};
    expect(() => codec().decode(scope(),envelope)).toThrow(invalid);
  });
  it('rejects configuration/capture/byte proxies without running traps or getters', () => {
    let invoked = false; const options = Object.defineProperty({...config()},'activeVersion',{enumerable:true,get(){invoked=true;return 'v1';}});
    expect(() => new WebhookCodec(options)).toThrow(invalid); expect(invoked).toBe(false);
    const proxied = new Proxy(capture().rawBody,{get(target,name){invoked=true;return Reflect.get(target,name);}});
    expect(() => codec().encode({...capture(),rawBody:proxied})).toThrow(invalid); expect(invoked).toBe(false);
  });
});
