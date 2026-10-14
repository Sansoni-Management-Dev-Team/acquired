import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('prepared runner enables both actual suites and rejects skipped evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'communications-lifecycle-runner-'));
  try {
    for (const path of ['scripts', 'communications', 'src/db', 'node_modules/vitest']) mkdirSync(join(root, path), { recursive: true });
    for (const path of ['scripts/test-communications-standalone-lifecycle-local.mjs', 'scripts/communications-fixture-env.mjs', 'scripts/communications-standalone-fixture-guards.mjs', 'src/db/communications-standalone-test-support.ts', 'src/db/communications-connection-retirement-local.integration.test.ts', 'src/db/communications-email-tracking-local.integration.test.ts']) copyFileSync(new URL(`../${path}`, import.meta.url), join(root, path));
    // Child stands in for Vitest only; it evaluates the real suites' opt-in expressions.
    // No private credentials, database driver or provider transport enters this fixture.
    writeFileSync(join(root, 'node_modules/vitest/vitest.mjs'), `
      import { readFileSync, writeFileSync } from 'node:fs';
      import assert from 'node:assert/strict';
      assert.equal(process.env.UNIPILE_API_KEY, '');
      const suites = process.argv.filter(p => p.endsWith('.integration.test.ts'));
      const enabled = suites.map(p => {
        const expression = readFileSync(p, 'utf8').match(/const enabled = (.*);/)[1];
        return Function('process', 'return (' + expression + ')')(process);
      });
      const passed = enabled.filter(Boolean).length * 15;
      const output = process.argv.find(p => p.startsWith('--outputFile.json=')).split('=')[1];
      writeFileSync(output, JSON.stringify({ numPendingTests: 30-passed, numTodoTests: 0, numTotalTests: 30, numPassedTests: passed }));
    `);
    const result = spawnSync(process.execPath, ['scripts/test-communications-standalone-lifecycle-local.mjs'], {
      cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, COMMUNICATIONS_STANDALONE_LIFECYCLE_AUDIT: '1', UNIPILE_API_KEY: 'synthetic-must-be-blanked' }, timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(join(root, '.local-data/communications/verification/standalone-lifecycle-postgres.json'), 'utf8'));
    assert.equal(report.testsPassed, 30);
    assert.equal(report.testsSkipped, 0);
    assert.equal(report.allTestsExecuted, true);
    // Deliberately disable both suites while retaining a successful test-process exit.
    for (const path of ['communications-connection-retirement-local.integration.test.ts', 'communications-email-tracking-local.integration.test.ts']) writeFileSync(join(root, 'src/db', path), 'const enabled = false;');
    const skipped = spawnSync(process.execPath, ['scripts/test-communications-standalone-lifecycle-local.mjs'], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, COMMUNICATIONS_STANDALONE_LIFECYCLE_AUDIT: '1' }, timeout: 10000 });
    assert.notEqual(skipped.status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
