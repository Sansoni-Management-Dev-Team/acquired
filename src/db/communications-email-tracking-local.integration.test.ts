import { createHash, createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConnectionBinding, OperationSnapshot } from '../../communications/packages/contracts/src';
import { JournalCodec } from '../../communications/packages/core/src/journal-codec';
import { createPostgresEmailTracking, type EmailTrackingOptions, type VerifiedEmailSentAssociation } from '../../communications/packages/storage-postgres/src/email-tracking';
import type { SqlPool } from '../../communications/packages/storage-postgres/src/webhook-repository';
import { createCommunicationsStandaloneFixture } from './communications-standalone-test-support';
// PREPARED / UNEXECUTED until exact standalone004 approval. No startup/bootstrap/DDL.
// Synthetic reserved journal fixture is SQL-only characterization, not app/provider admission.
const enabled = process.env.COMMUNICATIONS_STANDALONE_AUDIT === '1' && process.env.COMMUNICATIONS_EMAIL_TRACKING_AUDIT === '1';
describe.skipIf(!enabled)('standalone5446 durable email tracking (requires specifically approved004)', () => {
    const local = createCommunicationsStandaloneFixture(), retained: ConnectionBinding[] = [];
    const codec = new JournalCodec({ activeVersion: 'fixture-k1', keys: [{ version: 'fixture-k1', encryptionKey: Buffer.alloc(32, 71), digestKey: Buffer.alloc(32, 72) }] });
    const target = { kind: 'email' as const, value: 'synthetic-recipient@example.test' };
    const recipientDigest = { keyVersion: 'fixture-r1', digest: (recipient: unknown, version: string) => createHmac('sha256', `synthetic-recipient-${version}`).update(JSON.stringify(recipient)).digest('hex') };
    beforeAll(() => local.preflight(['communications.email_tracking_acknowledgements', 'communications.email_tracking_associations']), 20000);
    afterAll(async () => {
        try {
            for (const b of retained)
                await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', [b.applicationId, b.tenantId, b.ownerId]);
        }
        finally {
            await local.close();
        }
    }, 20000);
    async function fixture(platform: 'gmail' | 'outlook' | 'imap' = 'gmail') {
        const suffix = randomUUID(), b: ConnectionBinding = { applicationId: `email-fixture-app-${suffix}`, tenantId: `email-fixture-tenant-${suffix}`, ownerId: `email-fixture-owner-${suffix}`, connectionId: `email-fixture-connection-${suffix}`, accountId: `email-fixture-account-${suffix}`, generation: 1, channel: 'email', platform, backend: 'unipile' };
        const snapshot: OperationSnapshot = { binding: b, key: `email-fixture-op-${suffix}`, operation: 'message', payloadDigest: 'a'.repeat(64) }, identitySnapshot: OperationSnapshot = { ...snapshot, key: `identity-${suffix}` }, provider = `synthetic-provider-${suffix}`, integration = `synthetic-integration-${suffix}`, configuration = `synthetic-config-${suffix}`, journal = `synthetic-journal-${suffix}`, tracking = `synthetic-tracking-${suffix}`;
        const identity = { providerAccountId: provider }, context = { recipient: target }, idEnvelope = codec.encode(identitySnapshot, 'context', identity), contextEnvelope = codec.encode(snapshot, 'context', context);
        const c = await local.pool.connect();
        try {
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE communications_control');
            await c.query("INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [b.applicationId, b.tenantId, b.ownerId]);
            await c.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,'email','email_tracking_fixture',$2,'fixture-identity',clock_timestamp())", [b.accountId, createHash('sha256').update(suffix).digest('hex')]);
            await c.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,$2,$3,$4,$5,'email',$6,'unipile',1,'connected',true)", [b.connectionId, b.applicationId, b.tenantId, b.ownerId, b.accountId, platform]);
            await c.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,provider_account_digest,encrypted_provider_account_id,provider_account_key_version,authority,capabilities) VALUES($1,1,$2,$3,$4,$5,'email',$6,'unipile',$7,'v1',$8,$9,$10,$11,'service','{}')", [b.connectionId, b.applicationId, b.tenantId, b.ownerId, b.accountId, platform, integration, configuration, codec.digest(identitySnapshot, 'context', identity), JSON.stringify(idEnvelope), idEnvelope.keyVersion]);
            await c.query('SELECT communications.lock_reply_barrier($1,$2)', [b.applicationId, b.tenantId]);
            await c.query("INSERT INTO communications.account_leases(account_id,owner_token,fencing_token,expires_at) VALUES($1,'synthetic-owner',1,clock_timestamp()+interval '1 hour')", [b.accountId]);
            await c.query("INSERT INTO communications.operation_journal(id,application_id,tenant_id,owner_id,operation_key,connection_id,generation,account_id,operation,payload_digest,recipient_digest,digest_version,recipient_key_version,encrypted_operation_context,operation_context_key_version,operation_context_digest,claim_token,claim_until,fencing_token,lease_owner_token) VALUES($1,$2,$3,$4,$5,$6,1,$7,'message',$8,$9,'message-v1','fixture-r1',$10,$11,$12,'synthetic-claim',clock_timestamp()+interval '1 hour',1,'synthetic-owner')", [journal, b.applicationId, b.tenantId, b.ownerId, snapshot.key, b.connectionId, b.accountId, snapshot.payloadDigest, recipientDigest.digest(target, 'fixture-r1'), JSON.stringify(contextEnvelope), contextEnvelope.keyVersion, codec.digest(snapshot, 'context', context)]);
            for (const kind of ['account', 'application'])
                await c.query("INSERT INTO communications.quota_buckets(account_id,bucket_kind,application_id,window_kind,window_start,used,limit_value) VALUES($1,$2,$3,'hour',date_trunc('hour',clock_timestamp()),1,100)", [b.accountId, kind, kind === 'account' ? '' : b.applicationId]);
            await c.query("UPDATE communications.operation_journal SET state='dispatching',quota_reserved=true WHERE id=$1", [journal]);
            await c.query("UPDATE communications.operation_journal SET state='unknown' WHERE id=$1", [journal]);
            await c.query('COMMIT');
            retained.push(b);
        }
        catch (error) {
            await c.query('ROLLBACK');
            throw error;
        }
        finally {
            c.release();
        }
        const association: VerifiedEmailSentAssociation = { receipt: { message: { binding: b, id: `actual-email-${suffix}` }, recipient: target, submittedAt: '2026-10-14T01:00:00.000Z' }, rfcMessageId: `<original-${suffix}@example.test>`, evidenceDigest: createHash('sha256').update(`synthetic-verified-${suffix}`).digest('hex') };
        const options: EmailTrackingOptions = { pool: local.driver, binding: b, integrationId: integration, providerConfigurationReference: configuration, providerAccountId: provider, codec, recipientDigest, trackingDigest: { keyVersion: 'fixture-t1', versions: ['fixture-t1'], digest: (input, version) => createHmac('sha256', `synthetic-tracking-${version}`).update(JSON.stringify(input)).digest('hex') }, decodeProviderAccount: input => {
                expect(input.binding).toEqual(b);
                const payload = codec.decode(identitySnapshot, 'context', JSON.parse(input.encryptedProviderAccountId)) as {
                    providerAccountId: string;
                };
                expect(codec.digest(identitySnapshot, 'context', payload, input.keyVersion)).toBe(input.digest);
                return payload.providerAccountId;
            }, authenticateNotification: async (input) => input.rawHeaders.length === 2 && input.rawHeaders[0] === 'Synthetic-Auth' && input.rawHeaders[1] === 'synthetic-only', verifySentMessage: vi.fn(async () => structuredClone(association)) };
        const notification = (extra: Record<string, unknown> = {}) => ({ rawHeaders: ['Synthetic-Auth', 'synthetic-only'], rawBody: Buffer.from(JSON.stringify({ event: 'mail_sent', tracking_id: tracking, account_id: provider, email_id: association.receipt.message.id, message_id: association.rfcMessageId, date: '2026-10-14T01:00:00.000Z', role: 'sent', origin: 'unipile', to_attendees: [{ identifier: target.value }], cc_attendees: [], bcc_attendees: [], ...extra })) });
        return { b, snapshot, provider, integration, configuration, journal, tracking, options, association, notification, repo: createPostgresEmailTracking(options) };
    }
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    async function independentOriginal(f: Fixture) {
        const snapshot = { ...f.snapshot, key: `second-${randomUUID()}` }, journal = `second-journal-${randomUUID()}`, context = { recipient: target }, envelope = codec.encode(snapshot, 'context', context);
        const c = await local.pool.connect();
        try {
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE communications_control');
            await c.query('SELECT communications.lock_reply_barrier($1,$2)', [f.b.applicationId, f.b.tenantId]);
            await c.query(`INSERT INTO communications.operation_journal(id,application_id,tenant_id,owner_id,operation_key,connection_id,generation,account_id,operation,payload_digest,recipient_digest,digest_version,recipient_key_version,encrypted_operation_context,operation_context_key_version,operation_context_digest,claim_token,claim_until,fencing_token,lease_owner_token) SELECT $1,application_id,tenant_id,owner_id,$2,connection_id,generation,account_id,operation,payload_digest,recipient_digest,digest_version,recipient_key_version,$3,$4,$5,claim_token,claim_until,fencing_token,lease_owner_token FROM communications.operation_journal WHERE id=$6`, [journal, snapshot.key, JSON.stringify(envelope), envelope.keyVersion, codec.digest(snapshot, 'context', context), f.journal]);
            await c.query('UPDATE communications.quota_buckets SET used=used+1 WHERE account_id=$1', [f.b.accountId]);
            await c.query("UPDATE communications.operation_journal SET state='dispatching',quota_reserved=true WHERE id=$1", [journal]);
            await c.query("UPDATE communications.operation_journal SET state='unknown' WHERE id=$1", [journal]);
            await c.query('COMMIT');
            return { snapshot, journal };
        }
        catch (error) {
            await c.query('ROLLBACK');
            throw error;
        }
        finally {
            c.release();
        }
    }
    async function state(f: Fixture) { return { journal: (await local.pool.query('SELECT * FROM communications.operation_journal WHERE id=$1', [f.journal])).rows[0], quota: (await local.pool.query('SELECT * FROM communications.quota_buckets WHERE account_id=$1 ORDER BY bucket_kind', [f.b.accountId])).rows }; }
    function lossDriver(kind: 'ack' | 'association') {
        let armed = false, lost = false;
        const discarded: Error[] = [];
        const driver: SqlPool = { async connect() {
                const c = await local.driver.connect();
                return { async query<Row>(sql: string, values?: unknown[]) {
                        if (sql.startsWith(`INSERT INTO communications.email_tracking_${kind === 'ack' ? 'acknowledgements' : 'associations'}`))
                            armed = true;
                        const result = await c.query<Row>(sql, values);
                        if (sql === 'COMMIT' && armed && !lost) {
                            lost = true;
                            throw Error('Synthetic response lost after actual COMMIT');
                        }
                        return result;
                    }, release(error) {
                        if (error)
                            discarded.push(error);
                        c.release(error);
                    } };
            } };
        return { driver, discarded };
    }
    it.each(['gmail', 'outlook', 'imap'] as const)('commits encrypted %s ACK then independently verified association without altering quota/journal', async (platform) => { const f = await fixture(platform), before = await state(f); expect(await f.repo.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking })).toEqual({ kind: 'recorded' }); const raw = (await local.pool.query('SELECT * FROM communications.email_tracking_acknowledgements WHERE journal_id=$1', [f.journal])).rows[0]; expect(JSON.stringify(raw)).not.toContain(f.tracking); expect(JSON.stringify(raw)).not.toContain(f.provider); expect(await f.repo.associate({ snapshot: f.snapshot, trackingId: f.tracking, notification: f.notification() })).toEqual({ kind: 'associated', association: f.association }); expect(await f.repo.get(f.snapshot)).toEqual({ trackingId: f.tracking, association: f.association }); expect(await state(f)).toEqual(before); });
    it('concurrent exact ACK duplicates commit one immutable row', async () => { const f = await fixture(); const results = await Promise.all([f.repo.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking }), f.repo.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking })]); expect(results.map(v => v.kind).sort()).toEqual(['duplicate', 'recorded']); expect((await local.pool.query('SELECT count(*)::integer AS n FROM communications.email_tracking_acknowledgements WHERE journal_id=$1', [f.journal])).rows[0].n).toBe(1); });
    it('requires mailbox verification no later than the DB clock', async () => { const f = await fixture(); await local.pool.query("UPDATE communications.physical_accounts SET verified_at=clock_timestamp()+interval '1 day' WHERE id=$1", [f.b.accountId]); await expect(f.repo.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking })).rejects.toThrow('Email tracking unavailable'); expect((await local.pool.query('SELECT count(*)::integer AS n FROM communications.email_tracking_acknowledgements WHERE journal_id=$1', [f.journal])).rows[0].n).toBe(0); });
    it('does not reuse one original tracking ID for a different independent reserved operation', async () => { const f = await fixture(); await f.repo.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking }); const other = await independentOriginal(f), before = await state(f); await expect(f.repo.recordAcknowledgement({ snapshot: other.snapshot, trackingId: f.tracking })).rejects.toThrow('Email tracking unavailable'); expect((await local.pool.query('SELECT count(*)::integer AS n FROM communications.email_tracking_acknowledgements WHERE journal_id=$1', [other.journal])).rows[0].n).toBe(0); expect(await state(f)).toEqual(before); });
    it('fails closed when persisted tracking key inventory is omitted during rotation', async () => { const f = await fixture(); await f.repo.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking }); const other = await independentOriginal(f); const full = createPostgresEmailTracking({ ...f.options, trackingDigest: { ...f.options.trackingDigest, keyVersion: 'fixture-t2', versions: ['fixture-t1', 'fixture-t2'] } }); expect(await full.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking })).toEqual({ kind: 'duplicate' }); const missing = createPostgresEmailTracking({ ...f.options, trackingDigest: { ...f.options.trackingDigest, keyVersion: 'fixture-t2', versions: ['fixture-t2'] } }); await expect(missing.recordAcknowledgement({ snapshot: other.snapshot, trackingId: f.tracking })).rejects.toThrow('Email tracking unavailable'); });
    it('handles event-before-ACK by remaining missing, then replay associates exactly once', async () => { const f = await fixture(); expect(await f.repo.associate({ snapshot: f.snapshot, trackingId: f.tracking, notification: f.notification() })).toEqual({ kind: 'missing' }); await f.repo.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking }); expect((await f.repo.associate({ snapshot: f.snapshot, trackingId: f.tracking, notification: f.notification() })).kind).toBe('associated'); expect((await f.repo.associate({ snapshot: f.snapshot, trackingId: f.tracking, notification: f.notification() })).kind).toBe('duplicate'); });
    it('does not accept unauthorized/inbound/cross-account notifications or a caller-invented provider receipt', async () => {
        const f = await fixture();
        await f.repo.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking });
        for (const extra of [{ event: 'mail_received' }, { account_id: 'other' }, { tracking_id: 'other' }, { message_id: '<changed@example.test>' }, { to_attendees: [{ identifier: 'other@example.test' }] }])
            expect(await f.repo.associate({ snapshot: f.snapshot, trackingId: f.tracking, notification: f.notification(extra) })).toEqual({ kind: 'review' });
        const bad = createPostgresEmailTracking({ ...f.options, verifySentMessage: async () => ({ ...f.association, receipt: { ...f.association.receipt, message: { binding: f.b, id: 'invented' } } }) });
        expect(await bad.associate({ snapshot: f.snapshot, trackingId: f.tracking, notification: f.notification() })).toEqual({ kind: 'review' });
        expect((await f.repo.get(f.snapshot))?.association).toBeNull();
    });
    it('rechecks revoked scope after read-only provider verification before storing any association', async () => { const f = await fixture(); await f.repo.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking }); const repo = createPostgresEmailTracking({ ...f.options, verifySentMessage: async () => { await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', [f.b.applicationId, f.b.tenantId, f.b.ownerId]); return structuredClone(f.association); } }); await expect(repo.associate({ snapshot: f.snapshot, trackingId: f.tracking, notification: f.notification() })).rejects.toThrow('Email tracking unavailable'); expect((await local.pool.query('SELECT count(*)::integer AS n FROM communications.email_tracking_associations a JOIN communications.email_tracking_acknowledgements k ON k.id=a.acknowledgement_id WHERE k.journal_id=$1', [f.journal])).rows[0].n).toBe(0); });
    it('recovers actual acknowledgement COMMIT response loss through exact replay, never a new operation', async () => { const f = await fixture(), lost = lossDriver('ack'), repo = createPostgresEmailTracking({ ...f.options, pool: lost.driver }); await expect(repo.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking })).rejects.toThrow('Email tracking unavailable'); expect(lost.discarded).toHaveLength(1); expect(await f.repo.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking })).toEqual({ kind: 'duplicate' }); });
    it('recovers actual association COMMIT response loss without changing the original unknown journal', async () => { const f = await fixture(); await f.repo.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking }); const before = await state(f), lost = lossDriver('association'), repo = createPostgresEmailTracking({ ...f.options, pool: lost.driver }); await expect(repo.associate({ snapshot: f.snapshot, trackingId: f.tracking, notification: f.notification() })).rejects.toThrow('Email tracking unavailable'); expect(lost.discarded).toHaveLength(1); expect(await f.repo.associate({ snapshot: f.snapshot, trackingId: f.tracking, notification: f.notification() })).toEqual({ kind: 'duplicate', association: f.association }); expect(await state(f)).toEqual(before); });
    it('direct control INSERT cannot commit after its scope grant expires inside the same transaction', async () => {
        const f = await fixture(), c = await local.pool.connect();
        const payload = { domain: 'communications.email-ack.v1', integrationId: f.integration, providerConfigurationReference: f.configuration, providerAccountId: f.provider, trackingId: f.tracking, recipient: target }, envelope = codec.encode(f.snapshot, 'context', payload), trackingDigest = f.options.trackingDigest.digest({ integrationId: f.integration, providerConfigurationReference: f.configuration, providerAccountId: f.provider, trackingId: f.tracking }, 'fixture-t1');
        try {
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE communications_control');
            await c.query('SELECT communications.lock_reply_barrier($1,$2)', [f.b.applicationId, f.b.tenantId]);
            await c.query('INSERT INTO communications.email_tracking_acknowledgements(id,journal_id,tracking_digest,tracking_key_version,encrypted_ack,ack_key_version,ack_digest,integration_id,provider_configuration_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [randomUUID(), f.journal, trackingDigest, 'fixture-t1', JSON.stringify(envelope), envelope.keyVersion, codec.digest(f.snapshot, 'context', payload), f.integration, f.configuration]);
            await c.query("UPDATE communications.access_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3", [f.b.applicationId, f.b.tenantId, f.b.ownerId]);
            await expect(c.query('COMMIT')).rejects.toMatchObject({ code: 'P0001' });
        }
        finally {
            await c.query('ROLLBACK');
            c.release();
        }
        expect((await local.pool.query('SELECT count(*)::integer AS n FROM communications.email_tracking_acknowledgements WHERE journal_id=$1', [f.journal])).rows[0].n).toBe(0);
    });
    it('exposes only committed exact association to original unknown reconciliation', async () => { const f = await fixture(), record = { snapshot: f.snapshot, recipient: target, state: 'unknown' as const, outcome: { status: 'unknown' as const } }, outcome = { status: 'submitted' as const, receipt: f.association.receipt }; expect(await f.repo.verifyReconciliation(record, outcome)).toBeNull(); await f.repo.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking }); await f.repo.associate({ snapshot: f.snapshot, trackingId: f.tracking, notification: f.notification() }); expect(await f.repo.verifyReconciliation(record, outcome)).toEqual(outcome); expect(await f.repo.verifyReconciliation(record, { status: 'submitted', receipt: { ...f.association.receipt, message: { binding: f.b, id: 'changed' } } })).toBeNull(); });
    it('requires FORCE RLS and denies control UPDATE/DELETE while retaining original history', async () => {
        const f = await fixture();
        await f.repo.recordAcknowledgement({ snapshot: f.snapshot, trackingId: f.tracking });
        const { rows } = await local.pool.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN('communications.email_tracking_acknowledgements'::regclass,'communications.email_tracking_associations'::regclass)");
        expect(rows).toHaveLength(2);
        expect(rows.every(r => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
        for (const action of ['UPDATE communications.email_tracking_acknowledgements SET ack_digest=ack_digest', 'DELETE FROM communications.email_tracking_acknowledgements']) {
            const c = await local.pool.connect();
            try {
                await c.query('BEGIN');
                await c.query('SET LOCAL ROLE communications_control');
                await expect(c.query(`${action} WHERE journal_id=$1`, [f.journal])).rejects.toMatchObject({ code: '42501' });
            }
            finally {
                await c.query('ROLLBACK');
                c.release();
            }
        }
    });
});
