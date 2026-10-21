import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { auditUnusedSource } from './audit-unused-source.mjs';

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'acquire-unused-audit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  return root;
}

const config = { roots: ['src', 'cloudflare', 'scripts', 'testing'], entries: [] };

test('follows framework entry imports and re-exports, while reporting unreachable cycles', t => {
  const root = fixture(t, {
    'src/app/(main)/page.tsx': "export { view as default } from '@/lib/barrel';",
    'src/lib/barrel.ts': "export { view } from './view';",
    'src/lib/view.ts': 'export const view = () => null;',
    'src/lib/unused-a.ts': "import './unused-b';",
    'src/lib/unused-b.ts': "import './unused-a';",
  });
  const result = auditUnusedSource({ root, config });
  assert.deepEqual(result.candidates, ['src/lib/unused-a.ts', 'src/lib/unused-b.ts']);
  assert.deepEqual(result.testOnly, []);
});

test('distinguishes test-only implementations from active worker, script and harness consumers', t => {
  const root = fixture(t, {
    'cloudflare/worker.ts': "import '../src/lib/worker-helper';",
    'scripts/operator.mjs': "import '../src/lib/operator-helper.js';",
    'testing/scenario.ts': "import '../src/lib/harness-helper';",
    'src/lib/worker-helper.ts': 'export const worker = 1;',
    'src/lib/operator-helper.js': 'export const operator = 1;',
    'src/lib/harness-helper.ts': 'export const harness = 1;',
    'src/lib/obsolete.ts': 'export const old = 1;',
    'src/lib/obsolete.test.ts': "import './obsolete';",
  });
  const result = auditUnusedSource({ root, config: { ...config, entries: [{ path: 'cloudflare/worker.ts', reason: 'Worker main' }] } });
  assert.deepEqual(result.testOnly, ['src/lib/obsolete.ts']);
  assert.deepEqual(result.candidates, []);
});

test('honours documented private operator entries and reports stale retained exceptions', t => {
  const root = fixture(t, { 'src/lib/support.ts': 'export const support = 1;' });
  const entries = [
    { path: 'src/lib/support.ts', reason: 'Imported by private operator harness' },
    { path: 'src/lib/deleted.ts', reason: 'Stale exception' },
  ];
  const result = auditUnusedSource({ root, config: { ...config, entries } });
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.missingEntries, ['src/lib/deleted.ts']);
});

test('follows literal dynamic imports, require and file URLs without executing source', t => {
  const root = fixture(t, {
    'scripts/run.mjs': "throw Error('must not run'); import('../src/lazy.ts'); require('../src/required.cjs'); new URL('../src/worker.ts', import.meta.url);",
    'src/lazy.ts': 'export const lazy = 1;',
    'src/required.cjs': 'module.exports = 1;',
    'src/worker.ts': 'export const worker = 1;',
  });
  assert.deepEqual(auditUnusedSource({ root, config }).candidates, []);
});

test('flags computed module paths for manual review without printing source values', t => {
  const root = fixture(t, {
    'scripts/run.mjs': 'const secretPath = process.env.PRIVATE_FILE;\nimport(secretPath);\nrequire(secretPath);',
  });
  assert.deepEqual(auditUnusedSource({ root, config }).dynamicReferences, [
    { path: 'scripts/run.mjs', line: 2 },
    { path: 'scripts/run.mjs', line: 3 },
  ]);
});

test('does not treat comments, test names or non-framework app helpers as runtime entry points', t => {
  const root = fixture(t, {
    'src/app/helper.ts': '// import("./unused");',
    'src/app/unused.ts': 'export const unused = 1;',
    'src/app/page.test.tsx': 'export const testOnly = 1;',
  });
  assert.deepEqual(auditUnusedSource({ root, config }).candidates, ['src/app/helper.ts', 'src/app/unused.ts']);
});

test('retains JS runtime implementations when a sibling declaration supplies their types', t => {
  const root = fixture(t, {
    'scripts/operator.mjs': "import '../src/resolver.mjs';",
    'src/resolver.mjs': 'export const resolve = () => null;',
    'src/resolver.d.mts': 'export declare const resolve: () => null;',
  });
  assert.deepEqual(auditUnusedSource({ root, config }).candidates, []);
});

test('recognises Next authorization fallback entry points', t => {
  const root = fixture(t, {
    'src/app/forbidden.tsx': 'export default () => null;',
    'src/app/unauthorized.tsx': 'export default () => null;',
  });
  assert.deepEqual(auditUnusedSource({ root, config }).candidates, []);
});
