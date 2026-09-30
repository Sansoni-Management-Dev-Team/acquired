import { expect, it, vi } from 'vitest';
import { captureResearchDatabaseDiagnostics } from './capture-research-db-diagnostics.mjs';

it('uses SELECT-only existing statement statistics and never returns SQL or credentials', async () => {
 const query = vi.fn()
  .mockResolvedValueOnce({ rows: [{ schema: 'extensions' }] })
  .mockResolvedValueOnce({ rows: [{ queryId: '42', calls: 3, executionMs: 12, rowsReturned: 8 }] });
 const report = await captureResearchDatabaseDiagnostics({ query });
 expect(report).toMatchObject({ availability: 'available', timingBasis: 'database_server_statement_execution', statements: [{ queryId: '42', calls: 3, executionMs: 12, rowsReturned: 8 }] });
 for (const [sql] of query.mock.calls) expect(sql.trim()).toMatch(/^SELECT\b/i);
 expect(query.mock.calls[1][0]).not.toMatch(/SELECT\s+query\s*,/i);
 expect(JSON.stringify(report)).not.toContain('SELECT');
});

it('reports unavailable diagnostics without installing an extension or resetting counters', async () => {
 const query = vi.fn().mockResolvedValue({ rows: [] });
 expect(await captureResearchDatabaseDiagnostics({ query })).toMatchObject({ availability: 'unavailable', reason: 'existing_statement_statistics_not_found', statements: [] });
 expect(query).toHaveBeenCalledTimes(1);
});

it('retains safe permission failure classification without emitting error messages', async () => {
 const query = vi.fn().mockRejectedValue(Object.assign(new Error('private database URL'), { code: '42501' }));
 const report = await captureResearchDatabaseDiagnostics({ query });
 expect(report).toMatchObject({ availability: 'unavailable', reason: 'diagnostics_query_failed', databaseErrorCode: '42501' });
 expect(JSON.stringify(report)).not.toContain('private');
});
