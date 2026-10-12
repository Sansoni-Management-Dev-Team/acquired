import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionBinding, CommunicationEvent } from '../../communications/packages/contracts/src';
import type { SqlClient, SqlResult } from '../../communications/packages/storage-postgres/src/webhook-repository';
import { createCommunicationReplyConsumer, type CommunicationReplyConsumerOptions, type CommunicationReplyDelivery } from './communications-reply-consumer';
const helper = vi.hoisted(() => ({ apply: vi.fn(), mode: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./campaign-reply-store', () => ({ applyCampaignReply: helper.apply, replyMonitorMode: helper.mode }));
const actor = { organizationId: 'tenant', userId: 'owner' };
const bindingId = '00000000-0000-4000-8000-000000000001';
const binding: ConnectionBinding = { applicationId: 'acquire', tenantId: 'tenant', ownerId: 'owner', connectionId: 'connection', accountId: 'account', generation: 1, channel: 'linkedin', platform: 'linkedin', backend: 'unipile' };
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const vector = (b: ConnectionBinding) => [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.accountId, b.generation, b.channel, b.platform, b.backend];
function delivery(channel: 'linkedin' | 'email' | 'whatsapp' = 'linkedin'): CommunicationReplyDelivery {
    const b: ConnectionBinding = { ...binding, channel, platform: channel === 'email' ? 'gmail' : channel };
    const event: Extract<CommunicationEvent, {
        type: 'message';
    }> = { type: 'message', reference: { binding: b, id: 'm1' }, conversation: { binding: b, id: 'chat' }, direction: 'inbound', sender: channel === 'email' ? { kind: 'email', value: 'person@example.com' } : channel === 'whatsapp' ? { kind: 'phone', value: '+61412345678' } : { kind: 'linkedin_profile', value: 'https://www.linkedin.com/in/person' }, occurredAt: '2026-10-12T10:00:00.000Z' };
    const eventKey = hash(['communications.reply.event.v1', vector(b), 'chat', 'm1']);
    const fingerprint = hash(['communications.reply.content.v1', vector(b), 'm1', 'chat', 'inbound', event.sender.kind, event.sender.value, event.occurredAt]);
    return { binding: b, bindingId, subscriberId: 'acquire-replies', serviceEventId: '100', sourceKey: eventKey, payload: { outcome: { kind: 'event', event, eventKey, fingerprint }, fingerprint, receivedAt: '2026-10-12T10:00:01.000Z' } };
}
function fixture(channel: 'linkedin' | 'email' | 'whatsapp' = 'linkedin') {
    const input = delivery(channel), calls: {
        sql: string;
        values: unknown[];
    }[] = [];
    let role = 'acquire_campaign_user';
    const state = { member: true, bindingValid: true, receipt: null as Record<string, unknown> | null, failInsert: false, failCommit: false, failRollback: false, insertCollision: false, latch: null as Record<string, unknown> | null, waitCommit: null as Promise<void> | null };
    const release = vi.fn();
    const query: SqlClient['query'] = async <Row = Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<SqlResult<Row>> => {
        calls.push({ sql, values });
        let rows: unknown[] = [];
        if (sql.startsWith('SET LOCAL ROLE '))
            role = sql.split(' ').at(-1)!;
        if (sql.includes('FROM pg_roles'))
            rows = [{ active_role: role, rolsuper: false, rolbypassrls: false, rolcanlogin: false }];
        if (sql.includes('communications_lock_reply_member'))
            rows = [{ allowed: state.member }];
        if (sql.includes('FROM public.communication_bindings'))
            rows = state.bindingValid ? [{ id: bindingId, application_id: 'acquire', organization_id: 'tenant', owner_user_id: 'owner', service_connection_id: 'connection', service_account_id: 'account', generation: 1, channel, platform: channel === 'email' ? 'gmail' : channel, backend: 'unipile', authority: 'service' }] : [];
        if (sql.includes('FROM public.communication_event_receipts'))
            rows = state.receipt ? [state.receipt] : [];
        if (sql.startsWith('INSERT INTO public.communication_event_receipts')) {
            if (state.failInsert)
                throw Error('private receipt failure');
            if (!state.insertCollision) {
                state.receipt = { binding_id: values[0], service_event_id: values[1], organization_id: values[2], owner_user_id: values[3], event_type: values[4], occurred_at: new Date(values[5] as string), result: values[6], payload_fingerprint: values[7], fingerprint_version: values[8] };
                rows = [{ service_event_id: values[1] }];
            }
        }
        if (sql.startsWith('INSERT INTO public.communication_reply_review_latches')) {
            if (!state.latch) {
                state.latch = { binding_id: values[0], service_event_id: values[1], organization_id: values[2], owner_user_id: values[3], code: values[4], resolved_at: null };
                rows = [{ service_event_id: values[1] }];
            }
        }
        if (sql.includes('FROM public.communication_reply_review_latches'))
            rows = state.latch ? [state.latch] : [];
        if (sql === 'COMMIT') {
            if (state.waitCommit)
                await state.waitCommit;
            if (state.failCommit)
                throw Error('private commit uncertainty');
        }
        if (sql === 'ROLLBACK' && state.failRollback)
            throw Error('private rollback uncertainty');
        return { rows: rows as Row[], rowCount: rows.length };
    };
    const client: SqlClient = { query, release };
    const connect = vi.fn(async () => client);
    const authenticateDelivery = vi.fn(async () => true);
    const identity = channel === 'linkedin' ? 'urn:li:fsd_profile:verifiedPerson' : channel === 'email' ? 'person@example.com' : '61412345678@s.whatsapp.net';
    const aliasBinding = structuredClone(input.binding), aliasSender = structuredClone(input.payload.outcome.kind === 'event' && input.payload.outcome.event.type === 'message' ? input.payload.outcome.event.sender : { kind: 'email' as const, value: '' });
    const resolveIdentity = vi.fn(async () => ({ actor: { ...actor }, binding: structuredClone(aliasBinding), sender: structuredClone(aliasSender), identity }));
    const options: CommunicationReplyConsumerOptions = { pool: { connect }, actor: { ...actor }, binding: structuredClone(input.binding), bindingId, subscriberId: 'acquire-replies', authenticateDelivery, resolveIdentity };
    return { input, calls, state, release, client, connect, options, authenticateDelivery, resolveIdentity, api: createCommunicationReplyConsumer(options) };
}
beforeEach(() => { vi.clearAllMocks(); helper.mode.mockReturnValue('enforce'); helper.apply.mockResolvedValue('stop'); });
describe('Acquire reply consumer SQL protocol, scripted driver only', () => {
    it.each(['email', 'whatsapp', 'linkedin'] as const)('applies a verified %s reply through existing policy in the same serializable transaction', async (channel) => {
        const f = fixture(channel);
        expect(await f.api.apply(f.input)).toEqual({ status: 'applied', decision: 'stop' });
        expect(f.calls[0].sql).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
        expect(f.calls.some(c => c.sql.includes('communications_lock_reply_member'))).toBe(true);
        expect(helper.apply).toHaveBeenCalledWith(f.client, actor, channel, expect.any(String), expect.objectContaining({ id: f.input.sourceKey, fromIdentity: channel === 'linkedin' ? 'urn:li:fsd_profile:verifiedPerson' : channel === 'email' ? 'person@example.com' : '61412345678@s.whatsapp.net', receivedAt: '2026-10-12T10:00:00.000Z' }));
        expect(f.calls.at(-1)?.sql).toBe('COMMIT');
        expect(f.state.receipt?.payload_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });
    it('does not acknowledge before the Acquire commit finishes', async () => {
        const f = fixture();
        let release!: () => void;
        f.state.waitCommit = new Promise<void>(r => release = r);
        let done = false;
        const p = f.api.apply(f.input).then(r => { done = true; return r; });
        void p.catch(() => { });
        await vi.waitFor(() => expect(f.calls.some(c => c.sql === 'COMMIT')).toBe(true));
        expect(done).toBe(false);
        release();
        expect((await p).status).toBe('applied');
    });
    it.each(['outbound', 'self', 'group'] as const)('ignores %s without mapping or contact policy', async (direction) => {
        const f = fixture();
        const event = f.input.payload.outcome.kind === 'event' ? f.input.payload.outcome.event as Extract<CommunicationEvent, {
            type: 'message';
        }> : null;
        event!.direction = direction;
        const fp = hash(['communications.reply.content.v1', vector(f.input.binding), 'm1', 'chat', direction, event!.sender.kind, event!.sender.value, event!.occurredAt]);
        f.input.payload.fingerprint = fp;
        if (f.input.payload.outcome.kind === 'event')
            f.input.payload.outcome.fingerprint = fp;
        expect(await f.api.apply(f.input)).toEqual({ status: 'applied', decision: 'ignore' });
        expect(helper.apply).not.toHaveBeenCalled();
        expect(f.resolveIdentity).not.toHaveBeenCalled();
    });
    it.each(['protocol', 'account_changed', 'identity_pending'] as const)('persists %s review and invalidates coverage without a fake hold', async (code) => {
        const f = fixture();
        f.input.sourceKey = 'a'.repeat(64);
        f.input.payload = { outcome: { kind: 'review', code }, fingerprint: hash(['communications.reply.review.v1', vector(f.input.binding), f.input.sourceKey, code]), receivedAt: '2026-10-12T10:00:01.000Z' };
        expect(await f.api.apply(f.input)).toEqual({ status: 'review', decision: 'review' });
        expect(helper.apply).not.toHaveBeenCalled();
        expect(f.calls.some(c => c.sql.startsWith('INSERT INTO public.communication_reply_review_latches'))).toBe(true);
        expect(f.calls.some(c => c.sql.startsWith('UPDATE public.communication_reply_monitors'))).toBe(true);
    });
    it('replays matching receipts through existing policy for observe-to-enforce holds', async () => {
        const f = fixture();
        helper.mode.mockReturnValue('observe');
        await f.api.apply(f.input);
        helper.mode.mockReturnValue('enforce');
        expect(await f.api.apply(f.input)).toEqual({ status: 'duplicate', decision: 'stop' });
        expect(helper.apply).toHaveBeenCalledTimes(2);
    });
    it('turns changed replay payload into review without replacing the receipt or reapplying policy', async () => {
        const f = fixture();
        await f.api.apply(f.input);
        const saved = structuredClone(f.state.receipt);
        helper.apply.mockClear();
        f.input.payload.receivedAt = '2026-10-12T10:00:02.000Z';
        expect(await f.api.apply(f.input)).toEqual({ status: 'review', decision: 'review' });
        expect(helper.apply).not.toHaveBeenCalled();
        expect(f.state.receipt).toEqual(saved);
    });
    it.each(['member', 'binding', 'auth', 'off'] as const)('rejects %s without application acknowledgement', async (fault) => {
        const f = fixture();
        if (fault === 'member')
            f.state.member = false;
        if (fault === 'binding')
            f.state.bindingValid = false;
        if (fault === 'auth')
            f.authenticateDelivery.mockResolvedValue(false);
        if (fault === 'off')
            helper.mode.mockReturnValue('off');
        await expect(f.api.apply(f.input)).rejects.toThrow('Communication reply consumption unavailable');
        expect(helper.apply).not.toHaveBeenCalled();
        expect(f.calls.some(c => c.sql === 'COMMIT')).toBe(false);
    });
    it.each(['tenant', 'owner', 'generation', 'subscriber', 'bindingId'] as const)('rejects changed delivery %s before SQL', async (fault) => {
        const f = fixture();
        if (fault === 'tenant')
            f.input.binding.tenantId = 'foreign';
        if (fault === 'owner')
            f.input.binding.ownerId = 'foreign';
        if (fault === 'generation')
            f.input.binding.generation = 2;
        if (fault === 'subscriber')
            f.input.subscriberId = 'other';
        if (fault === 'bindingId')
            f.input.bindingId = '00000000-0000-4000-8000-000000000002';
        await expect(f.api.apply(f.input)).rejects.toThrow('Communication reply consumption unavailable');
        expect(f.connect).not.toHaveBeenCalled();
    });
    it('acknowledges an unchanged review replay after explicit resolution without invalidating coverage again', async () => {
        const f = fixture();
        f.input.sourceKey = 'a'.repeat(64);
        f.input.payload = { outcome: { kind: 'review', code: 'protocol' }, fingerprint: hash(['communications.reply.review.v1', vector(f.input.binding), f.input.sourceKey, 'protocol']), receivedAt: '2026-10-12T10:00:01.000Z' };
        await f.api.apply(f.input);
        f.state.latch!.resolved_at = '2026-10-12T10:00:03.000Z';
        f.calls.length = 0;
        expect(await f.api.apply(f.input)).toEqual({ status: 'duplicate', decision: 'review' });
        expect(f.calls.some(c => c.sql.startsWith('UPDATE public.communication_reply_monitors'))).toBe(false);
    });
    it('does not acknowledge a new conflicting replay after its previous review latch was resolved', async () => {
        const f = fixture();
        await f.api.apply(f.input);
        f.input.payload.receivedAt = '2026-10-12T10:00:02.000Z';
        await f.api.apply(f.input);
        f.state.latch!.resolved_at = '2026-10-12T10:00:03.000Z';
        f.input.payload.receivedAt = '2026-10-12T10:00:04.000Z';
        f.calls.length = 0;
        await expect(f.api.apply(f.input)).rejects.toThrow('Communication reply consumption unavailable');
        expect(f.calls.some(c => c.sql === 'COMMIT')).toBe(false);
    });
    it('requires verified LinkedIn URN mapping and reviews unresolved aliases', async () => {
        const f = fixture();
        f.resolveIdentity.mockResolvedValueOnce(null as never);
        expect(await f.api.apply(f.input)).toEqual({ status: 'review', decision: 'review' });
        expect(helper.apply).not.toHaveBeenCalled();
    });
    it.each(['foreignScope', 'foreignIdentity', 'guessedUrl', 'changedPhone', 'changedEmail'] as const)('reviews invalid identity proof %s instead of guessing', async (fault) => {
        const f = fixture(fault === 'changedPhone' ? 'whatsapp' : fault === 'changedEmail' ? 'email' : 'linkedin');
        const proof = await f.resolveIdentity();
        f.resolveIdentity.mockClear();
        if (fault === 'foreignScope')
            proof.actor.organizationId = 'foreign';
        if (fault === 'foreignIdentity')
            proof.sender.value = 'https://www.linkedin.com/in/other';
        if (fault === 'guessedUrl')
            proof.identity = 'https://www.linkedin.com/in/person';
        if (fault === 'changedPhone')
            proof.identity = '61499999999@s.whatsapp.net';
        if (fault === 'changedEmail')
            proof.identity = 'other@example.com';
        f.resolveIdentity.mockResolvedValueOnce(proof);
        expect(await f.api.apply(f.input)).toEqual({ status: 'review', decision: 'review' });
        expect(helper.apply).not.toHaveBeenCalled();
    });
    it.each(['insert', 'commit', 'rollback', 'collision'] as const)('rolls back/discards appropriately on %s uncertainty', async (fault) => {
        const f = fixture();
        f.state.failInsert = fault === 'insert' || fault === 'rollback';
        f.state.failCommit = fault === 'commit';
        f.state.failRollback = fault === 'rollback';
        f.state.insertCollision = fault === 'collision';
        await expect(f.api.apply(f.input)).rejects.toThrow('Communication reply consumption unavailable');
        expect(f.calls.some(c => c.sql === 'ROLLBACK')).toBe(true);
        expect(f.release).toHaveBeenCalledOnce();
        if (fault === 'commit' || fault === 'rollback')
            expect(f.release).toHaveBeenCalledWith(expect.any(Error));
    });
    it('captures input and callbacks before authentication awaits', async () => {
        const f = fixture();
        f.authenticateDelivery.mockImplementationOnce(async () => { f.input.binding.ownerId = 'changed'; f.input.payload.receivedAt = 'private changed'; f.options.resolveIdentity = vi.fn(); return true; });
        expect((await f.api.apply(f.input)).status).toBe('applied');
        expect(f.resolveIdentity).toHaveBeenCalledOnce();
    });
    it('rejects malformed dates and inconsistent semantic fingerprints', async () => {
        const f = fixture();
        f.input.payload.receivedAt = '2026-02-30T10:00:00Z';
        await expect(f.api.apply(f.input)).rejects.toThrow('Communication reply consumption unavailable');
        expect(f.connect).not.toHaveBeenCalled();
        const g = fixture();
        g.input.payload.fingerprint = 'b'.repeat(64);
        await expect(g.api.apply(g.input)).rejects.toThrow('Communication reply consumption unavailable');
        expect(g.connect).not.toHaveBeenCalled();
    });
});
