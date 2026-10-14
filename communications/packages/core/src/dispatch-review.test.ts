import { describe, expect, it, vi } from 'vitest';
import type { ConnectionBinding, DeliveryOutcome, MessageSubmission, MessagingAdapter, ReceiptLookup } from '../../contracts/src';
import { createDispatchCoordinator, type DispatchJournalPort, type DispatchRecord } from './dispatch';
import { messageDigest } from './message-digest';

function fixture(invitation = false) {
  const binding: ConnectionBinding = { applicationId: 'review-app', tenantId: 'review-tenant', ownerId: 'review-owner', connectionId: 'review-connection', accountId: 'review-account', generation: 1, channel: invitation ? 'linkedin' : 'whatsapp', platform: invitation ? 'linkedin' : 'whatsapp', backend: 'unipile' };
  const recipient = invitation ? { kind: 'linkedin_profile' as const, value: 'https://www.linkedin.com/in/synthetic-review' } : { kind: 'phone' as const, value: '+61400000000' };
  const operation = invitation ? 'invitation' as const : 'message' as const;
  const message = { recipient, text: 'Synthetic review', ...(invitation ? {} : { conversation: { binding, id: 'original-chat' } }) };
  const input: MessageSubmission = { snapshot: { binding, operation, key: 'original-operation', payloadDigest: messageDigest(operation, message) }, message };
  const expected: DeliveryOutcome = invitation ? { status: 'submitted', receipt: { operation: { binding, id: 'original-invitation' }, recipient } } : { status: 'submitted', receipt: { message: { binding, id: 'original-message' }, conversation: { binding, id: 'original-chat' }, recipient } };
  let stored: DispatchRecord | null = null;
  const journal: DispatchJournalPort = {
    claim: vi.fn<DispatchJournalPort['claim']>(async request => stored ? { kind: 'existing', record: structuredClone(stored) } : { kind: 'claimed', token: 'claim-token', record: { ...structuredClone(request), state: 'claimed' } }),
    beginDispatch: vi.fn<DispatchJournalPort['beginDispatch']>(async request => ({ kind: 'admitted', record: { ...structuredClone(request.record), state: 'dispatching', outcome: undefined } })),
    complete: vi.fn<DispatchJournalPort['complete']>(async request => {
      stored = request.outcome.status === 'unknown' ? { ...structuredClone(request.record), state: 'unknown', outcome: request.outcome } : { ...structuredClone(request.record), state: 'completed', outcome: request.outcome };
      return structuredClone(stored!);
    }),
    get: vi.fn<DispatchJournalPort['get']>(async () => structuredClone(stored)),
    reconcile: vi.fn<DispatchJournalPort['reconcile']>(async request => ({ ...structuredClone(request.record), state: 'completed', outcome: request.outcome as Exclude<DeliveryOutcome, { status: 'unknown' }> })),
  };
  const adapter: MessagingAdapter = { ready: vi.fn<MessagingAdapter['ready']>(async () => ({ status: 'ready' })), submit: vi.fn<MessagingAdapter['submit']>(async () => expected), lookup: vi.fn<MessagingAdapter['lookup']>(async () => expected) };
  const coordinator = createDispatchCoordinator(binding, adapter, journal);
  return { binding, input, recipient, expected, adapter, journal, coordinator, get stored() { return stored; }, set stored(value: DispatchRecord | null) { stored = structuredClone(value); } };
}

describe('independent dispatch receipt provenance review', () => {
  it('does not certify a same-account receipt belonging to another chat', async () => {
    const f = fixture();
    vi.mocked(f.adapter.submit).mockResolvedValue({ status: 'submitted', receipt: { message: { binding: f.binding, id: 'original-message' }, conversation: { binding: f.binding, id: 'another-chat' }, recipient: f.recipient } });
    expect(await f.coordinator.submit(f.input)).toEqual({ status: 'unknown' });
    expect(f.stored?.state).toBe('unknown');
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
  });

  it('does not certify a service action as a provider message receipt', async () => {
    const f = fixture();
    vi.mocked(f.adapter.submit).mockResolvedValue({ status: 'submitted', receipt: { operation: { binding: f.binding, id: 'service-action' }, recipient: f.recipient } });
    expect(await f.coordinator.submit(f.input)).toEqual({ status: 'unknown' });
  });

  it('does not certify a provider message as an invitation action receipt', async () => {
    const f = fixture(true);
    vi.mocked(f.adapter.submit).mockResolvedValue({ status: 'submitted', receipt: { message: { binding: f.binding, id: 'provider-message' }, recipient: f.recipient } });
    expect(await f.coordinator.submit(f.input)).toEqual({ status: 'unknown' });
  });

  it('refuses a replay whose recorded message and completed receipt disagree', async () => {
    const f = fixture();
    f.stored = { snapshot: f.input.snapshot, recipient: f.recipient, message: { binding: f.binding, id: 'another-original-message' }, state: 'completed', outcome: f.expected as Exclude<DeliveryOutcome, { status: 'unknown' }> };
    await expect(f.coordinator.submit(f.input)).rejects.toThrow();
    expect(f.adapter.submit).not.toHaveBeenCalled();
    expect(f.adapter.ready).not.toHaveBeenCalled();
  });

  it('refuses historical completed lookup when its journal message disagrees with its receipt', async () => {
    const f = fixture();
    f.stored = { snapshot: f.input.snapshot, recipient: f.recipient, message: { binding: f.binding, id: 'another-original-message' }, state: 'completed', outcome: f.expected as Exclude<DeliveryOutcome, { status: 'unknown' }> };
    await expect(f.coordinator.lookup({ snapshot: f.input.snapshot, message: { binding: f.binding, id: 'original-message' }, expectedRecipient: f.recipient })).rejects.toThrow();
    expect(f.adapter.lookup).not.toHaveBeenCalled();
    expect(f.adapter.submit).not.toHaveBeenCalled();
  });

  it('keeps a receipt commit with conflicting recorded message unknown', async () => {
    const f = fixture();
    vi.mocked(f.journal.complete).mockResolvedValue({ snapshot: f.input.snapshot, recipient: f.recipient, message: { binding: f.binding, id: 'another-original-message' }, state: 'completed', outcome: f.expected as Exclude<DeliveryOutcome, { status: 'unknown' }> });
    expect(await f.coordinator.submit(f.input)).toEqual({ status: 'unknown' });
    expect(f.adapter.submit).toHaveBeenCalledTimes(1);
  });

  it.each(['2026-02-30T09:30:00Z', '2026-10-12T09:30:00'])('does not certify an invalid or timezone-ambiguous receipt timestamp (%#)', async submittedAt => {
    const f = fixture();
    const outcome = structuredClone(f.expected);
    if (outcome.status !== 'submitted') throw new Error('Fixture receipt unavailable');
    outcome.receipt.submittedAt = submittedAt;
    vi.mocked(f.adapter.submit).mockResolvedValue(outcome);
    expect(await f.coordinator.submit(f.input)).toEqual({ status: 'unknown' });
    expect(f.stored?.state).toBe('unknown');
  });
});

describe('independent original legacy recovery correlation characterization', () => {
  function recovery(backend: 'direct' | 'browser' | 'unipile') {
    const f = fixture(backend === 'browser');
    const binding: ConnectionBinding = backend === 'direct' ? { ...f.binding, channel: 'email', platform: 'gmail', backend } : { ...f.binding, backend };
    const recipient = backend === 'direct' ? { kind: 'email' as const, value: 'synthetic@example.test' } : f.recipient;
    const message = { recipient, text: 'Synthetic recovery', ...(backend === 'direct' ? { rfcMessageId: '<original@example.test>', conversation: { binding, id: 'original-thread' } } : {}) };
    const snapshot = { binding, key: 'original-operation', operation: 'message' as const, payloadDigest: messageDigest('message', message) };
    const record: DispatchRecord = { snapshot, recipient, ...(backend === 'direct' ? { rfcMessageId: message.rfcMessageId, conversation: message.conversation } : {}), state: 'unknown', outcome: { status: 'unknown' } };
    f.stored = record;
    const outcome: DeliveryOutcome = backend === 'browser' ? { status: 'submitted', receipt: { operation: { binding, id: 'original-action' }, recipient } } : { status: 'submitted', receipt: { message: { binding, id: 'recovered-message' }, ...(message.conversation ? { conversation: message.conversation } : {}), recipient } };
    vi.mocked(f.adapter.lookup).mockResolvedValue(outcome);
    const coordinator = createDispatchCoordinator(binding, f.adapter, f.journal);
    return { ...f, binding, snapshot, recipient, message, record, outcome, coordinator };
  }

  it('captures the original RFC/owner before journal callbacks and provider retrieval', async () => {
    const f = recovery('direct');
    const request: ReceiptLookup = { snapshot: structuredClone(f.snapshot), rfcMessageId: '<original@example.test>' };
    vi.mocked(f.journal.get).mockImplementationOnce(async supplied => {
      supplied.binding.ownerId = 'mutated-journal-argument';
      request.rfcMessageId = '<caller-changed@example.test>';
      request.snapshot.binding.generation = 2;
      return f.record;
    });
    expect(await f.coordinator.lookup(request)).toEqual(f.outcome);
    expect(f.adapter.lookup).toHaveBeenCalledExactlyOnceWith({ snapshot: f.snapshot, rfcMessageId: '<original@example.test>', expectedRecipient: f.recipient });
    expect(f.adapter.submit).not.toHaveBeenCalled();
    expect(f.adapter.ready).not.toHaveBeenCalled();
    expect(f.journal.beginDispatch).not.toHaveBeenCalled();
  });

  it('rejects a caller-supplied new provider ID instead of substituting it into RFC recovery', async () => {
    const f = recovery('direct');
    expect(await f.coordinator.lookup({ snapshot: f.snapshot, message: { binding: f.binding, id: 'caller-guessed-message' } })).toEqual({ status: 'unknown' });
    expect(f.adapter.lookup).not.toHaveBeenCalled();
  });

  it('returns browser key recovery as an action without synthesizing a message namespace', async () => {
    const f = recovery('browser');
    const result = await f.coordinator.lookup({ snapshot: f.snapshot });
    expect(result).toEqual(f.outcome);
    expect(result).not.toHaveProperty('receipt.message');
    expect(f.adapter.lookup).toHaveBeenCalledExactlyOnceWith({ snapshot: f.snapshot, expectedRecipient: f.recipient });
    expect(f.adapter.submit).not.toHaveBeenCalled();
  });

  it('leaves a lost-ID Unipile write unknown even if a caller supplies a guessed ID', async () => {
    const f = recovery('unipile');
    expect(await f.coordinator.lookup({ snapshot: f.snapshot })).toEqual({ status: 'unknown' });
    expect(await f.coordinator.lookup({ snapshot: f.snapshot, message: { binding: f.binding, id: 'caller-guessed-message' } })).toEqual({ status: 'unknown' });
    expect(f.adapter.lookup).not.toHaveBeenCalled();
    expect(f.adapter.submit).not.toHaveBeenCalled();
  });

  it('keeps settlement unknown if reconciliation changes the original RFC correlation', async () => {
    const f = recovery('direct');
    vi.mocked(f.journal.reconcile).mockResolvedValue({ ...f.record, rfcMessageId: '<changed@example.test>', state: 'completed', outcome: f.outcome as Exclude<DeliveryOutcome, { status: 'unknown' }> });
    expect(await f.coordinator.lookup({ snapshot: f.snapshot })).toEqual({ status: 'unknown' });
    expect(f.adapter.lookup).toHaveBeenCalledTimes(1);
    expect(f.adapter.submit).not.toHaveBeenCalled();
  });
});
