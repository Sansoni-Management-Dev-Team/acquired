import { randomUUID, createHash } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { createCommunicationsStandaloneFixture } from './communications-standalone-test-support';
import { reserveDispatchQuotas } from '../../communications/packages/storage-postgres/src/send-admission';
import { JournalCodec } from '../../communications/packages/core/src/journal-codec';
import { checkRollingDispatchPolicy } from '../../communications/packages/storage-postgres/src/rolling-policy';
// PREPARED / UNEXECUTED. Requires specifically approved/applied standalone005.
// Real SQL empty/charged-terminal ledger and clock/role semantics; synthetic service
// admission receipts are fixtures, not proof of a real application commit/provider attempt.
const enabled = process.env.COMMUNICATIONS_STANDALONE_AUDIT === '1' && process.env.COMMUNICATIONS_SEND_ADMISSION_AUDIT === '1';
describe.skipIf(!enabled)('standalone rolling admission policy SQL (prepared)', () => {
    const local = createCommunicationsStandaloneFixture();
    beforeAll(() => local.preflight(['communications.dispatch_admissions', 'communications.application_quota_buckets']));
    const retired: string[] = [];
    afterAll(async () => { try {
        for (const app of retired)
            await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1', [app]);
    }
    finally {
        await local.close();
    } });
    it('restricted original-account transaction can read a genuinely empty ledger without charging it', async () => {
        const account = `rolling-${randomUUID()}`;
        const c = await local.driver.connect();
        try {
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE communications_control');
            const role = await c.query('SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
            expect(role.rows[0]).toEqual({ role: 'communications_control', rolsuper: false, rolbypassrls: false });
            await c.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,'email','synthetic-rolling',$2,'fixture',clock_timestamp())", [account, createHash('sha256').update(account).digest('hex')]);
            await c.query('SELECT id FROM communications.physical_accounts WHERE id=$1 FOR UPDATE', [account]);
            expect(await checkRollingDispatchPolicy(c, account, { rollingDay: 1, minimumSpacingSeconds: 60 })).toEqual({ allowed: true });
            expect((await c.query('SELECT count(*)::integer AS n FROM communications.dispatch_admissions WHERE account_id=$1', [account])).rows[0].n).toBe(0);
            expect((await c.query('SELECT count(*)::integer AS n FROM communications.quota_buckets WHERE account_id=$1', [account])).rows[0].n).toBe(0);
            await c.query('ROLLBACK');
        }
        catch (e) {
            await c.query('ROLLBACK');
            throw e;
        }
        finally {
            c.release();
        }
    });
    it.each(['blocked', 'rejected', 'skipped'] as const)('charged terminal %s preserves rolling usage without making the account permanently unavailable', async (state) => {
        const nonce = randomUUID(), app = `rolling-${nonce}`, tenant = 'rolling-tenant', owner = 'rolling-owner', account = `rolling-account-${nonce}`, connection = `rolling-connection-${nonce}`, journal = `rolling-journal-${nonce}`, token = 'rolling-claim', worker = 'rolling-worker';
        const binding = { applicationId: app, tenantId: tenant, ownerId: owner, connectionId: connection, accountId: account, generation: 1, channel: 'email' as const, platform: 'gmail' as const, backend: 'unipile' as const }, snapshot = { binding, key: journal, operation: 'message' as const, payloadDigest: 'a'.repeat(64) }, codec = new JournalCodec({ activeVersion: 'fixture-v1', keys: [{ version: 'fixture-v1', encryptionKey: Buffer.alloc(32, 131), digestKey: Buffer.alloc(32, 132) }] }), context = { recipient: { kind: 'email' as const, value: 'rolling-person@example.test' } }, sealed = codec.encode(snapshot, 'context', context);
        const c = await local.driver.connect();
        try {
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE communications_control');
            await c.query("INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [app, tenant, owner]);
            await c.query('SELECT communications.lock_reply_barrier($1,$2)', [app, tenant]);
            await c.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,'email','synthetic-rolling',$2,'fixture',clock_timestamp())", [account, createHash('sha256').update(nonce).digest('hex')]);
            await c.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,$2,$3,$4,$5,'email','gmail','unipile',1,'connected',true)", [connection, app, tenant, owner, account]);
            await c.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,1,$2,$3,$4,$5,'email','gmail','unipile',$6,'v1','rolling-fixture','service','{}')", [connection, app, tenant, owner, account, `rolling-integration-${nonce}`]);
            await c.query("INSERT INTO communications.account_leases(account_id,owner_token,fencing_token,expires_at) VALUES($1,$2,1,clock_timestamp()+interval '1 hour')", [account, worker]);
            await c.query("INSERT INTO communications.operation_journal(id,application_id,tenant_id,owner_id,operation_key,connection_id,generation,account_id,operation,payload_digest,recipient_digest,digest_version,recipient_key_version,encrypted_operation_context,operation_context_key_version,operation_context_digest,state,claim_token,claim_until,fencing_token,lease_owner_token) VALUES($1,$2,$3,$4,$1,$5,1,$6,'message',$7,$8,'message-v1','fixture-v1',$9,'fixture-v1',$10,'claimed',$11,clock_timestamp()+interval '1 hour',1,$12)", [journal, app, tenant, owner, connection, account, snapshot.payloadDigest, 'b'.repeat(64), JSON.stringify(sealed), codec.digest(snapshot, 'context', context), token, worker]);
            expect(await reserveDispatchQuotas(c, account, app, { account: { hour: 10, day: 10 }, application: { hour: 10, day: 10 } })).toBe(true);
            const revision = (await c.query('SELECT communications.assert_dispatch_reply_barrier($1,$2)::text AS revision', [app, tenant])).rows[0].revision;
            await c.query('INSERT INTO communications.dispatch_admissions(id,journal_id,application_id,tenant_id,owner_id,connection_id,generation,account_id,operation_key,payload_digest,permit_id,intent_digest,claim_token,fencing_token,lease_owner_token,service_revision) VALUES($1,$2,$3,$4,$5,$6,1,$7,$2,$8,$9,$10,$11,1,$12,$13::bigint)', [`admission-${nonce}`, journal, app, tenant, owner, connection, account, snapshot.payloadDigest, `synthetic-permit-${nonce}`, 'c'.repeat(64), token, worker, revision]);
            await c.query("UPDATE communications.operation_journal SET state='dispatching',quota_reserved=true,updated_at=clock_timestamp() WHERE id=$1", [journal]);
            await c.query('COMMIT');
            retired.push(app);
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE communications_control');
            await c.query('SELECT communications.lock_reply_barrier($1,$2)', [app, tenant]);
            await c.query('SELECT id FROM communications.physical_accounts WHERE id=$1 FOR UPDATE', [account]);
            const outcome = state === 'blocked' ? { status: 'review' as const, code: 'delivery_disabled' as const } : state === 'rejected' ? { status: 'rejected' as const, code: 'synthetic_rejected' } : { status: 'skipped' as const, code: 'synthetic_skipped' }, encrypted = codec.encode(snapshot, 'outcome', outcome);
            await c.query('UPDATE communications.operation_journal SET state=$2,outcome_status=$3,encrypted_outcome=$4,outcome_key_version=$5,updated_at=clock_timestamp() WHERE id=$1', [journal, state, outcome.status, JSON.stringify(encrypted), codec.keyVersion]);
            expect(await checkRollingDispatchPolicy(c, account, { rollingDay: 10, minimumSpacingSeconds: 0 })).toEqual({ allowed: true });
            const capped = await checkRollingDispatchPolicy(c, account, { rollingDay: 1, minimumSpacingSeconds: 0 });
            expect(capped).toMatchObject({ allowed: false, outcome: { status: 'waiting', code: 'rate_limited' } });
            const spaced = await checkRollingDispatchPolicy(c, account, { rollingDay: 10, minimumSpacingSeconds: 60 });
            expect(spaced).toMatchObject({ allowed: false, outcome: { status: 'waiting', code: 'rate_limited' } });
            expect((await c.query('SELECT count(*)::integer AS n FROM communications.dispatch_admissions WHERE account_id=$1', [account])).rows[0].n).toBe(1);
            await c.query('COMMIT');
        }
        catch (e) {
            await c.query('ROLLBACK');
            throw e;
        }
        finally {
            c.release();
        }
    });
});
