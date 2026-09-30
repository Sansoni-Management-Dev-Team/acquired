import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

/** Read existing diagnostics only. Never install extensions/reset counters/run migrations. */
export async function captureResearchDatabaseDiagnostics(client) {
 const report = { capturedAt: new Date().toISOString(), timingBasis: 'database_server_statement_execution', scope: 'database_wide_research_statements', statements: [], note: 'Cumulative shared statement counters include other runs and users. Differences are comparable only with controlled concurrent traffic; these are not application round-trip durations.' };
 try {
  const found = await client.query("SELECT n.nspname AS schema FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relname='pg_stat_statements' AND n.nspname IN ('public','extensions') ORDER BY n.nspname LIMIT 1");
  const schema = found.rows[0]?.schema;
  if (!['public', 'extensions'].includes(schema)) return { ...report, availability: 'unavailable', reason: 'existing_statement_statistics_not_found' };
  const result = await client.query(`SELECT queryid::text AS "queryId", calls::float8 AS calls, total_exec_time AS "executionMs", mean_exec_time AS "meanExecutionMs", rows::float8 AS "rowsReturned", shared_blks_hit::float8 AS "sharedBlocksHit", shared_blks_read::float8 AS "sharedBlocksRead" FROM "${schema}".pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND query ~* '(research_jobs|research_findings)' AND query !~* 'pg_stat_statements' ORDER BY total_exec_time DESC LIMIT 100`);
  return { ...report, availability: 'available', statements: result.rows };
 } catch (error) {
  return { ...report, availability: 'unavailable', reason: 'diagnostics_query_failed', ...(typeof error.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? { databaseErrorCode: error.code } : {}) };
 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 const args = process.argv.slice(2);
 if (args.length !== 1 || !process.env.DATABASE_URL) {
  console.error('Usage: node --env-file=<environment-file> scripts/capture-research-db-diagnostics.mjs <output.json>');
  process.exitCode = 1;
 } else {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ...(process.env.DATABASE_SSL_CA ? { ssl: { ca: process.env.DATABASE_SSL_CA, rejectUnauthorized: true } } : {}), connectionTimeoutMillis: 10000, query_timeout: 15000 });
  try {
   await client.connect();
   const report = await captureResearchDatabaseDiagnostics(client);
   const output = resolve(args[0]); await mkdir(dirname(output), { recursive: true, mode: 0o700 });
   await writeFile(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
   console.log(JSON.stringify({ output, availability: report.availability, reason: report.reason, statements: report.statements.length }));
  } catch { console.error('Database diagnostics connection failed; no schema or counter changes were attempted.'); process.exitCode = 1; }
  finally { await client.end(); }
 }
}
