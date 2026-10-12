import { describe, expect, it } from 'vitest';
import { createCipheriv } from 'node:crypto';
import type { OperationSnapshot } from '../../contracts/src';
import { JournalCodec } from './journal-codec';

const snapshot: OperationSnapshot = { key: 'review-operation', payloadDigest: 'a'.repeat(64), operation: 'message', binding: { applicationId: 'review-app', tenantId: 'review-tenant', ownerId: 'review-owner', connectionId: 'review-connection', accountId: 'review-account', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' } };
const bytes = (value: number) => new Uint8Array(32).fill(value);
const material = (version: string, encryption = 1, digest = 2) => ({ version, encryptionKey: bytes(encryption), digestKey: bytes(digest) });
const codec = () => new JournalCodec({ activeVersion: 'old', keys: [material('old')] });
const context = { recipient: { kind: 'phone', value: '+61400000000' }, conversation: { id: 'review-chat' } };

describe('independent journal crypto boundaries', () => {
  it('does not reuse an encryption key as another retained version digest key', () => {
    expect(() => new JournalCodec({ activeVersion: 'new', keys: [material('old', 1, 2), material('new', 3, 1)] })).toThrow('Invalid journal data');
    expect(() => new JournalCodec({ activeVersion: 'new', keys: [material('old', 1, 2), material('new', 2, 3)] })).toThrow('Invalid journal data');
  });

  it('authenticates the explicit key version even when retained encryption bytes match', () => {
    const original = codec();
    const envelope = original.encode(snapshot, 'context', context);
    const retained = new JournalCodec({ activeVersion: 'new', keys: [material('old'), material('new', 1, 3)] });
    expect(retained.decode(snapshot, 'context', envelope)).toEqual(context);
    expect(() => retained.decode(snapshot, 'context', { ...envelope, keyVersion: 'new' })).toThrow(/^Invalid journal data$/);
  });

  it.each([
    { ...snapshot.binding, backend: 'baileys' as const },
    { ...snapshot.binding, channel: 'linkedin' as const, platform: 'linkedin' as const },
    { ...snapshot.binding, channel: 'email' as const, platform: 'gmail' as const },
  ])('authenticates channel, platform and backend tuple changes (%#)', binding => {
    const c = codec();
    const encrypted = c.encode(snapshot, 'context', context);
    expect(() => c.decode({ ...snapshot, binding }, 'context', encrypted)).toThrow(/^Invalid journal data$/);
  });

  it('uses canonical framing for delimiter-like identities and structured payloads', () => {
    const c = codec();
    const first = { ...snapshot, binding: { ...snapshot.binding, applicationId: 'app:tenant', tenantId: 'owner' } };
    const second = { ...snapshot, binding: { ...snapshot.binding, applicationId: 'app', tenantId: 'tenant:owner' } };
    expect(c.digest(first, 'context', context)).not.toBe(c.digest(second, 'context', context));
    expect(c.digest(snapshot, 'context', { nested: 'null' })).not.toBe(c.digest(snapshot, 'context', { nested: null }));
    expect(c.digest(snapshot, 'context', ['a', 'b'])).not.toBe(c.digest(snapshot, 'context', 'a,b'));
  });

  it('rejects noncanonical base64 envelope fields instead of silently normalizing them', () => {
    const c = codec();
    const envelope = c.encode(snapshot, 'context', context);
    // Padded/URL-safe base64 is not interchangeable with the codec's canonical envelope.
    expect(() => c.decode(snapshot, 'context', { ...envelope, nonce: `${envelope.nonce}\n` })).toThrow(/^Invalid journal data$/);
    expect(() => c.decode(snapshot, 'context', { ...envelope, tag: envelope.tag.slice(0, -1) })).toThrow(/^Invalid journal data$/);
  });

  function externalEnvelope(plaintext: Buffer) {
    // Independent v1 producer fixture: explicit AAD and synthetic-only nonce/key.
    const aad = Buffer.from('{"domain":"communications.journal.aead","format":"communications-journal-v1","keyVersion":"old","purpose":"context","snapshot":{"binding":{"accountId":"review-account","applicationId":"review-app","backend":"unipile","channel":"whatsapp","connectionId":"review-connection","generation":1,"ownerId":"review-owner","platform":"whatsapp","tenantId":"review-tenant"},"key":"review-operation","operation":"message","payloadDigest":"' + 'a'.repeat(64) + '"}}');
    const nonce = Buffer.alloc(12, 7);
    const cipher = createCipheriv('aes-256-gcm', bytes(1), nonce, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { format: 'communications-journal-v1', keyVersion: 'old', nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  }

  it('accepts independently produced canonical authenticated bytes', () => {
    expect(codec().decode(snapshot, 'context', externalEnvelope(Buffer.from('{"synthetic":"payload"}')))).toEqual({ synthetic: 'payload' });
  });

  it('rejects an authenticated leading UTF-8 BOM instead of stripping bytes before canonical validation', () => {
    const plaintext = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"synthetic":"payload"}')]);
    expect(() => codec().decode(snapshot, 'context', externalEnvelope(plaintext))).toThrow(/^Invalid journal data$/);
  });

  it('rejects malformed authenticated UTF-8 and duplicate JSON keys with sanitized errors', () => {
    const c = codec();
    expect(() => c.decode(snapshot, 'context', externalEnvelope(Buffer.from([0xc0, 0xaf])))).toThrow(/^Invalid journal data$/);
    expect(() => c.decode(snapshot, 'context', externalEnvelope(Buffer.from('{"synthetic":"first","synthetic":"secret"}')))).toThrow(/^Invalid journal data$/);
  });
});
