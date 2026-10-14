import { describe, expect, it } from 'vitest';
import type { ConnectionBinding } from '../../contracts/src';
import { normalizeV1ReplyEvent, type V1ReplyEventContext } from './v1-events';
const binding: ConnectionBinding = { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'connection', accountId: 'account', generation: 1, channel: 'linkedin', platform: 'linkedin', backend: 'unipile' };
function social() {
  const evidence = { binding: { ...binding }, providerAccountId: 'provider-account' };
  const context: Extract<V1ReplyEventContext, { channel: 'linkedin' | 'whatsapp' }> = { ...evidence, channel: 'linkedin', ownerProviderId: 'owner-provider', product: 'classic', timestampBounds: { from: '2026-10-12T08:00:00Z', through: '2026-10-12T10:00:00Z' }, chat: { ...evidence, id: 'chat', type: 'direct', participantProviderIds: ['owner-provider', 'peer-provider'] }, sender: { ...evidence, providerId: 'peer-provider', identity: { kind: 'linkedin_profile', value: 'https://www.linkedin.com/in/peer' } } };
  const raw = { event: 'message_received', account_id: evidence.providerAccountId, account_type: 'LINKEDIN', account_info: { type: 'LINKEDIN', user_id: context.ownerProviderId, feature: 'classic' }, message_id: 'message', chat_id: 'chat', timestamp: '2026-10-12T09:00:00Z', sender: { attendee_provider_id: 'peer-provider' } };
  return { raw, context };
}
describe('independent Unipile event normalization review', () => {
  it('never includes undeclared identity metadata in content-free event output', () => {
    const { raw, context } = social();
    Object.assign(context.sender!.identity, { privateContent: 'accidental private context' });
    const result = normalizeV1ReplyEvent(raw, context);
    expect(JSON.stringify(result)).not.toContain('accidental private context');
    if (result.kind === 'event' && result.event.type === 'message') expect(Object.keys(result.event.sender).sort()).toEqual(['kind', 'value']);
  });
  it('rejects undocumented LinkedIn products even when raw and context strings match', () => {
    const { raw, context } = social();
    context.product = 'invented_product' as typeof context.product;
    raw.account_info.feature = 'invented_product';
    expect(normalizeV1ReplyEvent(raw, context).kind).toBe('review');
  });
  it('rejects incomplete header evidence and contradictory exact lookup IDs', () => {
    const emailBinding: ConnectionBinding = { ...binding, channel: 'email', platform: 'gmail' };
    const evidence = { binding: emailBinding, providerAccountId: 'provider-account' };
    const context: V1ReplyEventContext = { ...evidence, channel: 'email', ownerAddresses: ['owner@example.com'], timestampBounds: { from: '2026-10-12T08:00:00Z', through: '2026-10-12T10:00:00Z' }, email: { ...evidence, id: 'email', complete: true, headersComplete: false as true, mail: { object: 'Email', id: 'email', account_id: 'provider-account', date: '2026-10-12T09:00:00Z', is_complete: true, role: 'inbox', from_attendee: { identifier: 'peer@example.com', identifier_type: 'EMAIL_ADDRESS' }, to_attendees: [{ identifier: 'owner@example.com', identifier_type: 'EMAIL_ADDRESS' }], cc_attendees: [], bcc_attendees: [], headers: [] } } };
    const raw = { account_id: 'provider-account', event: 'mail_received', email_id: 'email', date: '2026-10-12T09:00:00Z' };
    expect(normalizeV1ReplyEvent(raw, context).kind).toBe('review');
    context.email!.headersComplete = true;
    (context.email!.mail as { id: string }).id = 'wrong-email';
    expect(normalizeV1ReplyEvent(raw, context)).toEqual({ kind: 'review', code: 'account_changed' });
  });
});
