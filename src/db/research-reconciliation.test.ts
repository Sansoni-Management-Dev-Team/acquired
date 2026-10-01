import { expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { targets } from './schema';
import { reconcileResearchTarget } from './research-reconciliation';

it('retries a stale sibling snapshot without overwriting a concurrent provider value', async () => {
 let current: Record<string, unknown> = { headcount: { value: null }, state: 'VIC' };
 const metadata = { basis: 'reported', sourceKind: 'company_website', currency: 'AUD', scope: 'unspecified' };
 const observations = [{ evidence: { kind: 'headcount', value: '51-200 employees', factMetadata: metadata }, sourceUrl: 'https://headland.au/company/', observedAt: new Date('2026-09-30') }, { evidence: { kind: 'revenue', value: 'AUD 12 million', factMetadata: metadata }, sourceUrl: 'https://headland.au/company/', observedAt: new Date('2026-09-30') }];
 let attempts = 0;
 const guards: { sql: string; params: unknown[] }[] = [];
 const database = {
  select: () => { let table: unknown; const q = { from: (t: unknown) => { table = t; return q; }, where: () => q, limit: async () => [{ firmographics: structuredClone(current) }], then: (resolve: (value: unknown) => unknown) => Promise.resolve(table === targets ? [{ firmographics: structuredClone(current) }] : observations).then(resolve) }; return q; },
  update: () => ({ set: (fields: { firmographics: Record<string, unknown> }) => ({ where: (guard: unknown) => ({ returning: async () => {
   guards.push(new PgDialect().sqlToQuery(guard as never));
   if (++attempts === 1) { current = { ...current, headcount: { value: 71, provenance: { source: 'Firmable', confidence: 90 } } }; return []; }
   current = fields.firmographics; return [{ id: 'headland' }];
  } }) }) }),
 };
 await reconcileResearchTarget(database as never, 'org', 'headland');
 expect(attempts).toBe(2);
 expect(current.headcount).toMatchObject({ value: 71, provenance: { source: 'Firmable' } });
 expect(current.revenue).toMatchObject({ value: 12000000 });
 expect(current.state).toBe('VIC');
 expect(guards.every(guard => guard.sql.includes('"firmographics" =') && guard.params.includes('org') && guard.params.includes('headland'))).toBe(true);
});
