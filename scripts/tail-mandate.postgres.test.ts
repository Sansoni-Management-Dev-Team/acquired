import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { readCompactMandate, tailMandate } from './tail-mandate.mjs';
describe.skipIf(process.env.RUN_FIRMABLE_DB_INTEGRATION !== 'true')('RC-18 compact polling PostgreSQL', () => {
  let pool: Pool;
  const actor = `monitor-test-${crypto.randomUUID()}`, org = `monitor-test-${crypto.randomUUID()}`, mandate = crypto.randomUUID(), job = crypto.randomUUID();
  beforeAll(async () => {
    const url = process.env.FIRMABLE_INTEGRATION_DATABASE_URL;
    if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw Error('Explicit local database required');
    pool = new Pool({ connectionString: url, max: 2 });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)', [actor, 'Synthetic Monitor', `${actor}@example.test`]);
      await client.query('INSERT INTO organization(id,name,slug) VALUES($1,$2,$1)', [org, 'Synthetic Monitor']);
      await client.query('INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,$3,$4,$4,$5)', [mandate, org, 'Synthetic test', '{}', actor]);
      await client.query('INSERT INTO research_jobs(id,organization_id,mandate_id,created_by,status,config) VALUES($1,$2,$3,$4,$5,$6)', [job, org, mandate, actor, 'extracting', JSON.stringify({ sensitivePayload: 'must not appear in monitor response' })]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  });
  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM research_jobs WHERE id=$1 AND organization_id=$2', [job, org]);
      await client.query('DELETE FROM mandates WHERE id=$1 AND organization_id=$2', [mandate, org]);
      await client.query('DELETE FROM organization WHERE id=$1', [org]);
      await client.query('DELETE FROM "user" WHERE id=$1', [actor]);
      await client.query('COMMIT');
      expect((await client.query('SELECT count(*)::int AS n FROM organization WHERE id=$1', [org])).rows[0].n).toBe(0);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); await pool.end(); }
  });
  it('RC-18-integration: compact actual SQL survives failure and reconciles the terminal sample', async () => {
    const events: Array<Record<string, unknown>> = [];
    let calls = 0, clock = 0;
    const result = await tailMandate({ maxSamples: 3, emit: (e: Record<string, unknown>) => events.push(e), now: () => clock, sleep: async (ms: number) => { clock += ms; }, read: async () => {
      calls++;
      if (calls === 1) throw Object.assign(Error('Injected transport interruption'), { code: '57014' });
      const snapshot = await readCompactMandate(pool, mandate);
      if (calls === 2) await pool.query('UPDATE research_jobs SET status=$1 WHERE id=$2 AND organization_id=$3', ['complete', job, org]);
      return snapshot;
    } });
    expect(result.finished).toBe(true);
    expect(events.map(e => e.kind)).toEqual(['read_error', 'gap', 'sample', 'sample']);
    expect(events.at(-1)).toMatchObject({ jobs: { complete: 1 }, companies: 0, contacts: 0, finished: true });
    expect(JSON.stringify(events)).not.toContain('sensitivePayload');
  });
});
