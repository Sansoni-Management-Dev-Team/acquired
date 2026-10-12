import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
    it.each([{ authenticationTimeoutMs: 0 }, { authenticationTimeoutMs: 5001 }, { transactionTimeoutMs: 0 }, { transactionTimeoutMs: 25001 }, { authenticationTimeoutMs: 5000, transactionTimeoutMs: 25000 }])('rejects unbounded consumer deadline configuration %#', change => {
        const f = fixture();
        expect(() => createCommunicationReplyConsumer({ ...f.options, ...change })).toThrow('Invalid communication reply consumer configuration');
        expect(f.connect).not.toHaveBeenCalled();
    });
    it.each(['authentication', 'identity'] as const)('bounds a stalled %s callback and closes any owned transaction', async (stage) => {
        const f = fixture(), proof = await f.resolveIdentity();
        f.resolveIdentity.mockClear();
        let unblock!: () => void;
        const stalled = new Promise<void>(resolve => { unblock = resolve; });
        if (stage === 'authentication')
            f.authenticateDelivery.mockImplementationOnce(async () => { await stalled; return true; });
        else
            f.resolveIdentity.mockImplementationOnce(async () => { await stalled; return proof; });
        const config = Object.assign(f.options, { authenticationTimeoutMs: 5, transactionTimeoutMs: 10 });
        const settled = createCommunicationReplyConsumer(config).apply(f.input).then(() => 'completed', () => 'unavailable');
        try {
            expect(await Promise.race([settled, new Promise<string>(resolve => setTimeout(() => resolve('still_pending'), 60))])).toBe('unavailable');
            if (stage === 'authentication')
                expect(f.connect).not.toHaveBeenCalled();
            else {
                expect(f.calls.some(c => c.sql === 'COMMIT')).toBe(false);
                expect(f.release).toHaveBeenCalledOnce();
                expect(f.release).toHaveBeenCalledWith(expect.any(Error));
            }
        }
        finally {
            unblock();
            await settled;
        }
    });
    it('retires a connection that arrives after the consumer deadline without starting a transaction', async () => {
        const f = fixture();
        let unblock!: () => void;
        const stalled = new Promise<void>(resolve => { unblock = resolve; });
        f.connect.mockImplementationOnce(async () => { await stalled; return f.client; });
        const config = Object.assign(f.options, { authenticationTimeoutMs: 5, transactionTimeoutMs: 10 });
        const settled = createCommunicationReplyConsumer(config).apply(f.input).then(() => 'completed', () => 'unavailable');
        try {
            expect(await Promise.race([settled, new Promise<string>(resolve => setTimeout(() => resolve('still_pending'), 60))])).toBe('unavailable');
        }
        finally {
            unblock();
            await settled;
            await Promise.resolve();
        }
        expect(f.calls.some(c => c.sql.startsWith('BEGIN'))).toBe(false);
        expect(f.release).toHaveBeenCalledOnce();
        expect(f.release).toHaveBeenCalledWith(expect.any(Error));
    });
    it.each(['authentication', 'connect', 'query', 'identity'] as const)('rejects synchronous %s work that blocks the deadline timer', async (stage) => {
        const f = fixture(), proof = await f.resolveIdentity();
        const block = () => { const end = performance.now() + 20; while (performance.now() < end) { /* Synthetic callback starves timers. */ } };
        if (stage === 'authentication')
            f.authenticateDelivery.mockImplementationOnce(async () => { block(); return true; });
        if (stage === 'connect')
            f.connect.mockImplementationOnce(async () => { block(); return f.client; });
        if (stage === 'identity')
            f.resolveIdentity.mockImplementationOnce(async () => { block(); return proof; });
        if (stage === 'query') {
            const query = f.client.query.bind(f.client);
            f.client.query = async <Row>(sql: string, values?: unknown[]) => { if (sql.startsWith('BEGIN'))
                block(); return query<Row>(sql, values); };
        }
        await expect(createCommunicationReplyConsumer({ ...f.options, authenticationTimeoutMs: 5, transactionTimeoutMs: 10 }).apply(f.input)).rejects.toThrow('Communication reply consumption unavailable');
        expect(f.calls.some(c => c.sql === 'COMMIT' || c.sql === 'ROLLBACK')).toBe(false);
        if (stage === 'authentication')
            expect(f.release).not.toHaveBeenCalled();
        else {
            expect(f.release).toHaveBeenCalledOnce();
            expect(f.release).toHaveBeenCalledWith(expect.any(Error));
        }
    });
    it('honors a delivery abort inside identity resolution and prevents later SQL', async () => {
        const f = fixture(), proof = await f.resolveIdentity(), controller = new AbortController();
        let unblock!: () => void;
        const stalled = new Promise<void>(resolve => { unblock = resolve; });
        f.resolveIdentity.mockClear();
        f.resolveIdentity.mockImplementationOnce(async () => { await stalled; return proof; });
        const settled = f.api.apply(f.input, controller.signal).then(() => 'completed', () => 'unavailable');
        try {
            await vi.waitFor(() => expect(f.resolveIdentity).toHaveBeenCalledOnce());
            controller.abort();
            expect(await settled).toBe('unavailable');
            expect(f.release).toHaveBeenCalledOnce();
            expect(f.release).toHaveBeenCalledWith(expect.any(Error));
        }
        finally {
            unblock();
            await settled;
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(f.calls.some(c => c.sql === 'COMMIT' || c.sql === 'ROLLBACK')).toBe(false);
    });
    it('retires the locked transaction before notifying external identity abort listeners', async () => {
        const f = fixture(), proof = await f.resolveIdentity();
        let unblock!: () => void, retiredAtNotification = false;
        const stalled = new Promise<void>(resolve => { unblock = resolve; });
        f.resolveIdentity.mockImplementationOnce(async (_client?: SqlClient, _input?: unknown, signal?: AbortSignal) => {
            signal?.addEventListener('abort', () => { retiredAtNotification = f.release.mock.calls.length === 1; }, { once: true });
            await stalled;
            return proof;
        });
        const settled = createCommunicationReplyConsumer({ ...f.options, transactionTimeoutMs: 10 }).apply(f.input).then(() => 'completed', () => 'unavailable');
        try {
            expect(await settled).toBe('unavailable');
            expect(retiredAtNotification).toBe(true);
        }
        finally {
            unblock();
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(f.release).toHaveBeenCalledOnce();
    });
    it('discards an expired in-flight COMMIT without competing rollback or later success', async () => {
        const f = fixture();
        let unblock!: () => void;
        const stalled = new Promise<void>(resolve => { unblock = resolve; }), query = f.client.query.bind(f.client);
        f.client.query = async <Row>(sql: string, values?: unknown[]) => { const result = await query<Row>(sql, values); if (sql === 'COMMIT')
            await stalled; return result; };
        const settled = createCommunicationReplyConsumer({ ...f.options, transactionTimeoutMs: 10 }).apply(f.input).then(() => 'completed', () => 'unavailable');
        try {
            expect(await settled).toBe('unavailable');
            expect(f.calls.some(c => c.sql === 'ROLLBACK')).toBe(false);
        }
        finally {
            unblock();
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        expect(f.calls.some(c => c.sql === 'COMMIT')).toBe(true);
        expect(f.release).toHaveBeenCalledOnce();
        expect(f.release).toHaveBeenCalledWith(expect.any(Error));
    });
    it('closes the identity callback SQL capability on settlement and retires its session', async () => {
        const f = fixture(), proof = await f.resolveIdentity();
        let resolverClient!: SqlClient;
        f.resolveIdentity.mockImplementationOnce(async (client?: SqlClient) => { if (!client)
            throw Error('Expected callback client'); resolverClient = client; return proof; });
        expect((await f.api.apply(f.input)).status).toBe('applied');
        const count = f.calls.length;
        await expect(resolverClient.query('SELECT late_identity_write')).rejects.toThrow('Communication reply consumption unavailable');
        expect(f.calls).toHaveLength(count);
        expect(f.release).toHaveBeenCalledWith(expect.any(Error));
    });
    it.each(['throw', 'stall'])('observes unawaited identity SQL rejection in strict native Node (%s)', mode => {
        const script = String.raw `
            const fs=require('node:fs'),ts=require('typescript'),Module=require('node:module'),load=Module._load;
            Module._load=function(id,parent,isMain){if(id==='server-only')return {};if(id==='@/domain/campaign-replies')return {replyIdentity:(channel,value)=>channel==='linkedin'?value:null};if(id==='./campaign-reply-store')return {replyMonitorMode:()=> 'enforce',applyCampaignReply:async()=> 'stop'};return load.call(this,id,parent,isMain);};
            require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
            const {createCommunicationReplyConsumer}=require(process.argv[2]),{createHash}=require('node:crypto'),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
            const b={applicationId:'acquire',tenantId:'tenant',ownerId:'owner',connectionId:'connection',accountId:'account',generation:1,channel:'linkedin',platform:'linkedin',backend:'unipile'},bindingId='00000000-0000-4000-8000-000000000001',sender={kind:'linkedin_profile',value:'https://www.linkedin.com/in/person/'};
            const event={type:'message',reference:{binding:b,id:'m1'},conversation:{binding:b,id:'chat'},direction:'inbound',sender,occurredAt:'2026-10-12T10:00:00.000Z'},key=hash(['communications.reply.event.v1',Object.values(b),'chat','m1']),fp=hash(['communications.reply.content.v1',Object.values(b),'m1','chat','inbound',sender.kind,sender.value,event.occurredAt]);
            let role='acquire_campaign_user',rejectPending,rollback=false,commit=false,discards=0;
            const query=async text=>{if(text==='ROLLBACK')rollback=true;if(text==='COMMIT')commit=true;if(text.startsWith('SET LOCAL ROLE'))role=text.split(' ').at(-1);if(text==='SELECT pending_identity_query')return new Promise((_r,reject)=>rejectPending=reject);return {rows:text.includes('FROM pg_roles')?[{active_role:role,rolsuper:false,rolbypassrls:false,rolcanlogin:false}]:text.includes('communications_lock_reply_member')?[{allowed:true}]:text.includes('FROM public.communication_bindings')?[{id:bindingId,application_id:'acquire',organization_id:'tenant',owner_user_id:'owner',service_connection_id:'connection',service_account_id:'account',generation:1,channel:'linkedin',platform:'linkedin',backend:'unipile',authority:'service'}]:[]};};
            const consumer=createCommunicationReplyConsumer({binding:b,bindingId,subscriberId:'subscriber',actor:{organizationId:'tenant',userId:'owner'},authenticationTimeoutMs:10,transactionTimeoutMs:30,pool:{async connect(){return {query,release(error){if(error){discards++;rejectPending?.(Error('Synthetic retired identity query'));}}};}},authenticateDelivery:async()=>true,async resolveIdentity(client){void client.query('SELECT pending_identity_query');if(process.argv[1]==='throw')throw Error('Synthetic identity failure');return new Promise(()=>{});}});
            consumer.apply({binding:b,bindingId,subscriberId:'subscriber',serviceEventId:'100',sourceKey:key,payload:{outcome:{kind:'event',event,eventKey:key,fingerprint:fp},fingerprint:fp,receivedAt:'2026-10-12T10:00:01.000Z'}}).then(()=>process.exitCode=2,()=>setTimeout(()=>process.stdout.write(JSON.stringify({rollback,commit,discards})),40));
        `;
        const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', script, mode, fileURLToPath(new URL('./communications-reply-consumer.ts', import.meta.url))], { cwd: process.cwd(), encoding: 'utf8', timeout: 3000 });
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({ rollback: false, commit: false, discards: 1 });
    });
    it.each(['email', 'whatsapp', 'linkedin'] as const)('applies a verified %s reply through existing policy in the same serializable transaction', async (channel) => {
        const f = fixture(channel);
        helper.apply.mockImplementationOnce(async (client: SqlClient) => { await client.query('SELECT policy_transaction_marker'); return 'stop'; });
        expect(await f.api.apply(f.input)).toEqual({ status: 'applied', decision: 'stop' });
        expect(f.calls[0].sql).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
        expect(f.calls.some(c => c.sql.includes('communications_lock_reply_member'))).toBe(true);
        expect(helper.apply).toHaveBeenCalledWith(expect.objectContaining({ query: expect.any(Function), release: expect.any(Function) }), actor, channel, expect.any(String), expect.objectContaining({ id: f.input.sourceKey, fromIdentity: channel === 'linkedin' ? 'urn:li:fsd_profile:verifiedPerson' : channel === 'email' ? 'person@example.com' : '61412345678@s.whatsapp.net', receivedAt: '2026-10-12T10:00:00.000Z' }));
        expect(f.connect).toHaveBeenCalledOnce();
        expect(f.calls.filter(c => c.sql.startsWith('BEGIN'))).toHaveLength(1);
        expect(f.calls.findIndex(c => c.sql === 'SELECT policy_transaction_marker')).toBeGreaterThan(f.calls.findIndex(c => c.sql.startsWith('BEGIN')));
        expect(f.calls.findIndex(c => c.sql === 'SELECT policy_transaction_marker')).toBeLessThan(f.calls.findIndex(c => c.sql.startsWith('INSERT INTO public.communication_event_receipts')));
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
