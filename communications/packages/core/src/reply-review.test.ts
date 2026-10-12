import { describe, expect, it, vi } from 'vitest';
import type { CommunicationEvent, ConnectionBinding } from '../../contracts/src';
import { createReplyProcessor, type ClaimedWebhook } from './reply-ingress';

const binding: ConnectionBinding = { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'connection', accountId: 'account', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' };
const message = (chat: string, at = '2026-10-12T09:00:00Z'): Extract<CommunicationEvent, { type: 'message' }> => ({ type: 'message', reference: { binding, id: 'chat-local-id' }, conversation: { binding, id: chat }, direction: 'inbound', sender: { kind: 'phone', value: '+61412345678' }, occurredAt: at });
function fixture() {
  const record: ClaimedWebhook = { binding, key: 'delivery-one', token: 'lease', receivedAt: '2026-10-12T10:00:00Z', rawBody: Buffer.from('{"event":"message_received"}') };
  const normalize = vi.fn(async () => ({ kind: 'event' as const, event: message('chat-one') }));
  const finish = vi.fn(async (input: { record: ClaimedWebhook }) => ({ binding, key: input.record.key, committed: true }));
  const api = createReplyProcessor({ binding, journal: { claim: async () => ({ kind: 'claimed', record }), finish }, normalize, resolve: async () => [] });
  return { record, normalize, finish, api };
}
describe('independent semantic reply dedupe review', () => {
  it('keeps provider chat-local message IDs in distinct conversation namespaces', async () => {
    const f = fixture();
    await f.api.process('delivery-one');
    f.record.key = 'delivery-two';
    f.normalize.mockResolvedValueOnce({ kind: 'event', event: message('chat-two') });
    await f.api.process('delivery-two');
    const writes = f.finish.mock.calls.map(([input]) => input as { eventKey?: string });
    expect(writes[0].eventKey).not.toBe(writes[1].eventKey);
  });
  it.each(['sender', 'reference', 'conversation'] as const)('rejects undeclared nested %s metadata rather than persisting it', async field => {
    const f = fixture();
    const e = message('chat-one');
    Object.assign(e[field]!, { privateMessageBody: 'private accidental content' });
    f.normalize.mockResolvedValueOnce({ kind: 'event', event: e });
    expect(await f.api.process('delivery-one')).toEqual({ status: 'processed', decision: { action: 'review', code: 'protocol' } });
    expect(f.finish.mock.calls[0][0]).not.toHaveProperty('event');
  });
  it('reviews malformed direction arrays instead of silently classifying them as non-replies', async () => {
    const f = fixture();
    const e = message('chat-one');
    Object.assign(e, { direction: ['inbound'] });
    f.normalize.mockResolvedValueOnce({ kind: 'event', event: e });
    expect(await f.api.process('delivery-one')).toEqual({ status: 'processed', decision: { action: 'review', code: 'protocol' } });
    expect(f.finish.mock.calls[0][0]).not.toHaveProperty('event');
  });
  it('recognizes the same event instant across equivalent RFC3339 offset representations', async () => {
    const f = fixture();
    await f.api.process('delivery-one');
    f.record.key = 'delivery-two';
    f.normalize.mockResolvedValueOnce({ kind: 'event', event: message('chat-one', '2026-10-12T17:00:00+08:00') });
    await f.api.process('delivery-two');
    const writes = f.finish.mock.calls.map(([input]) => input as { eventKey?: string; eventFingerprint?: string });
    expect(writes[0].eventKey).toBe(writes[1].eventKey);
    expect(writes[0].eventFingerprint).toBe(writes[1].eventFingerprint);
  });
});
