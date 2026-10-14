import { describe, expect, it, vi } from 'vitest';
import type { ConnectionBinding } from '../../contracts/src';
import { createUnipileV1ReplyEnricher, type V1ReplyEnrichmentOptions } from './v1-reply-enrichment';
import type { UnipileHttpResult, UnipileRequestOptions } from './http-core';
const at = '2026-10-12T11:59:00Z';
const now = Date.parse('2026-10-12T12:00:00Z');
const ok = (data: unknown): UnipileHttpResult => ({ kind: 'success', status: 200, data });
function fixture(channel: 'email' | 'linkedin' = 'linkedin') {
  const binding: ConnectionBinding = { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'conn', accountId: 'account', generation: 1, channel, platform: channel === 'email' ? 'gmail' : 'linkedin', backend: 'unipile' };
  const account = { object: 'Account', id: 'source-account', type: channel === 'email' ? 'GOOGLE_OAUTH' : 'LINKEDIN', connection_params: channel === 'email' ? { mail: { username: 'owner@example.com' } } : { im: { id: 'own-provider' } }, sources: [{ id: 'source', status: 'OK' }] };
  const chat = { object: 'Chat', id: 'chat', account_id: 'source-account', account_type: 'LINKEDIN', type: 0, read_only: 0 };
  const attendees = { object: 'ChatAttendeeList', cursor: null, items: [{ object: 'ChatAttendee', id: 'own', account_id: 'source-account', provider_id: 'own-provider', is_self: 1 }, { object: 'ChatAttendee', id: 'peer', account_id: 'source-account', provider_id: 'peer-provider', is_self: 0 }] };
  const message = { object: 'Message', id: 'message', account_id: 'source-account', chat_id: 'chat', sender_id: 'peer-provider', sender_attendee_id: 'peer', timestamp: at, is_sender: 0, is_event: 0, hidden: 0, deleted: 0, message_type: 'MESSAGE' };
  const mail = { object: 'Email', kind: '2_full', id: 'mail', account_id: 'source-account', type: 'GOOGLE_OAUTH', provider_id: 'provider-mail', message_id: '<mail@example.com>', date: at, role: 'inbox', from_attendee: { identifier: 'peer@example.com', identifier_type: 'EMAIL_ADDRESS' }, to_attendees: [{ identifier: 'owner@example.com', identifier_type: 'EMAIL_ADDRESS' }], cc_attendees: [], bcc_attendees: [], headers: [{ name: 'Auto-Submitted', value: 'no' }] };
  const transport = { getAccount: vi.fn(async (id: string, options?: UnipileRequestOptions) => { void id; void options; return ok(account); }), getChat: vi.fn(async () => ok(chat)), getChatAttendees: vi.fn(async () => ok(attendees)), getMessage: vi.fn(async () => ok(message)), getEmail: vi.fn(async () => ok(mail)) };
  const resolveAlias = vi.fn(async () => ({ binding, providerAccountId: 'source-account', sourceId: 'source', providerId: 'peer-provider', product: 'classic', identity: { kind: 'linkedin_profile' as const, value: 'https://www.linkedin.com/in/peer' } }));
  const options: V1ReplyEnrichmentOptions = { binding, providerAccountId: 'source-account', sourceId: 'source', eventsFrom: '2026-10-12T11:00:00Z', now: () => now, transport, verifyOwner: async () => true, resolveAlias, ...(channel === 'email' ? { channel, ownerAddresses: ['owner@example.com'] } : { channel, ownerProviderId: 'own-provider', product: 'classic' }) };
  const raw: Record<string, unknown> = channel === 'email' ? { event: 'mail_received', account_id: 'source-account', email_id: 'mail', date: at, provider_id: mail.provider_id, message_id: mail.message_id } : { event: 'message_received', account_id: 'source-account', account_type: 'LINKEDIN', account_info: { type: 'LINKEDIN', user_id: 'own-provider', feature: 'classic' }, message_id: 'message', chat_id: 'chat', timestamp: at, sender: { attendee_id: 'peer', attendee_provider_id: 'peer-provider' } };
  return { options, binding, raw, transport, resolveAlias, mail, attendees, account };
}
describe('independent reply enrichment protocol review', () => {
  it.each(['email', 'linkedin'] as const)('reaches actual verified %s event before protocol faults are injected', async channel => {
    const f = fixture(channel);
    expect((await createUnipileV1ReplyEnricher(f.options).normalize(f.raw, f.binding)).kind).toBe('event');
  });
  it('does not certify a full email from a different provider platform', async () => {
    const f = fixture('email');
    f.raw.type = 'GOOGLE_OAUTH';
    f.mail.type = 'OUTLOOK';
    expect((await createUnipileV1ReplyEnricher(f.options).normalize(f.raw, f.binding)).kind).toBe('review');
  });
  it.each(['provider_id', 'message_id'])('reviews contradictory webhook/full-email %s', async field => {
    const f = fixture('email');
    f.raw[field] = 'contradictory-email-reference';
    expect((await createUnipileV1ReplyEnricher(f.options).normalize(f.raw, f.binding)).kind).toBe('review');
  });
  it('enforces elapsed deadline before starting alias work even when a provider callback blocks the event loop', async () => {
    const f = fixture();
    f.options.deadlineMs = 5;
    f.transport.getAccount.mockImplementationOnce(async () => {
      const end = performance.now() + 25;
      while (performance.now() < end) { /* bounded simulation of synchronous decode/provider work */ }
      return ok(f.account);
    });
    await expect(createUnipileV1ReplyEnricher(f.options).normalize(f.raw, f.binding)).rejects.toMatchObject({ code: 'timeout' });
    expect(f.resolveAlias).not.toHaveBeenCalled();
  });
  it('never calls aliases after a timed-out provider read eventually resolves', async () => {
    const f = fixture();
    f.options.deadlineMs = 5;
    let release!: (result: UnipileHttpResult) => void;
    f.transport.getAccount.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await expect(createUnipileV1ReplyEnricher(f.options).normalize(f.raw, f.binding)).rejects.toMatchObject({ code: 'timeout' });
    release(ok(f.account));
    await new Promise(resolve => setImmediate(resolve));
    expect(f.resolveAlias).not.toHaveBeenCalled();
    expect(f.transport.getChat).not.toHaveBeenCalled();
  });
});
