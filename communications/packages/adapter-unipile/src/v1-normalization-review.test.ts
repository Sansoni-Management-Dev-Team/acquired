import { describe, expect, it } from 'vitest';
import type { ConnectionBinding, MessageSubmission } from '../../contracts/src';
import { normalizeV1InvitationSent, normalizeV1MessageSent } from './v1-normalization';

const binding: ConnectionBinding = { applicationId: 'synthetic-app', tenantId: 'synthetic-tenant', ownerId: 'synthetic-owner', connectionId: 'synthetic-connection', accountId: 'service-account', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' };
const input: MessageSubmission = { snapshot: { binding, key: 'operation', operation: 'message', payloadDigest: 'digest' }, message: { recipient: { kind: 'phone', value: '+61400000000' }, text: 'Synthetic message', conversation: { binding, id: 'original-chat' } } };
const invitationBinding: ConnectionBinding = { ...binding, channel: 'linkedin', platform: 'linkedin' };
const invitation: MessageSubmission = { snapshot: { ...input.snapshot, binding: invitationBinding, operation: 'invitation' }, message: { recipient: { kind: 'linkedin_profile', value: 'https://www.linkedin.com/in/synthetic-test' }, text: 'Synthetic invitation' } };

describe('independent v1 normalized receipt protocol review', () => {
  it.each(['receipt\u0000id', 'receipt\nid', '.', '..', 'x'.repeat(2049)])('keeps unaddressable message/action IDs unknown (%#)', id => {
    expect(normalizeV1MessageSent({ object: 'MessageSent', message_id: id }, input)).toEqual({ status: 'unknown' });
    expect(normalizeV1InvitationSent({ object: 'UserInvitationSent', invitation_id: id }, invitation)).toEqual({ status: 'unknown' });
  });

  it('does not certify a receipt with an explicit contradictory chat extension', () => {
    expect(normalizeV1MessageSent({ object: 'MessageSent', message_id: 'valid-id', chat_id: 'another-chat' }, input)).toEqual({ status: 'unknown' });
  });

  it('accepts opaque escaped namespaces without pretending a provider ID is the service account', () => {
    expect(normalizeV1MessageSent({ object: 'MessageSent', message_id: 'opaque/%encoded' }, input)).toMatchObject({ status: 'submitted', receipt: { message: { id: 'opaque/%encoded', binding } } });
    expect(normalizeV1InvitationSent({ object: 'UserInvitationSent', invitation_id: 'opaque/%encoded' }, invitation)).toMatchObject({ status: 'submitted', receipt: { operation: { id: 'opaque/%encoded', binding: invitationBinding } } });
  });
});
