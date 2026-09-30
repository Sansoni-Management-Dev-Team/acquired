import { expect, it, vi } from 'vitest';
vi.mock('./client', () => ({ requireDb: vi.fn() }));
import { PgDialect } from 'drizzle-orm/pg-core';
import { researchControlConfig, researchExecutionSelection, researchReviewSelection } from './research-repository';
const query = (value: unknown) => new PgDialect().sqlToQuery(value as never);
it('execution reads exclude telemetry and scheduler internals without discarding resumable pages', () => {
 const sql = query(researchExecutionSelection.config).sql;
 expect(sql).toContain("- 'pipelineTiming' - 'scheduling'");
 expect(sql).not.toContain('pendingPage');
});
it('control reads request only cancellation, counters, flags and deadlines', () => {
 const sql = query(researchControlConfig).sql;
 expect(sql).toContain('automaticDeadline');
 expect(sql).toContain('performanceFlags');
 expect(sql).not.toContain('runtime');
 expect(sql).not.toContain('pipelineTiming');
});
it('review reads preserve attempts and remaining URLs but exclude buffered page text', () => {
 const sql = query(researchReviewSelection.config).sql;
 expect(sql).toContain("- 'pendingPage' - 'bufferedPage'");
 expect(sql).toContain("- 'discoverySourceCandidates'");
 expect(sql).not.toContain("- 'attempts'");
 expect(sql).toContain("- 'pipelineTiming'");
});
it.skipIf(process.env.RUN_RESEARCH_SCHEDULER_SQL_TESTS !== 'true')('evaluates review/execution/control JSON projections with SELECT-only PostgreSQL queries', async () => {
 const { Client } = await import('pg');
 const client = new Client({ connectionString: 'postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire' });
 await client.connect();
 const config = { discoveryAttempts: [{ query: 'query one', reason: 'first', resultCount: 2, newDomains: 1, results: [{ title: 'Result', snippet: 'Long snippet', url: 'https://example.com' }] }, { query: 'query two', reason: 'second', results: [] }], budget: { maxMinutes: 5 }, performanceFlags: { telemetryBatching: true }, scheduling: { generation: 1 }, pipelineTiming: { span: {} }, discoverySourceCandidates: [{ markdown: 'private' }], runtime: { remaining: ['https://example.com'], attempts: [], pendingPage: { markdown: 'private' }, bufferedPage: { markdown: 'private' } } };
 try {
  const evaluate = async (expression: unknown) => {
   const rendered = query(expression);
   const params = [...rendered.params, JSON.stringify(config)];
   const statement = rendered.sql.replaceAll('"research_jobs"."config"', `$${params.length}::jsonb`);
   return (await client.query(`SELECT ${statement} AS value`, params)).rows[0].value;
  };
  const execution = await evaluate(researchExecutionSelection.config);
  expect(execution.runtime.pendingPage).toEqual(config.runtime.pendingPage);
  expect(execution).not.toHaveProperty('pipelineTiming');
  const review = await evaluate(researchReviewSelection.config);
  expect(review.runtime).toEqual({ remaining: config.runtime.remaining, attempts: [] });
  expect(review).not.toHaveProperty('pipelineTiming');
  expect(review.discoveryAttempts).toEqual(config.discoveryAttempts.map(({results, ...attempt}) => { void results; return attempt; }));
  expect(execution.discoveryAttempts).toEqual(config.discoveryAttempts);
  expect(review).not.toHaveProperty('discoverySourceCandidates');
  const control = await evaluate(researchControlConfig);
  expect(control.budget).toEqual(config.budget);
  expect(control).not.toHaveProperty('runtime');
 } finally { await client.end(); }
});
it('review projection excludes search result snippets while retaining ordered history and exact timing samples', () => {
 const sql = query(researchReviewSelection.config).sql;
 expect(sql).toContain("- 'results'");
 expect(sql).toContain('WITH ORDINALITY');
 expect(sql).toContain("- 'pipelineTiming'");
 expect(query(researchExecutionSelection.config).sql).not.toContain("- 'results'");
});
