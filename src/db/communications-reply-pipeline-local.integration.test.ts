import { createHash, createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { localCampaignDatabase } from '../../scripts/campaign-integration-support.mjs';
import { EventCodec, type EventPayload } from '../../communications/packages/core/src/event-codec';
import { WebhookCodec } from '../../communications/packages/core/src/webhook-codec';
import { createReplyWebhookIngress } from '../../communications/packages/core/src/reply-ingress';
import { createWebhookEventProcessor } from '../../communications/packages/core/src/webhook-events';
import { createPostgresWebhookRepository } from '../../communications/packages/storage-postgres/src/webhook-repository';
import { createPostgresReplyBarrier } from '../../communications/packages/storage-postgres/src/reply-barrier';
import { createPostgresOutboxRepository, type OutboxRepositoryOptions } from '../../communications/packages/storage-postgres/src/outbox-repository';
import type { SqlPool } from '../../communications/packages/storage-postgres/src/webhook-repository';
import type { ConnectionBinding, CommunicationEvent } from '../../communications/packages/contracts/src';
import type { EventOutboxPort, ApplicationReplyReceipt, OutboxDelivery } from '../../communications/packages/core/src/outbox-delivery';
import { createCommunicationReplyDeliveryWorker } from '@/lib/communications-reply-delivery';
import { createRecordedReplyIdentityResolver } from '@/lib/communications-reply-identity';
import type { CommunicationReplyConsumerOptions, CommunicationReplyDelivery } from '@/lib/communications-reply-consumer';
vi.mock('server-only', () => ({}));
vi.mock('@vercel/functions', () => ({ attachDatabasePool: vi.fn() }));
// Prepared until exact003 approval/application. No DDL or automatic setup. Two independently
// checked-out pools exercise separate service/app commits on the approved combined local fixture;
// this does not claim physically separate production databases or live delivery authentication.
const enabled = process.env.COMMUNICATIONS_AUDIT_LOCAL_DB === '1';
const subscriberId = 'acquire-reply-pipeline-fixture';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const vector = (b: ConnectionBinding) => [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.accountId, b.generation, b.channel, b.platform, b.backend];
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
describe.skipIf(!enabled)('isolated PostgreSQL service event to Acquire policy commit to subscriber ACK', () => {
    const servicePool = new pg.Pool({ connectionString: localCampaignDatabase, max: 8, connectionTimeoutMillis: 5000 });
    const appPool = new pg.Pool({ connectionString: localCampaignDatabase, max: 8, connectionTimeoutMillis: 5000 });
    const driver = (pool: pg.Pool): SqlPool => ({ async connect() { const client = await pool.connect(); return { async query<Row>(text: string, values?: unknown[]) { const result = await client.query(text, values); return { rows: result.rows as Row[], rowCount: result.rowCount }; }, release(error?: Error) { client.release(error); } }; } });
    const appDriver = driver(appPool), serviceDriver = driver(servicePool);
    const codec = new EventCodec({ activeVersion: 'pipeline-event-v1', keys: [{ version: 'pipeline-event-v1', encryptionKey: Buffer.alloc(32, 201), digestKey: Buffer.alloc(32, 202) }] });
    const webhookCodec = new WebhookCodec({ activeVersion: 'pipeline-webhook-v1', keys: [{ version: 'pipeline-webhook-v1', encryptionKey: Buffer.alloc(32, 203), digestKey: Buffer.alloc(32, 204) }] });
    const retained: {
        binding: ConnectionBinding;
        owners: string[];
    }[] = [];
    beforeAll(async () => {
        if (process.env.CAMPAIGN_ISOLATED_CHANNEL_STACK !== '1')
            throw Error('Requires explicit isolated database opt-in');
        const url = new URL(localCampaignDatabase);
        if (url.hostname !== '127.0.0.1' || url.port !== '5445' || url.pathname !== '/acquire_channels')
            throw Error('Unexpected pipeline database target');
        const { rows: [row] } = await servicePool.query("SELECT current_database() AS name,system_identifier::text AS identity,to_regprocedure('public.communications_lock_reply_member(text,text)') AS member_lock,to_regprocedure('communications.lock_reply_barrier(text,text)') AS barrier,to_regclass('public.communication_reply_review_latches') AS reviews FROM pg_control_system()");
        if (row.name !== 'acquire_channels' || row.identity !== '7694812678792806433')
            throw Error('Unexpected isolated database identity');
        if (!row.member_lock || !row.barrier || !row.reviews)
            throw Error('Exact003 prerequisites absent. No migration occurs; missing schema is not a TDD red.');
    });
    beforeEach(() => vi.stubEnv('CAMPAIGN_REPLY_MONITOR_MODE', 'enforce'));
    afterAll(async () => {
        try {
            for (const f of retained) {
                await servicePool.query('UPDATE communications.connections SET active=false WHERE id=$1', [f.binding.connectionId]);
                await servicePool.query("UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id='acquire' AND tenant_id=$1 AND owner_id=$2", [f.binding.tenantId, f.binding.ownerId]);
                await appPool.query('DELETE FROM public.member WHERE organization_id=$1 AND user_id=ANY($2::text[])', [f.binding.tenantId, f.owners]);
            }
        }
        finally {
            await Promise.all([servicePool.end(), appPool.end()]);
            vi.unstubAllEnvs();
        }
    });
    async function fixture(channel: 'email' | 'whatsapp' | 'linkedin' = 'linkedin', review = false) {
        const nonce = randomUUID(), org = `pipeline-${nonce}`, owner = `pipeline-owner-${nonce}`, other = `pipeline-other-${nonce}`, mandate = randomUUID(), target = randomUUID(), bindingId = randomUUID(), integrationId = `pipeline-integration-${nonce}`;
        const actor = { organizationId: org, userId: owner };
        const binding: ConnectionBinding = { applicationId: 'acquire', tenantId: org, ownerId: owner, connectionId: `pipeline-conn-${nonce}`, accountId: `pipeline-account-${nonce}`, generation: 1, channel, platform: channel === 'email' ? 'gmail' : channel, backend: 'unipile' };
        const source = channel === 'email' ? 'person@example.invalid' : channel === 'whatsapp' ? '+61412345678' : 'https://www.linkedin.com/in/pipeline-fixture/';
        const identity = channel === 'email' ? source : channel === 'whatsapp' ? '61412345678@s.whatsapp.net' : 'urn:li:fsd_profile:pipelineFixture';
        const client = await appPool.connect();
        try {
            await client.query('BEGIN');
            await client.query('INSERT INTO public.organization(id,name,slug) VALUES($1,$1,$1)', [org]);
            for (const id of [owner, other]) {
                await client.query('INSERT INTO public."user"(id,name,email,email_verified,created_at,updated_at) VALUES($1,$1,$2,false,now(),now())', [id, `${id}@example.invalid`]);
                await client.query("INSERT INTO public.member(id,organization_id,user_id,role) VALUES($1,$2,$3,'member')", [randomUUID(), org, id]);
            }
            await client.query("INSERT INTO public.mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic pipeline','{}','{}',$3)", [mandate, org, owner]);
            await client.query("INSERT INTO public.targets(id,organization_id,mandate_id,company_name,firmographics) VALUES($1,$2,$3,'Synthetic','{}')", [target, org, mandate]);
            await client.query("INSERT INTO public.communication_bindings(id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority) VALUES($1,$2,$3,$4,$5,1,$6,$7,'unipile','service')", [bindingId, org, owner, binding.connectionId, binding.accountId, channel, binding.platform]);
            for (const currentOwner of [owner, other]) {
                const contact = randomUUID(), mailbox = randomUUID(), whatsapp = randomUUID();
                await client.query("INSERT INTO public.contacts(id,organization_id,target_id,display_name,provenance) VALUES($1,$2,$3,'Synthetic','{}')", [contact, org, target]);
                await client.query("INSERT INTO public.campaign_contact_assignments(organization_id,contact_id,owner_user_id,email) VALUES($1,$2,$3,'recipient@example.invalid')", [org, contact, currentOwner]);
                await client.query("INSERT INTO public.mailbox_connections(id,organization_id,user_id,provider,address) VALUES($1,$2,$3,'gmail','synthetic@example.invalid')", [mailbox, org, currentOwner]);
                await client.query("INSERT INTO public.whatsapp_connections(id,organization_id,user_id,status) VALUES($1,$2,$3,'disconnected')", [whatsapp, org, currentOwner]);
                await client.query("INSERT INTO public.campaign_reply_identities(organization_id,owner_user_id,contact_id,channel,identity,source_identity,email,since) VALUES($1,$2,$3,$4,$5,$6,'recipient@example.invalid','2026-01-01')", [org, currentOwner, contact, channel, identity, source]);
                const actions = currentOwner === owner ? ['email', 'whatsapp', 'linkedin'] as const : ['email'] as const;
                for (const action of actions) {
                    const sequence = randomUUID(), version = randomUUID(), enrolment = randomUUID(), legacyBinding = randomUUID(), backend = action === 'email' ? 'direct' : action === 'whatsapp' ? 'baileys' : 'browser';
                    await client.query("INSERT INTO public.communication_bindings(id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority,legacy_mailbox_id,legacy_whatsapp_id,legacy_linkedin_reference) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,'legacy_port',$9,$10,$11)", [legacyBinding, org, currentOwner, `legacy-${action}-${legacyBinding}`, `legacy-account-${legacyBinding}`, action, action === 'email' ? 'gmail' : action, backend, action === 'email' ? mailbox : null, action === 'whatsapp' ? whatsapp : null, action === 'linkedin' ? `synthetic-browser-${nonce}` : null]);
                    await client.query("INSERT INTO public.campaign_sequences(id,organization_id,owner_user_id,mandate_id,name,draft) VALUES($1,$2,$3,$4,'Synthetic','{}')", [sequence, org, currentOwner, mandate]);
                    await client.query('INSERT INTO public.campaign_sequence_versions(id,organization_id,owner_user_id,sequence_id,version,definition) VALUES($1,$2,$3,$4,1,$5)', [version, org, currentOwner, sequence, JSON.stringify({ nextAction: action })]);
                    await client.query("INSERT INTO public.campaign_enrolments(id,organization_id,owner_user_id,sequence_id,version_id,mandate_id,contact_id,mailbox_connection_id,recipient_email,next_step_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'recipient@example.invalid',now())", [enrolment, org, currentOwner, sequence, version, mandate, contact, mailbox]);
                    await client.query('INSERT INTO public.campaign_channel_bindings(enrolment_id,organization_id,owner_user_id,channel,binding_id) VALUES($1,$2,$3,$4,$5)', [enrolment, org, currentOwner, action, legacyBinding]);
                }
            }
            await client.query('COMMIT');
            retained.push({ binding, owners: [owner, other] });
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
        const service = await servicePool.connect();
        let eventId = '';
        const event: Extract<CommunicationEvent, {
            type: 'message';
        }> = { type: 'message', reference: { binding, id: nonce }, conversation: { binding, id: `chat-${nonce}` }, direction: 'inbound', sender: channel === 'email' ? { kind: 'email', value: source } : channel === 'whatsapp' ? { kind: 'phone', value: source } : { kind: 'linkedin_profile', value: source }, occurredAt: '2026-10-12T10:00:00.000Z' };
        const rawBody = Buffer.from(JSON.stringify({ event: channel === 'email' ? 'mail_received' : 'message_received', account_id: 'synthetic-pipeline-provider', message_id: nonce }));
        const captureKey = hash(['communications.webhook.receipt.v1', vector(binding), createHash('sha256').update(rawBody).digest('hex')]);
        const sourceKey = review ? captureKey : hash(['communications.reply.event.v1', vector(binding), event.conversation!.id, event.reference.id]);
        const fingerprint = review ? hash(['communications.reply.review.v1', vector(binding), sourceKey, 'protocol']) : hash(['communications.reply.content.v1', vector(binding), event.reference.id, event.conversation!.id, event.direction, event.sender.kind, event.sender.value, event.occurredAt]);
        const payload: EventPayload = { outcome: review ? { kind: 'review', code: 'protocol' } : { kind: 'event', event, eventKey: sourceKey, fingerprint }, fingerprint, receivedAt: '2026-10-12T10:00:01.000Z' };
        try {
            await service.query('BEGIN');
            await service.query('SET LOCAL ROLE communications_control');
            await service.query("INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at) VALUES('acquire',$1,$2,clock_timestamp()+interval '1 hour')", [org, owner]);
            await service.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,$2,'pipeline_fixture',$3,'fixture',clock_timestamp())", [binding.accountId, channel, hash(nonce)]);
            await service.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,'acquire',$2,$3,$4,$5,$6,'unipile',1,'connected',true)", [binding.connectionId, org, owner, binding.accountId, channel, binding.platform]);
            await service.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,1,'acquire',$2,$3,$4,$5,$6,'unipile',$7,'v1','pipeline-configuration','service','{}')", [binding.connectionId, org, owner, binding.accountId, channel, binding.platform, integrationId]);
            await service.query('COMMIT');
        }
        catch (error) {
            await service.query('ROLLBACK');
            throw error;
        }
        finally {
            service.release();
        }
        const barrier = createPostgresReplyBarrier({ binding, integrationId, codec: webhookCodec, eventCodec: codec });
        const repository = createPostgresWebhookRepository({ pool: serviceDriver, binding, integrationId, providerConfigurationReference: 'pipeline-configuration', subscriberId, codec: webhookCodec, eventCodec: codec, replyBarrier: barrier });
        // Fixture-only header/enrichment authority. Persistence/routing/fences are concrete; this
        // test does not establish Unipile credentials, signatures, provider owner or complete reads.
        const ingress = createReplyWebhookIngress({ binding, journal: repository, now: () => Date.parse(payload.receivedAt), authenticate: headers => headers.length === 2 && headers[0] === 'X-Pipeline-Fixture' && headers[1] === 'synthetic', validateEnvelope: raw => raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>).account_id === 'synthetic-pipeline-provider' && (raw as Record<string, unknown>).message_id === nonce ? 'valid' : 'invalid_request' });
        expect(await ingress.capture({ rawHeaders: ['X-Pipeline-Fixture', 'synthetic'], rawBody })).toEqual({ status: 'accepted' });
        const processor = createWebhookEventProcessor({ binding, journal: repository, normalize: async () => review ? { kind: 'review', code: 'protocol' } : { kind: 'event', event } });
        expect(await processor.process(captureKey)).toEqual({ status: 'processed' });
        const stored = await servicePool.query('SELECT id::text AS id,encrypted_event FROM communications.events WHERE connection_id=$1 AND generation=1 AND source_event_key=$2', [binding.connectionId, sourceKey]);
        expect(stored.rows).toHaveLength(1);
        eventId = stored.rows[0].id;
        expect(codec.decode({ binding, key: sourceKey }, JSON.parse(stored.rows[0].encrypted_event))).toEqual(payload);
        expect((await servicePool.query('SELECT w.state,r.connection_id,r.generation FROM communications.webhook_inbox w JOIN communications.webhook_receipt_routes r ON r.webhook_inbox_id=w.id WHERE w.id=$1', [captureKey])).rows).toEqual([{ state: 'processed', connection_id: binding.connectionId, generation: 1 }]);
        const original: CommunicationReplyDelivery = { binding, bindingId, subscriberId, serviceEventId: eventId, sourceKey, payload };
        const sign = (d: CommunicationReplyDelivery) => createHmac('sha256', Buffer.alloc(32, 211)).update(JSON.stringify([vector(d.binding), d.bindingId, d.subscriberId, d.serviceEventId, d.sourceKey, d.payload.fingerprint, new Date(d.payload.receivedAt).toISOString(), d.payload.outcome.kind])).digest('hex');
        const expectedSignature = sign(original);
        const options: CommunicationReplyConsumerOptions = { pool: appDriver, actor, binding, bindingId, subscriberId, authenticateDelivery: async (d) => sign(d) === expectedSignature, resolveIdentity: createRecordedReplyIdentityResolver({ actor, binding, bindingId }) };
        const outbox = (changes: Partial<OutboxRepositoryOptions> = {}) => createPostgresOutboxRepository({ pool: serviceDriver, binding, subscriberId, codec, replyBarrier: barrier, ...changes });
        const worker = (changes: Partial<CommunicationReplyConsumerOptions> = {}, port: EventOutboxPort = outbox()) => createCommunicationReplyDeliveryWorker({ ...options, ...changes, outbox: port });
        return { org, owner, other, binding, eventId, options, outbox, worker };
    }
    async function state(f: Awaited<ReturnType<typeof fixture>>) {
        const [outbox, receipts, holds, enrolments, audit] = await Promise.all([
            servicePool.query('SELECT state,lease_token,lease_until,acknowledged_at FROM communications.event_outbox WHERE event_id=$1 AND subscriber_id=$2', [f.eventId, subscriberId]),
            appPool.query('SELECT * FROM public.communication_event_receipts WHERE organization_id=$1', [f.org]),
            appPool.query('SELECT * FROM public.campaign_reply_holds WHERE organization_id=$1', [f.org]),
            appPool.query('SELECT e.state,e.stop_reason,e.owner_user_id,b.backend FROM public.campaign_enrolments e JOIN public.campaign_channel_bindings cb ON cb.enrolment_id=e.id JOIN public.communication_bindings b ON b.id=cb.binding_id WHERE e.organization_id=$1', [f.org]),
            appPool.query("SELECT count(*)::int AS n FROM public.audit_events WHERE organization_id=$1 AND action='campaign.reply_received'", [f.org])
        ]);
        return { outbox: outbox.rows[0], receipts: receipts.rows, holds: holds.rows, enrolments: enrolments.rows, stopAudits: audit.rows[0].n };
    }
    it.each(['email', 'whatsapp', 'linkedin'] as const)('a %s reply stops all mixed backends and duplicate owners before service ACK', async (channel) => {
        const f = await fixture(channel);
        expect(await f.worker().run()).toEqual({ status: 'delivered' });
        const s = await state(f);
        expect(s.outbox.state).toBe('acknowledged');
        expect(s.receipts).toHaveLength(1);
        expect(s.holds).toHaveLength(2);
        expect(s.enrolments).toHaveLength(4);
        expect(new Set(s.enrolments.map(e => e.backend))).toEqual(new Set(['direct', 'baileys', 'browser']));
        expect(new Set(s.enrolments.map(e => e.owner_user_id))).toEqual(new Set([f.owner, f.other]));
        expect(s.enrolments.every(e => e.state === 'stopped' && e.stop_reason === 'reply_received')).toBe(true);
        expect(s.stopAudits).toBe(4);
    });
    it('does not acknowledge a service lease while the real application COMMIT is pending', async () => {
        const f = await fixture(), entered = deferred(), resume = deferred();
        const paused: SqlPool = { async connect() { const client = await appDriver.connect(); return { async query<Row>(text: string, values?: unknown[]) { if (text === 'COMMIT') {
                    entered.resolve();
                    await resume.promise;
                } return client.query<Row>(text, values); }, release(error?: Error) { client.release(error); } }; } };
        const pending = f.worker({ pool: paused }).run();
        try {
            await Promise.race([entered.promise, pending.then(() => { throw Error('Expected application commit boundary'); })]);
            const before = await state(f);
            expect(before.outbox.state).toBe('delivering');
            expect(before.receipts).toHaveLength(0);
            expect(before.holds).toHaveLength(0);
            expect(before.enrolments.every(e => e.state === 'active')).toBe(true);
        }
        finally {
            resume.resolve();
        }
        expect(await pending).toEqual({ status: 'delivered' });
        expect((await state(f)).outbox.state).toBe('acknowledged');
    });
    it('recovers a lost application COMMIT response by replaying the immutable receipt before ACK', async () => {
        const f = await fixture(), outbox = f.outbox({ leaseSeconds: 1 });
        let interrupted = false;
        const lost: SqlPool = { async connect() { const client = await appDriver.connect(); return { async query<Row>(text: string, values?: unknown[]) { const result = await client.query<Row>(text, values); if (text === 'COMMIT' && !interrupted) {
                    interrupted = true;
                    throw Object.assign(Error('Synthetic lost app response'), { code: 'ECONNRESET' });
                } return result; }, release(error?: Error) { client.release(error); } }; } };
        expect(await f.worker({ pool: lost }, outbox).run()).toEqual({ status: 'retry' });
        const before = await state(f);
        expect(before.outbox.state).toBe('delivering');
        expect(before.receipts).toHaveLength(1);
        expect(before.holds).toHaveLength(2);
        await servicePool.query('SELECT pg_sleep(1.2)');
        expect(await f.worker({}, outbox).run()).toEqual({ status: 'duplicate' });
        const after = await state(f);
        expect(after.outbox.state).toBe('acknowledged');
        expect(after.receipts).toEqual(before.receipts);
        expect(after.holds).toEqual(before.holds);
        expect(after.stopAudits).toBe(before.stopAudits);
    });
    it('rolls back policy effects on an application receipt failure and leaves service work recoverable', async () => {
        const f = await fixture('whatsapp'), outbox = f.outbox({ leaseSeconds: 1 });
        const failing: SqlPool = { async connect() { const client = await appDriver.connect(); return { async query<Row>(text: string, values?: unknown[]) { if (text.startsWith('INSERT INTO public.communication_event_receipts'))
                    await client.query('SELECT 1/0'); return client.query<Row>(text, values); }, release(error?: Error) { client.release(error); } }; } };
        expect(await f.worker({ pool: failing }, outbox).run()).toEqual({ status: 'retry' });
        const before = await state(f);
        expect(before.outbox.state).toBe('delivering');
        expect(before.receipts).toHaveLength(0);
        expect(before.holds).toHaveLength(0);
        expect(before.stopAudits).toBe(0);
        expect(before.enrolments.every(e => e.state === 'active')).toBe(true);
        await servicePool.query('SELECT pg_sleep(1.2)');
        expect(await f.worker({}, outbox).run()).toEqual({ status: 'delivered' });
        expect((await state(f)).outbox.state).toBe('acknowledged');
        expect((await state(f)).holds).toHaveLength(2);
    });
    it('recovers a lost service ACK commit with exact terminal provenance and unchanged application history', async () => {
        const f = await fixture();
        let ack = false, interrupted = false, last: {
            delivery: OutboxDelivery;
            receipt: ApplicationReplyReceipt;
        } | undefined;
        const lost: SqlPool = { async connect() { const client = await serviceDriver.connect(); return { async query<Row>(text: string, values?: unknown[]) { if (text.includes("SET state='acknowledged'"))
                    ack = true; const result = await client.query<Row>(text, values); if (text === 'COMMIT' && ack && !interrupted) {
                    interrupted = true;
                    throw Object.assign(Error('Synthetic lost ACK response'), { code: 'ECONNRESET' });
                } return result; }, release(error?: Error) { client.release(error); } }; } };
        const repo = f.outbox({ pool: lost }), port: EventOutboxPort = { claim: () => repo.claim(), acknowledge(input) { last = structuredClone(input); return repo.acknowledge(input); } };
        expect(await f.worker({}, port).run()).toEqual({ status: 'retry' });
        const before = await state(f);
        expect(before.outbox.state).toBe('acknowledged');
        expect(last).toBeDefined();
        expect(await f.outbox().acknowledge(last!)).toEqual({ status: 'duplicate' });
        expect(await state(f)).toEqual(before);
    });
    it('commits an application review without a fictional hold, while service review keeps admission closed', async () => {
        const f = await fixture('email', true);
        expect(await f.worker().run()).toEqual({ status: 'delivered' });
        const s = await state(f);
        expect(s.outbox.state).toBe('acknowledged');
        expect(s.receipts).toHaveLength(1);
        expect(s.holds).toHaveLength(0);
        expect(s.enrolments.every(e => e.state === 'active')).toBe(true);
        expect((await appPool.query('SELECT code,resolved_at FROM public.communication_reply_review_latches WHERE organization_id=$1', [f.org])).rows).toEqual([{ code: 'protocol', resolved_at: null }]);
        const client = await servicePool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SET LOCAL ROLE communications_control');
            await expect(client.query('SELECT communications.assert_dispatch_reply_barrier($1,$2)', ['acquire', f.org])).rejects.toThrow('remains pending');
        }
        finally {
            await client.query('ROLLBACK');
            client.release();
        }
    });
    it('leaves work unacknowledged in off mode and applies it after explicit enforcement and lease expiry', async () => {
        const f = await fixture(), outbox = f.outbox({ leaseSeconds: 1 });
        vi.stubEnv('CAMPAIGN_REPLY_MONITOR_MODE', 'off');
        expect(await f.worker({}, outbox).run()).toEqual({ status: 'retry' });
        expect((await state(f)).receipts).toHaveLength(0);
        expect((await state(f)).outbox.state).toBe('delivering');
        vi.stubEnv('CAMPAIGN_REPLY_MONITOR_MODE', 'enforce');
        await servicePool.query('SELECT pg_sleep(1.2)');
        expect(await f.worker({}, outbox).run()).toEqual({ status: 'delivered' });
        expect((await state(f)).holds).toHaveLength(2);
    });
});
