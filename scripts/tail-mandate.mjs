import { readFileSync, appendFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// No raw config, provider payloads, company/contact identities or credentials.
export const compactMandateQuery = `
WITH selected AS (SELECT id, organization_id FROM mandates WHERE id=$1),
job_status AS (SELECT status,count(*)::int AS count FROM research_jobs
 WHERE mandate_id=$1 AND organization_id=(SELECT organization_id FROM selected) GROUP BY status),
sync_status AS (SELECT r.status,count(*)::int AS count FROM firmable_sync_runs r
 JOIN mandate_targets mt ON mt.target_id=r.target_id AND mt.organization_id=r.organization_id
 WHERE mt.mandate_id=$1 AND mt.organization_id=(SELECT organization_id FROM selected) GROUP BY r.status)
SELECT id,
 (SELECT coalesce(jsonb_object_agg(status,count),'{}'::jsonb) FROM job_status) AS jobs,
 (SELECT coalesce(jsonb_object_agg(status,count),'{}'::jsonb) FROM sync_status) AS sync,
 (SELECT count(*)::int FROM mandate_targets WHERE mandate_id=$1 AND organization_id=selected.organization_id) AS companies,
 (SELECT count(*)::int FROM contacts c WHERE c.organization_id=selected.organization_id AND EXISTS
   (SELECT 1 FROM mandate_targets mt WHERE mt.mandate_id=$1 AND mt.organization_id=c.organization_id AND mt.target_id=c.target_id)) AS contacts
FROM selected`;

export async function readCompactMandate(pool, mandateId) {
  const client = await pool.connect();
  let failed = false;
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '10s'");
    const result = await client.query(compactMandateQuery, [mandateId]);
    if (!result.rows.length) throw new Error('Mandate not found');
    return result.rows[0];
  } catch (error) { failed = true; throw error; }
  finally {
    try { await client.query('ROLLBACK'); } catch { failed = true; }
    client.release(failed); // Destroy unhealthy connections; the next sample reconnects.
  }
}

export async function tailMandate({ read, emit, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), intervalMs = 30_000, maxSamples = 120, maxBackoffMs = 60_000 }) {
  if (!(Number.isInteger(maxSamples) && maxSamples > 0 && intervalMs > 0 && maxBackoffMs > 0)) throw new Error('Invalid polling limits');
  let failures = 0, gapStart, lastSample;
  for (let attempt = 0; attempt < maxSamples; attempt++) {
    const started = now();
    try {
      lastSample = await read();
      if (gapStart !== undefined) emit({ kind: 'gap', from: new Date(gapStart).toISOString(), to: new Date(now()).toISOString(), failedSamples: failures, reason: 'monitor_read_failure', backendOutageConfirmed: false });
      failures = 0; gapStart = undefined;
      const active = statuses => Object.entries(statuses || {}).some(([status, count]) => !['complete', 'partial', 'failed', 'cancelled'].includes(status) && count > 0);
      const finished = Object.keys(lastSample.jobs || {}).length > 0 && !active(lastSample.jobs) && !active(lastSample.sync);
      emit({ kind: 'sample', observed: new Date(now()).toISOString(), ...lastSample, finished });
      if (finished) return { finished, samples: attempt + 1 };
    } catch (error) {
      gapStart ??= started; failures++;
      // Error messages can contain server details/connection strings. Emit only safe classification.
      emit({ kind: 'read_error', observed: new Date(now()).toISOString(), attempt: attempt + 1, code: error?.code === '57014' ? 'query_timeout' : 'read_failed', backendOutageConfirmed: false });
    }
    if (attempt + 1 < maxSamples) await sleep(Math.max(0, Math.min(maxBackoffMs, intervalMs * 2 ** Math.min(failures, 3)) - (now() - started)));
  }
  if (gapStart !== undefined) emit({ kind: 'gap', from: new Date(gapStart).toISOString(), to: new Date(now()).toISOString(), failedSamples: failures, reason: 'monitor_read_failure', backendOutageConfirmed: false, unresolved: true });
  return { finished: false, samples: maxSamples, lastSample };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mandateId, output] = process.argv.slice(2);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mandateId || '')) throw new Error('Supply a mandate UUID and optional JSONL output path');
  let environment = {};
  for (const path of ['.env', '.env.local']) {
    try { environment = { ...environment, ...parseEnv(readFileSync(path, 'utf8')) }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  environment = { ...environment, ...process.env };
  const pool = new pg.Pool({ connectionString: environment.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000, query_timeout: 12_000 });
  try {
    const result = await tailMandate({ read: () => readCompactMandate(pool, mandateId), emit: event => { const line = JSON.stringify(event) + '\n'; process.stdout.write(line); if (output) appendFileSync(output, line, { mode: 0o600 }); } });
    if (!result.finished) process.exitCode = 2;
  } finally { await pool.end(); }
}
