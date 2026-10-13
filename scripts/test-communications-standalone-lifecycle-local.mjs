// Synthetic DML proof only against already specifically approved/applied schemas.
// No initialization, migration, provider action or container startup occurs here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disabledCommunicationsEnvironment } from './communications-fixture-env.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(root, '.local-data/communications/verification');
assert.equal(process.env.COMMUNICATIONS_STANDALONE_LIFECYCLE_AUDIT, '1', 'Requires explicit existing standalone fixture opt-in; schema approval is separate');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const tests = ['src/db/communications-connection-retirement-local.integration.test.ts', 'src/db/communications-email-tracking-local.integration.test.ts'];
const env = {
  ...Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'CI'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])),
  ...disabledCommunicationsEnvironment([process.env], join(root, '.env.local')),
  COMMUNICATIONS_STANDALONE_AUDIT: '1', COMMUNICATIONS_RETIREMENT_AUDIT: '1', COMMUNICATIONS_EMAIL_TRACKING_AUDIT: '1', NODE_ENV: 'test',
};
const hashes = {};
function inventory(relative) {
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    if (['dist', 'node_modules'].includes(entry.name)) continue;
    const path = join(relative, entry.name);
    if (entry.isDirectory()) inventory(path);
    else if (entry.isFile() && entry.name.endsWith('.ts')) hashes[path] = createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
  }
}
inventory('communications');
for (const path of [...tests, 'src/db/communications-standalone-test-support.ts', 'scripts/communications-standalone-fixture-guards.mjs', 'scripts/test-communications-standalone-lifecycle-local.mjs']) hashes[path] = createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
const json = join(directory, 'standalone-lifecycle-vitest.json'), log = join(directory, 'standalone-lifecycle-postgres.log');
rmSync(json, { force: true });
const result = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--no-file-parallelism', '--reporter=default', '--reporter=json', `--outputFile.json=${json}`, ...tests],
  { cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
writeFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}`, { mode: 0o600 }); chmodSync(log, 0o600);
const report = JSON.parse(readFileSync(json, 'utf8'));
const sourceStable = Object.entries(hashes).every(([path, hash]) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex') === hash);
const allExecuted = report.numPendingTests === 0 && report.numTodoTests === 0 && report.numTotalTests === 30 && report.numPassedTests === 30;
const evidence = { checkedAt: new Date().toISOString(), sourceRevision: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
  target: '127.0.0.1:5446/communications_fixture', systemIdentifier: '7696118996713136162', sourceHashes: hashes, sourceStable,
  testsPassed: report.numPassedTests, testsSkipped: report.numPendingTests, allTestsExecuted: allExecuted, exitCode: result.status, signal: result.signal,
  migrationsPerformed: false, providerWrites: 0, productionActivated: false, syntheticAuthorityPorts: true, retainedSyntheticHistory: true, log };
const path = join(directory, 'standalone-lifecycle-postgres.json'); writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 }); chmodSync(path, 0o600);
assert.equal(result.status, 0, 'Standalone lifecycle prerequisite or verification failed; inspect private log. No schema operation occurred');
assert.ok(sourceStable && allExecuted, 'Requires all thirty actual cases executed with unchanged sources; skips are not passes');
console.log('Thirty existing-schema standalone PostgreSQL cases passed. Synthetic authority only; no migration or provider operation.');
