import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCommunicationReplyDeliveryWorker } from './communications-reply-delivery';
import type { ConnectionBinding } from '../../communications/packages/contracts/src';
import type { OutboxDelivery } from '../../communications/packages/core/src/outbox-delivery';
import type { CommunicationReplyConsumerOptions } from './communications-reply-consumer';
const consumer = vi.hoisted(() => ({ apply: vi.fn(), factory: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./communications-reply-consumer', () => ({ createCommunicationReplyConsumer: consumer.factory }));
const binding: ConnectionBinding = { applicationId: 'acquire', tenantId: 'tenant', ownerId: 'owner', connectionId: 'connection', accountId: 'account', generation: 1, channel: 'linkedin', platform: 'linkedin', backend: 'unipile' };
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture() {
    const sourceEventKey = hash(['receipt']), fingerprint = hash(['communications.reply.review.v1', Object.values(binding), sourceEventKey, 'identity_pending']);
    const delivery: OutboxDelivery = { binding, subscriberId: 'acquire-replies', eventId: '101', sourceNamespace: 'reply_review/v1', sourceEventKey, payload: { outcome: { kind: 'review', code: 'identity_pending' }, fingerprint, receivedAt: '2026-10-12T10:00:00.000Z' }, token: 'claim-token' };
    const claim = vi.fn(async () => ({ kind: 'claimed' as const, delivery })), acknowledge = vi.fn(async (input: unknown) => { void input; return { status: 'acknowledged' as const }; });
    const options: CommunicationReplyConsumerOptions & {
        outbox: {
            claim: typeof claim;
            acknowledge: typeof acknowledge;
        };
        timeoutMs?: number;
    } = { pool: { connect: vi.fn() }, actor: { organizationId: 'tenant', userId: 'owner' }, binding, bindingId: '00000000-0000-4000-8000-000000000001', subscriberId: 'acquire-replies', authenticateDelivery: vi.fn(), resolveIdentity: vi.fn(), outbox: { claim, acknowledge } };
    return { options, delivery, claim, acknowledge };
}
beforeEach(() => { vi.clearAllMocks(); consumer.factory.mockReturnValue({ apply: consumer.apply }); consumer.apply.mockResolvedValue({ status: 'applied', decision: 'stop' }); });
describe('service outbox to Acquire transaction composition', () => {
    it('projects service evidence to exact app binding and ACKs only the committed app result', async () => {
        const f = fixture();
        const worker = createCommunicationReplyDeliveryWorker(f.options);
        await expect(worker.run()).resolves.toEqual({ status: 'delivered' });
        expect(consumer.apply).toHaveBeenCalledWith({ binding, bindingId: f.options.bindingId, subscriberId: f.delivery.subscriberId, serviceEventId: f.delivery.eventId, sourceKey: f.delivery.sourceEventKey, payload: f.delivery.payload }, expect.any(AbortSignal));
        expect(f.acknowledge).toHaveBeenCalledWith({ delivery: f.delivery, receipt: { binding, subscriberId: f.delivery.subscriberId, eventId: '101', fingerprint: f.delivery.payload.fingerprint, status: 'committed' } });
        expect(consumer.factory).toHaveBeenCalledWith(expect.objectContaining({ authenticateDelivery: f.options.authenticateDelivery, resolveIdentity: f.options.resolveIdentity, pool: f.options.pool, actor: f.options.actor }));
    });
    it('waits for the application commit and preserves the original service fingerprint', async () => {
        const f = fixture();
        let commit!: (v: unknown) => void;
        consumer.apply.mockReturnValue(new Promise(r => { commit = r; }));
        const pending = createCommunicationReplyDeliveryWorker(f.options).run();
        await vi.waitFor(() => expect(consumer.apply).toHaveBeenCalledTimes(1));
        expect(f.acknowledge).not.toHaveBeenCalled();
        commit({ status: 'duplicate', decision: 'stop' });
        await expect(pending).resolves.toEqual({ status: 'duplicate' });
        expect(f.acknowledge.mock.calls[0]?.[0]).toMatchObject({ receipt: { status: 'duplicate', fingerprint: f.delivery.payload.fingerprint } });
    });
    it('does not ACK a lost or failed application commit', async () => {
        const f = fixture();
        consumer.apply.mockRejectedValue(Error('Commit response lost'));
        await expect(createCommunicationReplyDeliveryWorker(f.options).run()).resolves.toEqual({ status: 'retry' });
        expect(f.acknowledge).not.toHaveBeenCalled();
    });
    it('ACKs a committed review without claiming that the reply permits sending', async () => {
        const f = fixture();
        consumer.apply.mockResolvedValue({ status: 'review', decision: 'review' });
        await expect(createCommunicationReplyDeliveryWorker(f.options).run()).resolves.toEqual({ status: 'delivered' });
        expect(f.acknowledge).toHaveBeenCalledTimes(1);
    });
    it('never turns a late app commit after deadline into an ACK', async () => {
        const f = fixture();
        f.options.timeoutMs = 5;
        let commit!: (v: unknown) => void;
        consumer.apply.mockReturnValue(new Promise(r => { commit = r; }));
        await expect(createCommunicationReplyDeliveryWorker(f.options).run()).resolves.toEqual({ status: 'retry' });
        commit({ status: 'applied', decision: 'stop' });
        await Promise.resolve();
        expect(f.acknowledge).not.toHaveBeenCalled();
    });
    for (const result of [undefined, { status: 'applied', decision: 'unknown' }, { status: 'unknown', decision: 'stop' }]) {
        it(`rejects invalid transaction result ${JSON.stringify(result)}`, async () => {
            const f = fixture();
            consumer.apply.mockResolvedValue(result);
            await expect(createCommunicationReplyDeliveryWorker(f.options).run()).resolves.toEqual({ status: 'retry' });
            expect(f.acknowledge).not.toHaveBeenCalled();
        });
    }
});

it('propagates the worker deadline signal into application transaction cancellation', async () => {
    const f = fixture(); f.options.timeoutMs = 10;
    let received: AbortSignal | undefined;
    consumer.apply.mockImplementation((_delivery, signal: AbortSignal) => { received = signal; return new Promise(() => {}); });
    await expect(createCommunicationReplyDeliveryWorker(f.options).run()).resolves.toEqual({ status: 'retry' });
    expect(received).toBeInstanceOf(AbortSignal); expect(received?.aborted).toBe(true);
    expect(f.acknowledge).not.toHaveBeenCalled();
});
