import { describe, expect, it, vi } from 'vitest';
import type { ConnectionRecord, MessageSubmission } from '../../contracts/src';
import { messageDigest } from '../../core/src/message-digest';
import { createUnipileV1MessagingAdapter } from './v1-adapter';

function fixture(invitation = false) {
  const binding = { applicationId: 'review-app', tenantId: 'review-tenant', ownerId: 'review-owner', connectionId: 'review-connection', accountId: 'service-account', generation: 1, backend: 'unipile' as const, channel: invitation ? 'linkedin' as const : 'whatsapp' as const, platform: invitation ? 'linkedin' as const : 'whatsapp' as const };
  const recipient = invitation ? { kind: 'linkedin_profile' as const, value: 'https://www.linkedin.com/in/synthetic-review' } : { kind: 'phone' as const, value: '+61400000000' };
  const conversation = { binding, id: 'original-chat' };
  const connection: ConnectionRecord = { binding, status: 'connected', providerAccountId: 'provider-account', capabilities: { messaging: { send: true, durableIdempotency: false, receiptLookup: true }, events: { read: false, history: false, realtime: false }, ...(invitation ? { linkedin: { resolveProfile: false, relationships: false, invitations: true } } : {}) } };
  const operation = invitation ? 'invitation' as const : 'message' as const;
  const message = { recipient, text: 'Synthetic review', ...(invitation ? {} : { conversation }) };
  const input: MessageSubmission = { snapshot: { binding, key: 'operation', operation, payloadDigest: messageDigest(operation, message) }, message };
  const transport = {
    getAccount: vi.fn(async () => ({ kind: 'success' as const, status: 200, data: { object: 'Account', id: 'provider-account', type: invitation ? 'LINKEDIN' : 'WHATSAPP', connection_params: { im: {} }, sources: [{ id: 'source', status: 'OK' }] } })),
    getChat: vi.fn(async () => ({ kind: 'success' as const, status: 200, data: { object: 'Chat', id: 'original-chat', account_id: 'provider-account', type: 0, read_only: 0 } })),
    getMessage: vi.fn(async () => ({ kind: 'success' as const, status: 200, data: { object: 'Message', id: 'original-message', account_id: 'provider-account', chat_id: 'original-chat', is_sender: 1, is_event: 0, hidden: 0, deleted: 0, timestamp: '2026-10-12T01:00:00Z' } })),
    sendMessage: vi.fn(async () => ({ kind: 'success' as const, status: 201, data: { object: 'MessageSent', message_id: 'new-message' } })),
    invite: vi.fn(async () => ({ kind: 'success' as const, status: 200, data: { object: 'UserInvitationSent', invitation_id: 'new-invitation' } })),
  };
  const mapping = structuredClone({ providerAccountId: 'provider-account', conversation, recipient });
  const verifyChatRecipient = vi.fn(async () => mapping);
  const verifyInvitationRecipient = vi.fn(async () => ({ providerAccountId: 'provider-account', providerId: 'ACoSynthetic', recipient: structuredClone(recipient) }));
  const options = { connection, providerAccountId: 'provider-account', sourceId: 'source', transport, verifyChatRecipient, verifyInvitationRecipient };
  const adapter = createUnipileV1MessagingAdapter(options);
  return { binding, input, recipient, conversation, transport, mapping, options, adapter };
}

describe('independent v1 adapter callback and response provenance characterization', () => {
  it('isolates verifier argument mutation from dispatch content and original chat', async () => {
    const f = fixture();
    const options = { ...f.options, verifyChatRecipient: vi.fn(async (request: { snapshot: MessageSubmission['snapshot']; recipient: MessageSubmission['message']['recipient']; conversation?: MessageSubmission['message']['conversation'] }) => {
      request.snapshot.binding.ownerId = 'mutated-owner';
      request.recipient.value = '+61400000001';
      request.conversation!.id = 'mutated-chat';
      return f.mapping;
    }) };
    expect(await createUnipileV1MessagingAdapter(options).submit(f.input)).toMatchObject({ status: 'submitted', receipt: { conversation: f.conversation, recipient: f.recipient } });
    expect(f.transport.sendMessage).toHaveBeenCalledExactlyOnceWith('provider-account', 'original-chat', { text: 'Synthetic review' });
  });

  it('detaches verified lookup mapping before asynchronous provider retrieval', async () => {
    const f = fixture();
    const original = f.transport.getMessage.getMockImplementation()!;
    f.transport.getMessage.mockImplementationOnce(async () => {
      f.mapping.conversation.id = 'mutated-map-chat';
      f.mapping.recipient.value = '+61400000001';
      return original();
    });
    const result = await f.adapter.lookup({ snapshot: f.input.snapshot, message: { binding: f.binding, id: 'original-message' }, expectedRecipient: f.recipient });
    expect(result).toMatchObject({ status: 'submitted', receipt: { message: { id: 'original-message' }, conversation: { id: 'original-chat' }, recipient: f.recipient } });
    expect(f.transport.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps wrong HTTP success status unknown after a single possible write', async () => {
    const f = fixture();
    f.transport.sendMessage.mockResolvedValueOnce({ kind: 'success', status: 200, data: { object: 'MessageSent', message_id: 'new-message' } });
    expect(await f.adapter.submit(f.input)).toEqual({ status: 'unknown' });
    expect(f.transport.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('requires both the recorded source and exact provider account before an invitation write', async () => {
    const f = fixture(true);
    f.transport.getAccount.mockResolvedValueOnce({ kind: 'success', status: 200, data: { object: 'Account', id: 'another-account', type: 'LINKEDIN', connection_params: { im: {} }, sources: [{ id: 'source', status: 'OK' }] } });
    expect(await f.adapter.submit(f.input)).toEqual({ status: 'review', code: 'account_changed' });
    expect(f.transport.invite).not.toHaveBeenCalled();
  });
});
