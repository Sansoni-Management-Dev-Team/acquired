import { createHash, createHmac, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { createCommunicationsStandaloneFixture } from './communications-standalone-test-support';
import { ConnectionRetirementCodec, createPostgresConnectionRetirement, type ConnectionRetirementOptions } from '../../communications/packages/storage-postgres/src/connection-retirement';
import type { RecordedLifecycleConnection } from '../../communications/packages/core/src/connection-lifecycle';
import { JournalCodec } from '../../communications/packages/core/src/journal-codec';
import { createPostgresDispatchJournal } from '../../communications/packages/storage-postgres/src/dispatch-journal';
import type { SqlPool } from '../../communications/packages/storage-postgres/src/webhook-repository';
// PREPARED ONLY: requires separately approved/applied standalone003. No DDL/bootstrap/provider I/O.
// These cases test actual SQL authority/fences/commits with synthetic canonical identity proofs;
// they do not certify live provider ownership, remote sessions, or an activated app lifecycle.
const enabled = process.env.COMMUNICATIONS_STANDALONE_AUDIT === '1' && process.env.COMMUNICATIONS_RETIREMENT_AUDIT === '1';
describe.skipIf(!enabled)('approved standalone PostgreSQL connection retirement', () => {
    const local = createCommunicationsStandaloneFixture(), grants: string[][] = [];
    const keys = [{ version: 'retirement-fixture-v1', encryptionKey: Buffer.alloc(32, 191), digestKey: Buffer.alloc(32, 192) }], codec = new ConnectionRetirementCodec({ activeVersion: keys[0].version, keys });
    const digest = (value: unknown) => createHmac('sha256', Buffer.alloc(32, 193)).update(JSON.stringify(value)).digest('hex');
    beforeAll(async () => { await local.preflight(['communications.connection_retirements', 'communications.tenant_reply_barriers']); });
    afterAll(async () => { try {
        for (const scope of grants)
            await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', scope);
    }
    finally {
        await local.close();
    } });
    async function tx<T>(work: (client: Awaited<ReturnType<typeof local.pool.connect>>) => Promise<T>) { const client = await local.pool.connect(); try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE communications_control');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    } }
    async function fixture() {
        const nonce = randomUUID(), record: RecordedLifecycleConnection = { binding: { applicationId: `retirement-${nonce}`, tenantId: 'tenant', ownerId: 'owner', connectionId: `retirement-connection-${nonce}`, accountId: `retirement-physical-${nonce}`, generation: 1, channel: 'linkedin', platform: 'linkedin', backend: 'unipile' }, providerAccountId: `synthetic-provider-${nonce}`, sourceId: 'classic-source', ownerIdentity: { namespace: 'unipile.v1.linkedin.im.id', value: `opaque-owner-${nonce}` } }, b = record.binding, integrationId = `retirement-source-${nonce}`, physical = { namespace: 'retirement_fixture_canonical', value: `canonical-${nonce}` };
        await tx(async (c) => {
            await c.query("INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [b.applicationId, b.tenantId, b.ownerId]);
            await c.query('INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,$2,$3,$4,$5,clock_timestamp())', [b.accountId, b.channel, physical.namespace, digest(physical), 'physical-fixture-v1']);
            await c.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,$2,$3,$4,$5,'linkedin','linkedin','unipile',1,'connected',true)", [b.connectionId, b.applicationId, b.tenantId, b.ownerId, b.accountId]);
            await c.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,provider_account_digest,encrypted_provider_account_id,provider_account_key_version,credential_reference,authority,capabilities) VALUES($1,1,$2,$3,$4,$5,'linkedin','linkedin','unipile',$6,'v1','synthetic-retirement-config',$7,'synthetic-vault-envelope','provider-fixture-v1','synthetic-owner-vault','service','{}')", [b.connectionId, b.applicationId, b.tenantId, b.ownerId, b.accountId, integrationId, digest(record.providerAccountId)]);
            // A pending cursor lease is enough to prove retirement clears workers.
            // This fixture has no authenticated history scan, so it cannot certify
            // complete coverage or an initial sync, including with007 installed.
            await c.query("INSERT INTO communications.event_cursors(application_id,tenant_id,owner_id,connection_id,generation,account_id,scope_digest,complete,initial_sync_complete,invalidated,lease_token,lease_until) VALUES($1,$2,$3,$4,1,$5,$6,false,false,false,'synthetic-cursor-lease',clock_timestamp()+interval '1 minute')", [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.accountId, createHash('sha256').update(nonce).digest('hex')]);
        });
        grants.push([b.applicationId, b.tenantId, b.ownerId]);
        const verify = vi.fn<ConnectionRetirementOptions['verifyRecordedIdentity']>().mockImplementation(async (input) => ({ record: structuredClone(input.record), physicalIdentity: physical }));
        const options: ConnectionRetirementOptions = { pool: local.driver, record, integrationId, providerConfigurationReference: 'synthetic-retirement-config', codec, verifyRecordedIdentity: verify, providerAccountDigest: v => digest(v), physicalIdentityDigest: v => digest(v), transactionTimeoutMs: 10000, statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
        return { record, b, integrationId, physical, options, verify, key: `retirement-operation-${nonce}`, signal: new AbortController().signal, repo: createPostgresConnectionRetirement(options) };
    }
    async function prepare(f: Awaited<ReturnType<typeof fixture>>) { const result = await f.repo.prepareDisconnect(f.record, f.key, f.signal); expect(result.status).toBe('prepared'); if (result.status !== 'prepared')
        throw Error('Expected synthetic committed retirement'); return result.ticket; }
    it('atomically commits encrypted intent, original retirement and account-wide coverage invalidation', async () => {
        const f = await fixture();
        expect((await local.pool.query('SELECT invalidated,complete,initial_sync_complete,encrypted_cursor,cursor_key_version,lease_token FROM communications.event_cursors WHERE account_id=$1',[f.b.accountId])).rows[0]).toEqual({invalidated:false,complete:false,initial_sync_complete:false,encrypted_cursor:null,cursor_key_version:null,lease_token:'synthetic-cursor-lease'});
        const ticket = await prepare(f);
        const { rows: [row] } = await local.pool.query('SELECT * FROM communications.connection_retirements WHERE connection_id=$1', [f.b.connectionId]);
        expect(row.state).toBe('pending');
        expect(JSON.stringify(row)).not.toContain(f.record.providerAccountId);
        expect(row.token_hash).toBe(createHash('sha256').update(ticket.token).digest('hex'));
        expect((await local.pool.query('SELECT active,status FROM communications.connections WHERE id=$1', [f.b.connectionId])).rows[0]).toEqual({ active: false, status: 'disconnected' });
        expect((await local.pool.query('SELECT invalidated,complete,initial_sync_complete,lease_token,lease_until FROM communications.event_cursors WHERE account_id=$1', [f.b.accountId])).rows).toEqual([{ invalidated: true, complete: false, initial_sync_complete: false, lease_token: null, lease_until: null }]);
    });
    it('serializes concurrent preparation into one ticket and no replayed deletion authority', async () => { const f = await fixture(), results = await Promise.all([f.repo.prepareDisconnect(f.record, f.key, f.signal), createPostgresConnectionRetirement(f.options).prepareDisconnect(f.record, f.key, f.signal)]); expect(results.map(r => r.status).sort()).toEqual(['prepared', 'review']); expect((await local.pool.query('SELECT count(*)::integer AS count FROM communications.connection_retirements WHERE connection_id=$1', [f.b.connectionId])).rows[0].count).toBe(1); });
    it.each(['unknown', 'rejected'] as const)('keeps terminal %s intent and account fence without rewriting', async (status) => {
        const f = await fixture(), ticket = await prepare(f);
        expect(await f.repo.finishDisconnect(ticket, { status }, f.signal)).toEqual({ status: 'recorded' });
        const before = (await local.pool.query('SELECT * FROM communications.connection_retirements WHERE connection_id=$1', [f.b.connectionId])).rows[0];
        expect(await f.repo.prepareDisconnect(f.record, f.key, f.signal)).toEqual({ status: 'review' });
        expect(await f.repo.finishDisconnect(ticket, { status: 'disconnected' }, f.signal)).toEqual({ status: 'unknown' });
        expect((await local.pool.query('SELECT * FROM communications.connection_retirements WHERE connection_id=$1', [f.b.connectionId])).rows[0]).toEqual(before);
        await expect(tx(c => c.query("INSERT INTO communications.account_leases(account_id,owner_token,fencing_token,expires_at) VALUES($1,'blocked-new-worker',1,clock_timestamp()+interval '1 hour')", [f.b.accountId]))).rejects.toThrow(/retirement/);
    });
    it('successful exact replay is immutable and original generation cannot reactivate', async () => { const f = await fixture(), ticket = await prepare(f); expect(await f.repo.finishDisconnect(ticket, { status: 'disconnected' }, f.signal)).toEqual({ status: 'recorded' }); const before = (await local.pool.query('SELECT * FROM communications.connection_retirements WHERE connection_id=$1', [f.b.connectionId])).rows[0]; expect(await f.repo.prepareDisconnect(f.record, f.key, f.signal)).toEqual({ status: 'duplicate' }); expect(await f.repo.finishDisconnect(ticket, { status: 'disconnected' }, f.signal)).toEqual({ status: 'recorded' }); expect((await local.pool.query('SELECT * FROM communications.connection_retirements WHERE connection_id=$1', [f.b.connectionId])).rows[0]).toEqual(before); await expect(tx(c => c.query("UPDATE communications.connections SET active=true,status='connected',status_observed_at=clock_timestamp() WHERE id=$1", [f.b.connectionId]))).rejects.toThrow(/retired/); });
    it('blocks a new generation under an unresolved physical intent', async () => { const f = await fixture(); await prepare(f); await expect(tx(c => c.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,2,$2,$3,$4,$5,'linkedin','linkedin','unipile',$6,'v1','synthetic-retirement-config','service','{}')", [f.b.connectionId, f.b.applicationId, f.b.tenantId, f.b.ownerId, f.b.accountId, f.integrationId]))).rejects.toThrow(/retirement/); });
    it('blocks new authentication and fresh cursor leases after retirement', async () => { const f = await fixture(); await prepare(f); await expect(tx(c => c.query("INSERT INTO communications.auth_states(state_digest,application_id,tenant_id,owner_id,channel,platform,backend,redirect_origin,expires_at) VALUES($1,$2,$3,$4,'linkedin','linkedin','unipile','https://fixture.test',clock_timestamp()+interval '1 hour')", [createHash('sha256').update(randomUUID()).digest('hex'), f.b.applicationId, f.b.tenantId, f.b.ownerId]))).rejects.toThrow(/retirement/); await expect(tx(c => c.query("UPDATE communications.event_cursors SET lease_token='not-a-new-lease',lease_until=clock_timestamp()+interval '1 hour' WHERE account_id=$1", [f.b.accountId]))).rejects.toThrow(/Retirement/); });
    it('rejects an in-flight setup before creating any retirement intent', async () => { const f = await fixture(); await tx(c => c.query("INSERT INTO communications.auth_states(state_digest,application_id,tenant_id,owner_id,channel,platform,backend,redirect_origin,expires_at) VALUES($1,$2,$3,$4,'linkedin','linkedin','unipile','https://fixture.test',clock_timestamp()+interval '1 hour')", [createHash('sha256').update(randomUUID()).digest('hex'), f.b.applicationId, f.b.tenantId, f.b.ownerId])); expect(await f.repo.prepareDisconnect(f.record, f.key, f.signal)).toEqual({ status: 'review' }); expect((await local.pool.query('SELECT count(*)::integer AS count FROM communications.connection_retirements WHERE connection_id=$1', [f.b.connectionId])).rows[0].count).toBe(0); });
    it('rejects live physical leases and permits only settled expired leases', async () => { const f = await fixture(); await tx(c => c.query("INSERT INTO communications.account_leases(account_id,owner_token,fencing_token,expires_at) VALUES($1,'existing-worker',1,clock_timestamp()+interval '1 hour')", [f.b.accountId])); expect(await f.repo.prepareDisconnect(f.record, f.key, f.signal)).toEqual({ status: 'review' }); await tx(c => c.query("UPDATE communications.account_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1", [f.b.accountId])); await prepare(f); await expect(tx(c => c.query("UPDATE communications.account_leases SET owner_token='new-worker',fencing_token=2,expires_at=clock_timestamp()+interval '1 hour' WHERE account_id=$1", [f.b.accountId]))).rejects.toThrow(/retirement/); });
    it('rejects unresolved durable journal claims without a provider or quota write', async () => {
        const f = await fixture(), journalCodec = new JournalCodec({ activeVersion: 'claim-fixture', keys: [{ version: 'claim-fixture', encryptionKey: Buffer.alloc(32, 194), digestKey: Buffer.alloc(32, 195) }] });
        const journal = createPostgresDispatchJournal({ pool: local.driver, binding: f.b, integrationId: f.integrationId, providerConfigurationReference: 'synthetic-retirement-config', providerApiVersion: 'v1', authority: 'service', leaseOwnerToken: `claim-${randomUUID()}`, codec: journalCodec, recipientDigest: { keyVersion: 'recipient-fixture', digest: v => digest(v) } });
        expect((await journal.claim({ snapshot: { binding: f.b, key: `claim-${randomUUID()}`, operation: 'message', payloadDigest: 'b'.repeat(64) }, recipient: { kind: 'linkedin_profile', value: 'https://www.linkedin.com/in/synthetic-retirement/' } })).kind).toBe('claimed');
        expect(await f.repo.prepareDisconnect(f.record, f.key, f.signal)).toEqual({ status: 'review' });
        expect((await local.pool.query('SELECT count(*)::integer AS count FROM communications.quota_buckets WHERE account_id=$1', [f.b.accountId])).rows[0].count).toBe(0);
    });
    it('requires exact keyed canonical physical identity proof and current live grant', async () => { const f = await fixture(); f.verify.mockResolvedValueOnce({ record: f.record, physicalIdentity: { namespace: f.physical.namespace, value: 'wrong-canonical-person' } }); expect(await f.repo.prepareDisconnect(f.record, f.key, f.signal)).toEqual({ status: 'review' }); await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1', [f.b.applicationId]); expect(await f.repo.prepareDisconnect(f.record, f.key, f.signal)).toEqual({ status: 'review' }); });
    it('lost actual COMMIT leaves pending history and never returns a fresh ticket', async () => { const f = await fixture(); let failed = false; const driver: SqlPool = { async connect() { const c = await local.driver.connect(); return { async query<Row>(sql: string, values?: unknown[]) { const r = await c.query<Row>(sql, values); if (sql === 'COMMIT' && !failed) {
                failed = true;
                throw Error('Synthetic lost retirement COMMIT');
            } return r; }, release(error) { c.release(error); } }; } }; await expect(createPostgresConnectionRetirement({ ...f.options, pool: driver }).prepareDisconnect(f.record, f.key, f.signal)).rejects.toThrow('Connection retirement unavailable'); expect((await local.pool.query('SELECT state FROM communications.connection_retirements WHERE connection_id=$1', [f.b.connectionId])).rows[0].state).toBe('pending'); expect(await f.repo.prepareDisconnect(f.record, f.key, f.signal)).toEqual({ status: 'review' }); });
    it('forged token cannot settle an existing pending intent', async () => { const f = await fixture(), ticket = await prepare(f); expect(await f.repo.finishDisconnect({ ...ticket, token: 'z'.repeat(43) }, { status: 'disconnected' }, f.signal)).toEqual({ status: 'unknown' }); expect((await local.pool.query('SELECT state FROM communications.connection_retirements WHERE connection_id=$1', [f.b.connectionId])).rows[0].state).toBe('pending'); });
    it('new table is FORCE RLS/read scoped and has no DELETE or scoped mutation rights', async () => {
        const { rows: [row] } = await local.pool.query("SELECT relrowsecurity,relforcerowsecurity,has_table_privilege('communications_control','communications.connection_retirements','DELETE') AS control_delete,has_table_privilege('communications_scoped','communications.connection_retirements','UPDATE') AS scoped_update,has_table_privilege('communications_scoped','communications.auth_states','INSERT') AS scoped_auth,has_table_privilege('communications_scoped','communications.event_cursors','UPDATE') AS scoped_cursor,has_table_privilege('communications_scoped','communications.identity_aliases','INSERT') AS scoped_alias FROM pg_class WHERE oid='communications.connection_retirements'::regclass");
        expect(row).toEqual({ relrowsecurity: true, relforcerowsecurity: true, control_delete: false, scoped_update: false, scoped_auth: false, scoped_cursor: false, scoped_alias: false });
        const f = await fixture();
        await prepare(f);
        const client = await local.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SET LOCAL ROLE communications_scoped');
            await client.query("SELECT set_config('communications.application_id',$1,true),set_config('communications.tenant_id','other-tenant',true),set_config('communications.owner_id','other-owner',true)", [f.b.applicationId]);
            expect((await client.query('SELECT * FROM communications.connection_retirements WHERE connection_id=$1', [f.b.connectionId])).rows).toEqual([]);
            await client.query('ROLLBACK');
        }
        finally {
            client.release();
        }
    });
    it('deferred precommit expiry rolls back an already staged retirement and cursor invalidation', async () => {
        const f = await fixture(), scope = { binding: f.b, key: f.key }, encrypted = codec.encode(scope, 'record', f.record);
        const originalCursor=(await local.pool.query('SELECT invalidated,complete,initial_sync_complete,encrypted_cursor,cursor_key_version,lease_token,lease_until FROM communications.event_cursors WHERE account_id=$1',[f.b.accountId])).rows[0];
        expect(originalCursor).toMatchObject({invalidated:false,complete:false,initial_sync_complete:false,encrypted_cursor:null,cursor_key_version:null,lease_token:'synthetic-cursor-lease'});
        await expect(tx(async (c) => {
            await c.query('SELECT communications.lock_reply_barrier($1,$2)', [f.b.applicationId, f.b.tenantId]);
            await c.query("UPDATE communications.access_grants SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE application_id=$1", [f.b.applicationId]);
            await c.query('INSERT INTO communications.connection_retirements(id,application_id,tenant_id,owner_id,connection_id,generation,account_id,channel,platform,backend,operation_key,record_fingerprint,fingerprint_key_version,encrypted_record,record_key_version,token_hash) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [
                createHash('sha256').update(JSON.stringify(['communications.retirement.operation.v1', f.b.applicationId, f.b.tenantId, f.b.ownerId, f.key])).digest('hex'), f.b.applicationId, f.b.tenantId, f.b.ownerId, f.b.connectionId, f.b.accountId, f.b.channel, f.b.platform, f.b.backend, f.key, codec.digest(scope, f.record), codec.keyVersion, JSON.stringify(encrypted), codec.keyVersion, 'b'.repeat(64)
            ]);
            await c.query('SELECT pg_sleep(0.7)');
        })).rejects.toThrow(/grant expired before commit/);
        expect((await local.pool.query('SELECT active FROM communications.connections WHERE id=$1', [f.b.connectionId])).rows[0].active).toBe(true);
        expect((await local.pool.query('SELECT count(*)::integer AS count FROM communications.connection_retirements WHERE connection_id=$1', [f.b.connectionId])).rows[0].count).toBe(0);
        expect((await local.pool.query('SELECT invalidated,complete,initial_sync_complete,encrypted_cursor,cursor_key_version,lease_token,lease_until FROM communications.event_cursors WHERE account_id=$1', [f.b.accountId])).rows[0]).toEqual(originalCursor);
    });
});
