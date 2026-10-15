import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export function classifySearchProbe(status, body) {
  const categories = ['browser_admission', 'provider_error', 'timeout', 'transport', 'daily_quota', 'request_rate', 'authentication_or_policy'];
  const category = categories.includes(body?.category) ? body.category : 'unknown';
  return { status, category, admissionRejected: status === 503 && category === 'browser_admission' };
}
export function summarizeBackgroundJobs(rows) {
  const result = { companies: rows.length, statuses: {}, searched: 0, allSearchesFailed: 0, someSearchSucceeded: 0, noSearch: 0, failedSearchAttempts: 0, successfulSearchAttempts: 0, withEvidence: 0 };
  for (const row of rows) {
    result.statuses[row.status] = (result.statuses[row.status] || 0) + 1;
    const searches = (row.result?.attempts || []).filter(a => a.kind === 'search');
    if (!searches.length) result.noSearch++;
    else {
      result.searched++;
      if (searches.every(a => a.status === 'failed')) result.allSearchesFailed++;
      if (searches.some(a => a.status === 'succeeded')) result.someSearchSucceeded++;
    }
    result.failedSearchAttempts += searches.filter(a => a.status === 'failed').length;
    result.successfulSearchAttempts += searches.filter(a => a.status === 'succeeded').length;
    if ((row.result?.written || 0) > 0) result.withEvidence++;
  }
  return result;
}
export async function probeLiveSearch(environment, mandateId) {
  if (!environment.RESEARCH_WORKER_URL || !environment.RESEARCH_SERVICE_SECRET) throw new Error('Research Worker environment is required');
  if (mandateId && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(mandateId)) throw new Error('Valid mandate UUID required');
  if (mandateId && !environment.DATABASE_URL) throw new Error('Database environment is required for mandate evidence');
  const url = new URL('/search', environment.RESEARCH_WORKER_URL);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Authenticated HTTPS Worker endpoint required');
  // Synthetic job: exactly one request with no client reservation or retries.
  // A repaired Worker can reserve capacity and issue one public search. No real
  // job is modified; this is not an eligibility or recovery test.
  const started = Date.now();
  const response = await fetch(url, {
    method: 'POST', headers: { authorization: `Bearer ${environment.RESEARCH_SERVICE_SECRET}`, 'content-type': 'application/json', 'x-research-job-id': randomUUID() },
    body: JSON.stringify({ query: 'site:example.com company contact' }), signal: AbortSignal.timeout(10000), redirect: 'error',
  });
  const body = await response.json().catch(() => null);
  const report = { observed: new Date().toISOString(), probe: { ...classifySearchProbe(response.status, body), elapsedMs: Date.now() - started }, databaseReadOnly: true };
  if (mandateId) {
    const { default: pg } = await import('pg');
    const ca = environment.DATABASE_SSL_CA || (environment.DATABASE_SSL_CA_BASE64 && Buffer.from(environment.DATABASE_SSL_CA_BASE64, 'base64').toString());
    const db = new pg.Client({ connectionString: environment.DATABASE_URL, ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}), connectionTimeoutMillis: 10000, query_timeout: 15000 });
    try {
      await db.connect(); await db.query('BEGIN READ ONLY'); await db.query("SET LOCAL statement_timeout='10s'");
      const rows = await db.query(`SELECT status,config->'companyBackgroundResult' result FROM research_jobs WHERE mandate_id=$1 AND config ? 'companyBackgroundResearch'`, [mandateId]);
      report.mandateId = mandateId; report.background = summarizeBackgroundJobs(rows.rows);
    } finally { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
  }
  return report;
}
async function main() {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1];
  if (args.includes('--help')) {
    console.log('node scripts/diagnose-field-search.mjs [--live] [--mandate UUID] [--output report.json]\nDefault: offline admission regressions and reserved control, external network blocked.\n--live: one unreserved Worker request; optional read-only mandate evidence. Supply runtime environment externally. Exit 2 confirms admission rejection. A repaired Worker may reserve capacity and perform one public search. No migration, workflow creation, recovery or resend.');
    return;
  }
  if (!args.includes('--live')) {
    const directory = fileURLToPath(new URL('../', import.meta.url));
    const run = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', 'cloudflare/research/field-search-rca.config.mts'], { cwd: directory, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    process.exitCode = run.status ?? 1; return;
  }
  const report = await probeLiveSearch(process.env, args.includes('--mandate') ? value('--mandate') : undefined);
  if (args.includes('--output')) await writeFile(resolve(value('--output')), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (report.probe.admissionRejected) process.exitCode = 2;
}
if (process.argv[1] === '-' || (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)) {
  main().catch(() => { console.error('Field-search diagnostic failed; raw errors suppressed to protect runtime credentials.'); process.exitCode = 1; });
}
