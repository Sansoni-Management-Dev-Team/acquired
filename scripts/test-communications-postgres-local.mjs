// Synthetic DML only. This runner never creates a schema or applies a migration.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';
import { disabledCommunicationsEnvironment } from './communications-fixture-env.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(root, '.local-data/communications/verification');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const env = {
  ...Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM', 'CI', 'NO_COLOR', 'FORCE_COLOR']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])),
  ...disabledCommunicationsEnvironment([process.env], join(root, '.env.local')),
  COMMUNICATIONS_AUDIT_LOCAL_DB: '1',
  COMMUNICATIONS_REPLY_BARRIER_LOCAL_DB: '1',
  CAMPAIGN_AUDIT_LOCAL_DB: '1',
  CAMPAIGN_ISOLATED_CHANNEL_STACK: '1',
  NODE_ENV: 'test',
};
// Keep any env-file loader from reviving credentials. Discover names only, not values.
for (const file of ['.env', '.env.local', '.env.test', '.env.test.local']) {
  if (!existsSync(join(root, file))) continue;
  for (const line of readFileSync(join(root, file), 'utf8').split(/\r?\n/)) {
    const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (key && !Object.hasOwn(env, key)) env[key] = '';
  }
}
const tests = [
  'communications-auth-state', 'communications-connection-setup',
  'communications-webhook', 'communications-events', 'communications-finish-review',
  'communications-outbox', 'communications-reply-identity',
  'communications-reply-barrier', 'communications-reply-consumer',
  'communications-reply-pipeline', 'campaign-replies',
  'communications-dispatch-barrier',
].map(name => `src/db/${name}-local.integration.test.ts`);

// Import only after selecting the explicit isolated fixture configuration.
process.env.CAMPAIGN_ISOLATED_CHANNEL_STACK = '1';
const { localCampaignDatabase } = await import('./campaign-integration-support.mjs');
const url = new URL(localCampaignDatabase);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.port, '5445');
assert.equal(url.pathname, '/acquire_channels');
env.DATABASE_URL = localCampaignDatabase;
env.DATABASE_SSL_CA = '';
const client = new pg.Client({ connectionString: localCampaignDatabase, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  const { rows: [database] } = await client.query(`SELECT current_database() AS name,
    system_identifier::text AS identity,
    to_regprocedure('communications.lock_reply_barrier(text,text)') AS fence,
    to_regprocedure('public.communications_lock_reply_member(text,text)') AS member_lock
    FROM pg_control_system()`);
  assert.equal(database.name, 'acquire_channels');
  assert.equal(database.identity, '7694812678792806433');
  assert.ok(database.fence && database.member_lock, 'Requires specifically approved and applied 001/002/003; no migration is performed');
} finally {
  await client.end();
}

const log = join(directory, 'communications-postgres-local.log');
const sourceHashes = {};
function inventory(relative) {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    if (['dist', 'node_modules'].includes(entry.name)) continue;
    const path = join(relative, entry.name);
    if (entry.isDirectory()) inventory(path);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      sourceHashes[path] = createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
    }
  }
}
inventory('communications');
for (const name of readdirSync(join(root, 'src/lib'))) {
  if (/^communications-reply.*\.ts$/.test(name) && !name.endsWith('.test.ts')) {
    const path = `src/lib/${name}`;
    sourceHashes[path] = createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
  }
}
for (const path of [
  'src/db/communications-local-test-support.ts', 'src/lib/campaign-reply-store.ts',
  'src/domain/campaign-replies.ts', 'scripts/test-communications-postgres-local.mjs',
]) sourceHashes[path] = createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
const testHashes = Object.fromEntries(tests.map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));
const testResultsPath = join(directory, 'communications-postgres-local-vitest.json');
rmSync(testResultsPath, { force: true });
const result = spawnSync(process.execPath, [
  // Suites share one fixture DB. Each concurrency scenario uses explicit competing clients;
  // unrelated fixture setup must not introduce SERIALIZABLE predicate conflicts across files.
  join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--no-file-parallelism',
  '--reporter=default', '--reporter=json', `--outputFile.json=${testResultsPath}`, ...tests,
], { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
writeFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}`, { mode: 0o600 });
chmodSync(log, 0o600);
const sourceStable = Object.entries({ ...sourceHashes, ...testHashes }).every(([path, hash]) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex') === hash);
let vitestResults;
if (existsSync(testResultsPath)) {
  chmodSync(testResultsPath, 0o600);
  try { vitestResults = JSON.parse(readFileSync(testResultsPath, 'utf8')); } catch { /* Missing valid evidence fails below. */ }
}
const allTestsExecuted = vitestResults?.success === true && vitestResults.numPendingTests === 0 &&
  vitestResults.numTodoTests === 0 && tests.every(path => vitestResults.testResults?.some(file =>
    file.name === join(root, path) && file.status === 'passed' && file.assertionResults?.length > 0 &&
    file.assertionResults.every(test => test.status === 'passed')));
const report = {
  checkedAt: new Date().toISOString(),
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceHashes,
  dirtyTree: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim(),
  target: 'OrbStack 127.0.0.1:5445/acquire_channels',
  systemIdentifier: '7694812678792806433',
  tests,
  testHashes,
  sourceStable,
  allTestsExecuted,
  testsPassed: vitestResults?.numPassedTests,
  exitCode: result.status,
  signal: result.signal,
  migrationsPerformed: false,
  providerWrites: false,
  syntheticFixtureHistoryRetained: true,
  log: 'communications-postgres-local.log',
};
writeFileSync(join(directory, 'communications-postgres-local.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
if (result.error || result.status !== 0 || !sourceStable || !allTestsExecuted) {
  console.error('Isolated PostgreSQL verification failed. Review the private communications-postgres-local.log.');
  process.exitCode = 1;
} else {
  console.log('Isolated PostgreSQL reply/setup verification passed. Synthetic DML only; no migration, live provider operation or coverage certification.');
}
