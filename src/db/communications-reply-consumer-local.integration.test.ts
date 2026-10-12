import { createHash, createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { localCampaignDatabase } from '../../scripts/campaign-integration-support.mjs';
import type { ConnectionBinding, CommunicationEvent } from '../../communications/packages/contracts/src';
import type { SqlPool } from '../../communications/packages/storage-postgres/src/webhook-repository';
import { createRecordedReplyIdentityResolver } from '@/lib/communications-reply-identity';
import { createCommunicationReplyConsumer, type CommunicationReplyDelivery, type CommunicationReplyConsumerOptions } from '@/lib/communications-reply-consumer';
vi.mock('server-only', () => ({}));
vi.mock('@vercel/functions', () => ({ attachDatabasePool: vi.fn() }));
// Explicit isolated opt-in only. No DDL, GRANT, migration or automatic schema setup.
// Synthetic rows commit because the consumer owns another transaction. Immutable history/holds
// remain retained; synthetic memberships/accounts/grants retire afterward. No provider/network send.
const enabled = process.env.COMMUNICATIONS_AUDIT_LOCAL_DB === '1';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const vector = (b: ConnectionBinding) => [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.accountId, b.generation, b.channel, b.platform, b.backend];
const subscriberId = 'acquire-reply-consumer-fixture';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => resolve = r); return { promise, resolve }; }
describe.skipIf(!enabled)('isolated PostgreSQL Acquire reply consumption, authority and cross-channel policy', () => {
    const pool = new pg.Pool({ connectionString: localCampaignDatabase, max: 10, connectionTimeoutMillis: 5000 });
    const driver: SqlPool = { async connect() { const client = await pool.connect(); return { async query<Row>(text: string, values?: unknown[]) { const r = await client.query(text, values); return { rows: r.rows as Row[], rowCount: r.rowCount }; }, release(error?: Error) { client.release(error); } }; } };
    const retained: {
        binding: ConnectionBinding;
        org: string;
        owner: string;
    }[] = [];
    beforeAll(async () => {
        if (process.env.CAMPAIGN_ISOLATED_CHANNEL_STACK !== '1')
            throw Error('Requires explicit isolated channel stack');
        const url = new URL(localCampaignDatabase);
        if (url.hostname !== '127.0.0.1' || url.port !== '5445' || url.pathname !== '/acquire_channels')
            throw Error('Unexpected consumer database target');
        const { rows: [r] } = await pool.query("SELECT current_database() name,system_identifier::text identity,to_regprocedure('public.communications_lock_reply_member(text,text)') member_lock,to_regclass('public.communication_reply_review_latches') review,to_regclass('communications.tenant_reply_barriers') barrier FROM pg_control_system()");
        if (r.name !== 'acquire_channels' || r.identity !== '7694812678792806433')
            throw Error('Unexpected isolated database identity');
        if (!r.member_lock || !r.review || !r.barrier)
            throw Error('Specifically approved 003 prerequisites are absent. This suite never migrates; missing schema is not a TDD red.');
    });
    beforeEach(() => vi.stubEnv('CAMPAIGN_REPLY_MONITOR_MODE', 'enforce'));
    afterAll(async () => {
        try {
            for (const f of retained) {
                await pool.query('UPDATE communications.connections SET active=false WHERE id=$1', [f.binding.connectionId]);
                await pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', ['acquire', f.org, f.owner]);
                await pool.query('DELETE FROM public.member WHERE organization_id=$1 AND user_id=$2', [f.org, f.owner]);
            }
        }
        finally {
            await pool.end();
            vi.unstubAllEnvs();
        }
    });
    async function fixture(channel: 'email' | 'whatsapp' | 'linkedin' = 'linkedin') {
        const nonce = randomUUID(), org = `consumer-${nonce}`, owner = `consumer-owner-${nonce}`, contact = randomUUID(), mandate = randomUUID(), target = randomUUID(), mailbox = randomUUID(), whatsapp = randomUUID(), bindingId = randomUUID();
        const actor = { organizationId: org, userId: owner };
        const binding: ConnectionBinding = { applicationId: 'acquire', tenantId: org, ownerId: owner, connectionId: `consumer-conn-${nonce}`, accountId: `consumer-account-${nonce}`, generation: 1, channel, platform: channel === 'email' ? 'gmail' : channel, backend: 'unipile' };
        const source = channel === 'email' ? 'person@example.test' : channel === 'whatsapp' ? '+61412345678' : 'https://www.linkedin.com/in/consumer-fixture/';
        const legacyIdentity = channel === 'email' ? source : channel === 'whatsapp' ? '61412345678@s.whatsapp.net' : 'urn:li:fsd_profile:consumerFixture';
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('INSERT INTO public."user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$1,$2,false,now(),now())', [owner, `${owner}@example.invalid`]);
            await client.query('INSERT INTO public.organization(id,name,slug) VALUES($1,$1,$1)', [org]);
            await client.query("INSERT INTO public.member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')", [randomUUID(), org, owner]);
            await client.query("INSERT INTO public.mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic consumer fixture','{}','{}',$3)", [mandate, org, owner]);
            await client.query("INSERT INTO public.targets(id,organization_id,mandate_id,company_name,firmographics) VALUES($1,$2,$3,'Synthetic','{}')", [target, org, mandate]);
            await client.query("INSERT INTO public.contacts(id,organization_id,target_id,display_name,provenance) VALUES($1,$2,$3,'Synthetic','{}')", [contact, org, target]);
            await client.query("INSERT INTO public.campaign_contact_assignments(organization_id,contact_id,owner_user_id,email) VALUES($1,$2,$3,'recipient@example.invalid')", [org, contact, owner]);
            await client.query("INSERT INTO public.mailbox_connections(id,organization_id,user_id,provider,address) VALUES($1,$2,$3,'gmail','synthetic-owner@example.invalid')", [mailbox, org, owner]);
            await client.query("INSERT INTO public.whatsapp_connections(id,organization_id,user_id,status) VALUES($1,$2,$3,'disconnected')", [whatsapp, org, owner]);
            await client.query("INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at) VALUES('acquire',$1,$2,clock_timestamp()+interval '1 hour')", [org, owner]);
            await client.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,$2,'consumer_fixture',$3,'fixture',clock_timestamp())", [binding.accountId, channel, hash(nonce)]);
            await client.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,'acquire',$2,$3,$4,$5,$6,'unipile',1,'connected',true)", [binding.connectionId, org, owner, binding.accountId, channel, binding.platform]);
            await client.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,1,'acquire',$2,$3,$4,$5,$6,'unipile','consumer-integration','v1','consumer-configuration','service','{}')", [binding.connectionId, org, owner, binding.accountId, channel, binding.platform]);
            await client.query("INSERT INTO public.communication_bindings(id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority) VALUES($1,$2,$3,$4,$5,1,$6,$7,'unipile','service')", [bindingId, org, owner, binding.connectionId, binding.accountId, channel, binding.platform]);
            const monitorBindings = [bindingId];
            for (const nextAction of ['email', 'whatsapp', 'linkedin'] as const) {
                const sequence = randomUUID(), version = randomUUID(), enrolment = randomUUID(), legacyBinding = randomUUID(), backend = nextAction === 'email' ? 'direct' : nextAction === 'whatsapp' ? 'baileys' : 'browser';
                await client.query("INSERT INTO public.communication_bindings(id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority,legacy_mailbox_id,legacy_whatsapp_id,legacy_linkedin_reference) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,'legacy_port',$9,$10,$11)", [legacyBinding, org, owner, `legacy-${nextAction}-${nonce}`, `legacy-account-${nextAction}-${nonce}`, nextAction, nextAction === 'email' ? 'gmail' : nextAction, backend, nextAction === 'email' ? mailbox : null, nextAction === 'whatsapp' ? whatsapp : null, nextAction === 'linkedin' ? `synthetic-browser-${nonce}` : null]);
                monitorBindings.push(legacyBinding);
                await client.query("INSERT INTO public.campaign_sequences(id,organization_id,owner_user_id,mandate_id,name,draft) VALUES($1,$2,$3,$4,'Synthetic','{}')", [sequence, org, owner, mandate]);
                await client.query('INSERT INTO public.campaign_sequence_versions(id,organization_id,owner_user_id,sequence_id,version,definition) VALUES($1,$2,$3,$4,1,$5)', [version, org, owner, sequence, JSON.stringify({ nextAction })]);
                await client.query("INSERT INTO public.campaign_enrolments(id,organization_id,owner_user_id,sequence_id,version_id,mandate_id,contact_id,mailbox_connection_id,recipient_email,next_step_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'recipient@example.invalid',now())", [enrolment, org, owner, sequence, version, mandate, contact, mailbox]);
                await client.query('INSERT INTO public.campaign_channel_bindings(enrolment_id,organization_id,owner_user_id,channel,binding_id) VALUES($1,$2,$3,$4,$5)', [enrolment, org, owner, nextAction, legacyBinding]);
            }
            await client.query("INSERT INTO public.campaign_reply_identities(organization_id,owner_user_id,contact_id,channel,identity,source_identity,email,since) VALUES($1,$2,$3,$4,$5,$6,'recipient@example.invalid','2026-01-01')", [org, owner, contact, channel, legacyIdentity, source]);
            for (const id of monitorBindings)
                await client.query("INSERT INTO public.communication_reply_monitors(binding_id,organization_id,owner_user_id,scope_digest,coverage_from,coverage_through,observed_at,complete,initial_sync_complete,invalidated) VALUES($1,$2,$3,$4,clock_timestamp()-interval '1 minute',clock_timestamp(),clock_timestamp(),true,true,false)", [id, org, owner, hash('fixture-scope')]);
            await client.query('COMMIT');
            retained.push({ binding, org, owner });
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
        const signatures = new Map<string, string>(), signatureKey = Buffer.alloc(32, 181);
        const signature = (d: CommunicationReplyDelivery) => createHmac('sha256', signatureKey).update(JSON.stringify([vector(d.binding), d.bindingId, d.subscriberId, d.serviceEventId, d.sourceKey, d.payload])).digest('hex');
        const authorize = (d: CommunicationReplyDelivery) => { signatures.set(d.serviceEventId, signature(d)); return d; };
        const authenticateDelivery = async (d: CommunicationReplyDelivery) => d.subscriberId === subscriberId && signature(d) === signatures.get(d.serviceEventId);
        const resolveIdentity = createRecordedReplyIdentityResolver({ actor, binding, bindingId });
        const consumer = (changes: Partial<CommunicationReplyConsumerOptions> = {}) => createCommunicationReplyConsumer({ pool: driver, actor, binding, bindingId, subscriberId, authenticateDelivery, resolveIdentity, ...changes });
        const message = (change: Partial<Extract<CommunicationEvent, {
            type: 'message';
        }>> = {}): CommunicationReplyDelivery => {
            const event: Extract<CommunicationEvent, {
                type: 'message';
            }> = { type: 'message', reference: { binding: structuredClone(binding), id: nonce }, conversation: { binding: structuredClone(binding), id: `chat-${nonce}` }, direction: 'inbound', sender: channel === 'email' ? { kind: 'email', value: source } : channel === 'whatsapp' ? { kind: 'phone', value: source } : { kind: 'linkedin_profile', value: source }, occurredAt: '2026-10-12T10:00:00.000Z', ...change };
            const sourceKey = hash(['communications.reply.event.v1', vector(binding), event.conversation?.id ?? null, event.reference.id]);
            const fingerprint = hash(['communications.reply.content.v1', vector(binding), event.reference.id, event.conversation?.id ?? null, event.direction, event.sender.kind, event.sender.value, new Date(event.occurredAt).toISOString()]);
            return authorize({ binding: structuredClone(binding), bindingId, subscriberId, serviceEventId: `event-${nonce}`, sourceKey, payload: { outcome: { kind: 'event', event, eventKey: sourceKey, fingerprint }, fingerprint, receivedAt: '2026-10-12T10:00:01.000Z' } });
        };
        const review = () => { const sourceKey = hash(['fixture-review', nonce]), fingerprint = hash(['communications.reply.review.v1', vector(binding), sourceKey, 'protocol']); return authorize({ binding: structuredClone(binding), bindingId, subscriberId, serviceEventId: `review-${nonce}`, sourceKey, payload: { outcome: { kind: 'review', code: 'protocol' }, fingerprint, receivedAt: '2026-10-12T10:00:01.000Z' } } as CommunicationReplyDelivery); };
        return { org, owner, actor, binding, bindingId, contact, source, consumer, message, review, authorize, resolveIdentity };
    }
    async function state(f: Awaited<ReturnType<typeof fixture>>) {
        const enrolments = await pool.query('SELECT e.state,e.stop_reason,b.backend FROM public.campaign_enrolments e JOIN public.campaign_channel_bindings cb ON cb.enrolment_id=e.id JOIN public.communication_bindings b ON b.id=cb.binding_id WHERE e.organization_id=$1 ORDER BY b.backend', [f.org]);
        const receipts = await pool.query('SELECT * FROM public.communication_event_receipts WHERE organization_id=$1', [f.org]);
        const holds = await pool.query('SELECT * FROM public.campaign_reply_holds WHERE organization_id=$1', [f.org]);
        return { enrolments: enrolments.rows, receipts: receipts.rows, holds: holds.rows };
    }
    it.each(['email', 'whatsapp', 'linkedin'] as const)('a verified %s reply commits receipt and stops mixed legacy backends across channels', async (channel) => {
        const f = await fixture(channel);
        expect(await f.consumer().apply(f.message())).toEqual({ status: 'applied', decision: 'stop' });
        const s = await state(f);
        expect(s.enrolments).toHaveLength(3);
        expect(s.enrolments.map(e => e.backend).sort()).toEqual(['baileys', 'browser', 'direct']);
        for (const e of s.enrolments)
            expect(e).toMatchObject({ state: 'stopped', stop_reason: 'reply_received' });
        expect(s.receipts).toHaveLength(1);
        expect(s.holds).toHaveLength(1);
    });
    it('replays without duplicating immutable receipts, holds or enrolment-stop audits', async () => {
        const f = await fixture(), d = f.message();
        await f.consumer().apply(d);
        expect(await f.consumer().apply(d)).toEqual({ status: 'duplicate', decision: 'stop' });
        const s = await state(f);
        expect(s.receipts).toHaveLength(1);
        expect(s.holds).toHaveLength(1);
        expect((await pool.query("SELECT count(*)::int n FROM public.audit_events WHERE organization_id=$1 AND action='campaign.reply_received'", [f.org])).rows[0].n).toBe(3);
    });
    it('conflicting replay preserves the old fingerprint and blocks all original owner monitors', async () => {
        const f = await fixture(), d = f.message();
        await f.consumer().apply(d);
        const old = (await state(f)).receipts[0];
        d.payload.receivedAt = '2026-10-12T10:00:02.000Z';
        f.authorize(d);
        expect(await f.consumer().apply(d)).toEqual({ status: 'review', decision: 'review' });
        const s = await state(f);
        expect(s.receipts[0]).toEqual(old);
        expect(s.holds).toHaveLength(1);
        const monitors = (await pool.query('SELECT invalidated,complete FROM public.communication_reply_monitors WHERE organization_id=$1', [f.org])).rows;
        expect(monitors).toHaveLength(4);
        for (const m of monitors)
            expect(m).toEqual({ invalidated: true, complete: false });
    });
    it('service review creates an application latch without a fictional contact hold', async () => {
        const f = await fixture();
        expect(await f.consumer().apply(f.review())).toEqual({ status: 'review', decision: 'review' });
        expect((await state(f)).holds).toHaveLength(0);
        expect((await pool.query('SELECT code,resolved_at FROM public.communication_reply_review_latches WHERE organization_id=$1', [f.org])).rows).toEqual([{ code: 'protocol', resolved_at: null }]);
    });
    it('unchanged resolved review may replay but another conflicting payload cannot reopen or acknowledge it', async () => {
        const f = await fixture(), d = f.review();
        await f.consumer().apply(d);
        await pool.query("UPDATE public.communication_reply_review_latches SET resolved_at=clock_timestamp(),resolution_reference='synthetic-explicit-review' WHERE organization_id=$1", [f.org]);
        expect(await f.consumer().apply(d)).toEqual({ status: 'duplicate', decision: 'review' });
        d.payload.receivedAt = '2026-10-12T10:00:02.000Z';
        f.authorize(d);
        await expect(f.consumer().apply(d)).rejects.toThrow('Communication reply consumption unavailable');
        expect((await state(f)).receipts).toHaveLength(1);
    });
    it('preserves observation-to-enforcement replay and never clears holds', async () => {
        const f = await fixture('email'), d = f.message();
        vi.stubEnv('CAMPAIGN_REPLY_MONITOR_MODE', 'observe');
        await f.consumer().apply(d);
        expect((await state(f)).holds).toHaveLength(0);
        expect((await state(f)).enrolments.every(e => e.state === 'active')).toBe(true);
        vi.stubEnv('CAMPAIGN_REPLY_MONITOR_MODE', 'enforce');
        expect((await f.consumer().apply(d)).status).toBe('duplicate');
        expect((await state(f)).holds).toHaveLength(1);
        expect((await state(f)).enrolments.every(e => e.state === 'stopped')).toBe(true);
    });
    it('off mode and failed service authentication do not commit a receipt or hold', async () => {
        const f = await fixture(), d = f.message();
        vi.stubEnv('CAMPAIGN_REPLY_MONITOR_MODE', 'off');
        await expect(f.consumer().apply(d)).rejects.toThrow('Communication reply consumption unavailable');
        vi.stubEnv('CAMPAIGN_REPLY_MONITOR_MODE', 'enforce');
        d.subscriberId = 'untrusted-subscriber';
        await expect(f.consumer().apply(d)).rejects.toThrow('Communication reply consumption unavailable');
        expect((await state(f)).receipts).toHaveLength(0);
        expect((await state(f)).holds).toHaveLength(0);
    });
    it('unresolved canonical LinkedIn mapping is review, without guessing a profile URN', async () => {
        const f = await fixture();
        expect((await f.consumer({ resolveIdentity: async () => null }).apply(f.message())).status).toBe('review');
        expect((await state(f)).holds).toHaveLength(0);
    });
    it('revoked membership cannot consume another event and existing holds survive revocation', async () => {
        const f = await fixture(), d = f.message();
        await f.consumer().apply(d);
        await pool.query('DELETE FROM public.member WHERE organization_id=$1 AND user_id=$2', [f.org, f.owner]);
        await expect(f.consumer().apply(d)).rejects.toThrow('Communication reply consumption unavailable');
        expect((await state(f)).holds).toHaveLength(1);
    });
    it('membership revocation waits for the serializable consumer authority lock', async () => {
        const f = await fixture(), entered = deferred(), release = deferred();
        const consumer = f.consumer({ resolveIdentity: async (client, input) => { entered.resolve(); await release.promise; return f.resolveIdentity(client, input); } });
        const applied = consumer.apply(f.message());
        void applied.catch(() => { });
        await entered.promise;
        let deleted = false;
        const revocation = pool.query('DELETE FROM public.member WHERE organization_id=$1 AND user_id=$2', [f.org, f.owner]).then(() => { deleted = true; });
        await new Promise(r => setTimeout(r, 40));
        expect(deleted).toBe(false);
        release.resolve();
        expect((await applied).decision).toBe('stop');
        await revocation;
        expect((await state(f)).holds).toHaveLength(1);
    });
    it('a failed receipt write rolls back real policy holds, stops, audit and reply receipt together', async () => {
        const f = await fixture();
        const failing: SqlPool = { async connect() { const client = await driver.connect(); return { async query<Row>(text: string, values?: unknown[]) { if (text.startsWith('INSERT INTO public.communication_event_receipts'))
                    await client.query('SELECT 1/0'); return client.query<Row>(text, values); }, release(error?: Error) { client.release(error); } }; } };
        await expect(f.consumer({ pool: failing }).apply(f.message())).rejects.toThrow('Communication reply consumption unavailable');
        const s = await state(f);
        expect(s.receipts).toHaveLength(0);
        expect(s.holds).toHaveLength(0);
        expect(s.enrolments.every(e => e.state === 'active')).toBe(true);
        expect((await pool.query('SELECT count(*)::int n FROM public.campaign_reply_receipts WHERE organization_id=$1', [f.org])).rows[0].n).toBe(0);
    });
    it('lost COMMIT response recovers by exact receipt replay without sending or clearing a hold', async () => {
        const f = await fixture(), d = f.message();
        let lose = true;
        const uncertain: SqlPool = { async connect() { const client = await driver.connect(); return { async query<Row>(text: string, values?: unknown[]) { const r = await client.query<Row>(text, values); if (text === 'COMMIT' && lose) {
                    lose = false;
                    throw Error('synthetic lost commit response');
                } return r; }, release(error?: Error) { client.release(error); } }; } };
        await expect(f.consumer({ pool: uncertain }).apply(d)).rejects.toThrow('Communication reply consumption unavailable');
        expect((await state(f)).holds).toHaveLength(1);
        expect((await f.consumer().apply(d)).status).toBe('duplicate');
        expect((await state(f)).holds).toHaveLength(1);
        expect((await state(f)).receipts).toHaveLength(1);
    });
});
