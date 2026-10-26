import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverRoutes, validateCoverage } from './route-inventory';

describe('route inventory', () => {
  it('discovers groups and dynamic routes, ignores private folders, and records API methods', () => {
    const root = mkdtempSync(join(tmpdir(), 'route-inventory-'));
    try {
      for (const [file, text] of Object.entries({
        '(workspace)/companies/[id]/page.tsx': '',
        'docs/[[...slug]]/page.tsx': '',
        '_private/page.tsx': '',
        'api/items/route.ts': 'export const { GET, POST } = handlers();\nexport { handleDelete as DELETE } from \"./handler\";',
      })) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), text); }
      expect(discoverRoutes(root)).toEqual([
        { kind: 'api', path: '/api/items', file: 'api/items/route.ts', methods: ['DELETE', 'GET', 'POST'] },
        { kind: 'page', path: '/companies/[id]', file: '(workspace)/companies/[id]/page.tsx', methods: [] },
        { kind: 'page', path: '/docs/[[...slug]]', file: 'docs/[[...slug]]/page.tsx', methods: [] },
      ]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('fails closed on parallel or intercepted routes requiring deliberate handling', () => {
    const root = mkdtempSync(join(tmpdir(), 'route-inventory-'));
    try {
      mkdirSync(join(root, '@modal'), { recursive: true });
      writeFileSync(join(root, '@modal/page.tsx'), '');
      expect(() => discoverRoutes(root)).toThrow(/explicit inventory support/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects missing routes, stale entries, duplicate entries, and placeholder browser URLs', () => {
    const routes = [{ kind: 'page' as const, path: '/a', file: 'a/page.tsx', methods: [] }];
    expect(() => validateCoverage(routes, [])).toThrow(/Missing/);
    const entry = { kind: 'page' as const, path: '/a', url: '/a', expectation: 'redirect' as const, heading: 'Sign in', gap: 'Authenticated fixture required' };
    expect(() => validateCoverage(routes, [entry])).not.toThrow();
    expect(() => validateCoverage(routes, [entry, entry])).toThrow(/Duplicate/);
    expect(() => validateCoverage(routes, [{ ...entry, path: '/b' }])).toThrow();
    expect(() => validateCoverage(routes, [{ ...entry, url: '/[id]' }])).toThrow(/concrete/);
    expect(() => validateCoverage(routes, [{ ...entry, url: '/sign-in' }])).toThrow(/does not match/);
  });
});
