import { expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { researchQueryIdentity, researchResultMetrics } from './research-egress-metrics';
it('counts UTF-8 bytes and large fields without retaining record contents', () => {
  const rows = [{ config: { text: '£🚀' }, evidence: { private: 'secret' } }];
  const metrics = researchResultMetrics({ rows });
  expect(metrics.resultJsonBytes).toBe(Buffer.byteLength(JSON.stringify(rows)));
  expect(metrics.fieldJsonBytes?.config).toBe(Buffer.byteLength(JSON.stringify(rows[0].config)));
  expect(JSON.stringify(metrics)).not.toContain('secret');
});
it('handles empty results and unmeasurable records without changing query success', () => {
  expect(researchResultMetrics({rowCount:1})).toMatchObject({rowsReturned:0,resultJsonBytes:2});
  expect(researchResultMetrics([{value:BigInt(1)}])).toEqual({rowsReturned:1,byteMeasurement:'unavailable'});
});
it('fingerprints query shape without logging SQL or bindings, including raw SQL', () => {
  const first = researchQueryIdentity(sql`select config from research_jobs where id=${'secret'}`);
  expect(first.tables).toEqual(['research_jobs']);
  expect(first.queryFingerprint).toBe(researchQueryIdentity(sql`select config from research_jobs where id=${'other'}`).queryFingerprint);
  expect(JSON.stringify(first)).not.toContain('secret');
  expect(researchQueryIdentity({toSQL:()=>({sql:"select config from research_jobs where id='private'"})}).queryFingerprint).toBe(researchQueryIdentity({toSQL:()=>({sql:"select config from research_jobs where id='different'"})}).queryFingerprint);
});
