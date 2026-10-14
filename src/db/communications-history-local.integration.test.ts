import { WebhookCodec } from '../../communications/packages/core/src/webhook-codec';
import { createPostgresWebhookRepository } from '../../communications/packages/storage-postgres/src/webhook-repository';
import { createPostgresReplyBarrier } from '../../communications/packages/storage-postgres/src/reply-barrier';
import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createCommunicationsStandaloneFixture } from './communications-standalone-test-support';
import { createPostgresHistoryCheckpoints, type HistoryCheckpointOptions } from '../../communications/packages/storage-postgres/src/history-checkpoints';
import { HistoryCheckpointCodec } from '../../communications/packages/storage-postgres/src/history-checkpoint-codec';
import { EventCodec } from '../../communications/packages/core/src/event-codec';
import type { RecordedLifecycleConnection } from '../../communications/packages/core/src/connection-lifecycle';
// PREPARED ONLY: exact standalone003/007 approval+application required. No DDL/bootstrap/providers.
const enabled = process.env.COMMUNICATIONS_STANDALONE_AUDIT === '1' && process.env.COMMUNICATIONS_HISTORY_AUDIT === '1';
describe.skipIf(!enabled)('standalone original-source history checkpoint SQL', () => {
    const local = createCommunicationsStandaloneFixture(), grants: string[][] = [];
    const codec = new HistoryCheckpointCodec({ activeVersion: 'history-fixture', keys: [{ version: 'history-fixture', encryptionKey: Buffer.alloc(32, 201), digestKey: Buffer.alloc(32, 202) }] }), eventCodec = new EventCodec({ activeVersion: 'history-event-fixture', keys: [{ version: 'history-event-fixture', encryptionKey: Buffer.alloc(32, 203), digestKey: Buffer.alloc(32, 204) }] });
    beforeAll(async () => local.preflight(['communications.history_refreshes', 'communications.history_initial_sync', 'communications.connection_retirements']));
    afterAll(async () => {
        try {
            for (const s of grants)
                await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', s);
        }
        finally {
            await local.close();
        }
    });
    async function fixture(channel: 'email' | 'whatsapp' | 'linkedin' = 'linkedin') {
        const nonce = randomUUID(), platform = channel === 'email' ? 'gmail' : channel, record: RecordedLifecycleConnection = { binding: { applicationId: `history-${nonce}`, tenantId: 'tenant', ownerId: 'owner', connectionId: `history-c-${nonce}`, accountId: `history-a-${nonce}`, generation: 1, channel, platform, backend: 'unipile' }, providerAccountId: `provider-${nonce}`, sourceId: 'source', ownerIdentity: { namespace: channel === 'email' ? 'unipile.v1.google.mail.id' : channel === 'whatsapp' ? 'unipile.v1.whatsapp.im.phone_number' : 'unipile.v1.linkedin.im.id', value: channel === 'whatsapp' ? '+61412345678' : 'opaque-owner' } }, b = record.binding, integrationId = `history-i-${nonce}`;
        const c = await local.pool.connect();
        try {
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE communications_control');
            await c.query("INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [b.applicationId, b.tenantId, b.ownerId]);
            await c.query('INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,$2,$3,$4,$5,clock_timestamp())', [b.accountId, channel, 'synthetic-history', createHash('sha256').update(nonce).digest('hex'), 'fixture']);
            await c.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,$2,$3,$4,$5,$6,$7,'unipile',1,'connected',true)", [b.connectionId, b.applicationId, b.tenantId, b.ownerId, b.accountId, channel, platform]);
            await c.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,provider_account_digest,encrypted_provider_account_id,provider_account_key_version,credential_reference,authority,capabilities) VALUES($1,1,$2,$3,$4,$5,$6,$7,'unipile',$8,'v1','synthetic-history-config',$9,'synthetic-provider-envelope','fixture','synthetic-vault','service','{}')", [b.connectionId, b.applicationId, b.tenantId, b.ownerId, b.accountId, channel, platform, integrationId, createHash('sha256').update(record.providerAccountId).digest('hex')]);
            await c.query('COMMIT');
        }
        catch (e) {
            await c.query('ROLLBACK');
            throw e;
        }
        finally {
            c.release();
        }
        grants.push([b.applicationId, b.tenantId, b.ownerId]);
        const now = (await local.pool.query("SELECT clock_timestamp()-interval '1 minute' AS since")).rows[0].since as Date, query = { binding: b, scope: 'all-replies', since: now.toISOString(), cursor: null, refresh: true }, options: HistoryCheckpointOptions = { pool: local.driver, binding: b, record, integrationId, providerConfigurationReference: 'synthetic-history-config', subscriberId: `subscriber-${nonce}`, codec, eventCodec }, repo = createPostgresHistoryCheckpoints(options);
        const page = (ticket: NonNullable<Awaited<ReturnType<typeof repo.begin>>>) => ({ events: [{ type: 'message' as const, reference: { binding: b, id: 'synthetic-message' }, direction: 'inbound' as const, sender: channel === 'email' ? { kind: 'email' as const, value: 'peer@example.com' } : channel === 'whatsapp' ? { kind: 'phone' as const, value: '+61400000000' } : { kind: 'linkedin_profile' as const, value: 'https://www.linkedin.com/in/fixture-peer/' }, occurredAt: query.since }], nextCursor: null, coverage: { binding: b, scope: query.scope, from: query.since, through: ticket.startedAt, observedAt: new Date().toISOString(), complete: true, initialSyncComplete: true, invalidated: false }, provenance: { providerAccountId: record.providerAccountId, sourceId: record.sourceId, initialSyncEvidence: { kind: channel === 'email' ? 'query_baseline' as const : 'provider_sync_success' as const, record, evidenceId: 'synthetic-authenticated-sync', completedAt: query.since, ...(channel === 'email' ? { query: { scope: query.scope, from: query.since, through: ticket.startedAt } } : {}) }, outbound: [], exhausted: true, refresh: true } });
        return { record, b, query, options, repo, page };
    }
    it.each(['email', 'whatsapp', 'linkedin'] as const)('atomically mirrors exact %s coverage and encrypted message/subscriber outbox', async (channel) => { const f = await fixture(channel), ticket = (await f.repo.begin(f.query))!; expect((await f.repo.commit(ticket, f.page(ticket))).coverage.complete).toBe(true); const { rows: [row] } = await local.pool.query('SELECT complete,initial_sync_complete,invalidated FROM communications.event_cursors WHERE connection_id=$1', [f.b.connectionId]); expect(row).toEqual({ complete: true, initial_sync_complete: true, invalidated: false }); expect((await local.pool.query('SELECT count(*)::integer AS n FROM communications.events e JOIN communications.event_outbox o ON o.event_id=e.id WHERE e.connection_id=$1', [f.b.connectionId])).rows[0].n).toBe(1); expect((await f.repo.coverage(f.query))?.complete).toBe(true); });
    it('serializes concurrent refresh claims into one ticket and a busy result', async () => { const f = await fixture(); const result = await Promise.all([f.repo.begin(f.query), f.repo.begin(f.query)]); expect(result.filter(Boolean)).toHaveLength(1); expect(result.filter(r => r === null)).toHaveLength(1); });
    it('tenant ingress revision changes during scan force incomplete coverage', async () => {
        const f = await fixture(), ticket = (await f.repo.begin(f.query))!, c = await local.pool.connect();
        try {
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE communications_control');
            await c.query('SELECT communications.advance_reply_barrier($1,$2)', [f.b.applicationId, f.b.tenantId]);
            await c.query('COMMIT');
        }
        finally {
            c.release();
        }
        expect((await f.repo.commit(ticket, f.page(ticket))).coverage).toMatchObject({ complete: false, invalidated: true });
    });
    it('revoked current grant never publishes complete coverage', async () => { const f = await fixture(), ticket = (await f.repo.begin(f.query))!; await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1', [f.b.applicationId]); await expect(f.repo.commit(ticket, f.page(ticket))).rejects.toThrow(); expect((await local.pool.query('SELECT complete,invalidated FROM communications.event_cursors WHERE connection_id=$1', [f.b.connectionId])).rows[0]).toEqual({ complete: false, invalidated: true }); });
    it('event/outbox transaction rollback retains invalidated readiness without events', async () => {
        const f = await fixture(), ticket = (await f.repo.begin(f.query))!, driver = { async connect() {
                const c = await local.driver.connect();
                return { query: async <Row>(sql: string, values?: unknown[]) => {
                        if (sql.includes('INSERT INTO communications.event_outbox'))
                            throw Error('Synthetic outbox failure');
                        return c.query<Row>(sql, values);
                    }, release: (error?: Error) => c.release(error) };
            } };
        await expect(createPostgresHistoryCheckpoints({ ...f.options, pool: driver }).commit(ticket, f.page(ticket))).rejects.toThrow();
        expect((await local.pool.query('SELECT count(*)::integer AS n FROM communications.events WHERE connection_id=$1', [f.b.connectionId])).rows[0].n).toBe(0);
        expect((await local.pool.query('SELECT complete FROM communications.event_cursors WHERE connection_id=$1', [f.b.connectionId])).rows[0].complete).toBe(false);
    });
    it('semantic conflict preserves original message and queues review plus durable latch', async () => { const f = await fixture(), first = (await f.repo.begin(f.query))!; await f.repo.commit(first, f.page(first)); const second = (await f.repo.begin(f.query))!, page = f.page(second); page.events[0].sender = { kind: 'linkedin_profile', value: 'https://www.linkedin.com/in/changed/' }; expect((await f.repo.commit(second, page)).coverage).toMatchObject({ complete: false, invalidated: true }); expect((await local.pool.query('SELECT count(*)::integer AS n FROM communications.reply_review_latches WHERE application_id=$1', [f.b.applicationId])).rows[0].n).toBe(1); expect((await local.pool.query("SELECT count(*)::integer AS n FROM communications.events WHERE connection_id=$1 AND source_namespace='reply_review/v1'", [f.b.connectionId])).rows[0].n).toBe(1); });
    async function syncFixture(product = 'classic') {
        const f = await fixture(), captureCodec = new WebhookCodec({ activeVersion: 'history-wire-fixture', keys: [{ version: 'history-wire-fixture', encryptionKey: Buffer.alloc(32, 205), digestKey: Buffer.alloc(32, 206) }] }), replyBarrier = createPostgresReplyBarrier({ binding: f.b, integrationId: f.options.integrationId, codec: captureCodec, eventCodec }), capture = createPostgresWebhookRepository({ pool: local.driver, binding: f.b, integrationId: f.options.integrationId, providerConfigurationReference: f.options.providerConfigurationReference, subscriberId: f.options.subscriberId, codec: captureCodec, eventCodec, replyBarrier }), rawBody = Buffer.from(JSON.stringify({ AccountStatus: { account_id: f.record.providerAccountId, account_type: 'LINKEDIN', message: 'SYNC_SUCCESS', product } })), vector = [f.b.applicationId, f.b.tenantId, f.b.ownerId, f.b.connectionId, f.b.accountId, f.b.generation, f.b.channel, f.b.platform, f.b.backend], key = createHash('sha256').update(JSON.stringify(['communications.webhook.receipt.v1', vector, createHash('sha256').update(rawBody).digest('hex')])).digest('hex');
        await capture.capture({ binding: f.b, key, rawBody, receivedAt: new Date().toISOString() });
        const claimed = await capture.claim({ binding: f.b, key });
        if (claimed.kind !== 'claimed')
            throw Error('Expected synthetic original claim');
        return { ...f, claim: claimed.record, repo: createPostgresHistoryCheckpoints({ ...f.options, captureCodec, expectedSyncProduct: 'classic' }) };
    }
    it('actual retained wire receipt authenticates source sync completion and owned terminal capture atomically', async () => { const f = await syncFixture(); expect(await f.repo.initialSync()).toBeNull(); expect(await f.repo.recordInitialSync(f.claim)).toEqual({ status: 'recorded' }); expect(await f.repo.initialSync()).toEqual({ kind: 'provider_sync_success', record: f.record, completedAt: f.claim.receivedAt, evidenceId: f.claim.key }); expect((await local.pool.query('SELECT state FROM communications.webhook_inbox WHERE id=$1', [f.claim.key])).rows[0].state).toBe('processed'); });
    it('wrong product never records initial completion or ACKs an original receipt', async () => { const f = await syncFixture('recruiter'); await expect(f.repo.recordInitialSync(f.claim)).rejects.toThrow(); expect(await f.repo.initialSync()).toBeNull(); expect((await local.pool.query('SELECT state FROM communications.webhook_inbox WHERE id=$1', [f.claim.key])).rows[0].state).toBe('processing'); });
    it('explicit invalidation cannot leave fresh dispatch coverage', async () => { const f = await fixture(), ticket = (await f.repo.begin(f.query))!; await f.repo.commit(ticket, f.page(ticket)); await f.repo.invalidate(f.query); expect(await f.repo.coverage(f.query)).toMatchObject({ complete: false, invalidated: true }); });
});
