import { randomUUID, createHash } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createCommunicationsStandaloneFixture } from './communications-standalone-test-support';
import { reserveDispatchQuotas } from '../../communications/packages/storage-postgres/src/send-admission';
// PREPARED / UNEXECUTED: proposed standalone005 requires specific approval/application.
// Actual production quota helper and restricted SQL role; synthetic DML only.
// This proves quota transaction/rollup behavior, not application admission/provider readiness.
const enabled = process.env.COMMUNICATIONS_STANDALONE_AUDIT === '1' && process.env.COMMUNICATIONS_SEND_ADMISSION_AUDIT === '1';
describe.skipIf(!enabled)('standalone private send quotas (prepared)', () => {
    const local = createCommunicationsStandaloneFixture(), application = `quota-${randomUUID()}`;
    beforeAll(() => local.preflight(['communications.application_quota_buckets', 'communications.dispatch_admissions']));
    afterAll(() => local.close());
    async function account() { const id = `quota-account-${randomUUID()}`; await local.pool.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,'whatsapp','synthetic-quota',$2,'fixture',clock_timestamp())", [id, createHash('sha256').update(id).digest('hex')]); return id; }
    async function charge(id: string, app = application, limit = 1) { const c = await local.driver.connect(); try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE communications_control');
        const role = await c.query('SELECT current_user AS role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
        expect(role.rows[0]).toEqual({ role: 'communications_control', rolsuper: false, rolbypassrls: false });
        const ok = await reserveDispatchQuotas(c, id, app, { account: { hour: 10, day: 20 }, application: { hour: limit, day: limit } });
        await c.query('COMMIT');
        return ok;
    }
    catch (e) {
        await c.query('ROLLBACK');
        throw e;
    }
    finally {
        c.release();
    } }
    it('two different account admissions serialize against one global application allowance', async () => { const a = await account(), b = await account(), app = `${application}-concurrent`; const results = await Promise.all([charge(a, app), charge(b, app)]); expect(results.sort()).toEqual([false, true]); const totals = await local.pool.query("SELECT window_kind,used::integer FROM communications.application_quota_buckets WHERE application_id=$1 ORDER BY window_kind", [app]); expect(totals.rows).toEqual([{ window_kind: 'day', used: 1 }, { window_kind: 'hour', used: 1 }]); const charges = await local.pool.query('SELECT account_id,count(*)::integer AS n FROM communications.quota_buckets WHERE account_id=ANY($1::text[]) GROUP BY account_id', [[a, b]]); expect(charges.rows).toHaveLength(1); expect(charges.rows[0].n).toBe(4); });
    it('a second same-account UPSERT charges the application rollup exactly once', async () => { const app = `${application}-upsert`, a = await account(); expect(await charge(a, app, 2)).toBe(true); expect(await charge(a, app, 2)).toBe(true); expect(await charge(a, app, 2)).toBe(false); expect((await local.pool.query('SELECT used::integer FROM communications.application_quota_buckets WHERE application_id=$1', [app])).rows).toEqual([{ used: 2 }, { used: 2 }]); });
    it('an exhausted later application limit rolls back every earlier account charge', async () => { const app = `${application}-rollback`, a = await account(), b = await account(); expect(await charge(a, app)).toBe(true); expect(await charge(b, app)).toBe(false); expect((await local.pool.query('SELECT count(*)::integer AS n FROM communications.quota_buckets WHERE account_id=$1', [b])).rows[0].n).toBe(0); });
    it('caller-supplied policy changes cannot increase an already recorded bucket limit', async () => { const app = `${application}-fixed`, a = await account(); expect(await charge(a, app)).toBe(true); expect(await charge(a, app, 100)).toBe(false); expect((await local.pool.query('SELECT used::integer,limit_value FROM communications.application_quota_buckets WHERE application_id=$1 ORDER BY window_kind', [app])).rows).toEqual([{ used: 1, limit_value: 1 }, { used: 1, limit_value: 1 }]); });
    it('restricted scoped readers cannot mutate or delete the private application quotas', async () => { const c = await local.pool.connect(); try {
        await c.query('BEGIN');
        await c.query('SET LOCAL ROLE communications_scoped');
        for (const sql of ['UPDATE communications.application_quota_buckets SET used=0', 'DELETE FROM communications.application_quota_buckets']) {
            await c.query('SAVEPOINT forbidden');
            await expect(c.query(sql)).rejects.toMatchObject({ code: '42501' });
            await c.query('ROLLBACK TO SAVEPOINT forbidden');
        }
        await c.query('ROLLBACK');
    }
    finally {
        c.release();
    } });
});
