import { expect, it, vi } from 'vitest';
import { compactMandateQuery, readCompactMandate, tailMandate } from './tail-mandate.mjs';

it('RC-18-regression: timeout records a gap and reconnects instead of exiting', async () => {
  let clock = 0;
  const emit = vi.fn();
  const read = vi.fn().mockRejectedValueOnce(Object.assign(new Error('secret database detail'), { code: '57014' })).mockResolvedValueOnce({ jobs: { running: 1 }, sync: {} }).mockResolvedValueOnce({ jobs: { complete: 1 }, sync: {} });
  expect(await tailMandate({ read, emit, now: () => clock, sleep: async ms => { clock += ms; } })).toEqual({ finished: true, samples: 3 });
  expect(read).toHaveBeenCalledTimes(3);
  expect(emit.mock.calls.map(([e]) => e.kind)).toEqual(['read_error', 'gap', 'sample', 'sample']);
  expect(emit.mock.calls[1][0]).toMatchObject({ from: '1970-01-01T00:00:00.000Z', to: '1970-01-01T00:01:00.000Z', failedSamples: 1, backendOutageConfirmed: false });
  expect(JSON.stringify(emit.mock.calls)).not.toContain('secret');
});

it('RC-18-generalization: repeated failures have bounded backoff and an unresolved gap', async () => {
  let clock = 0;
  const durations = [], events = [];
  const result = await tailMandate({ read: async () => { throw new Error('disconnected'); }, emit: e => events.push(e), maxSamples: 4, now: () => clock, sleep: async ms => { durations.push(ms); clock += ms; } });
  expect(durations).toEqual([60_000, 60_000, 60_000]);
  expect(result.finished).toBe(false);
  expect(events.at(-1)).toMatchObject({ kind: 'gap', unresolved: true, failedSamples: 4 });
});

it.each(['discovering', 'crawling', 'extracting', 'running', 'queued', 'unknown_future_state'])('RC-18-generalization: %s is not terminal', async status => {
  const events = [];
  expect(await tailMandate({ read: async () => ({ jobs: { [status]: 1 }, sync: {} }), emit: e => events.push(e), maxSamples: 1 })).toMatchObject({ finished: false });
  expect(events[0].finished).toBe(false);
});

it('RC-18-integration: transport uses read-only compact SQL and destroys a failed connection', async () => {
  const failed = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  failed.query.mockRejectedValueOnce(new Error('connectivity'));
  const healthy = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'm', jobs: { complete: 1 } }] }), release: vi.fn() };
  const pool = { connect: vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce(healthy) };
  await expect(readCompactMandate(pool, 'm')).rejects.toThrow('connectivity');
  expect(failed.release).toHaveBeenCalledWith(true);
  expect(await readCompactMandate(pool, 'm')).toMatchObject({ id: 'm' });
  expect(healthy.query.mock.calls.map(([query]) => query)).toEqual(['BEGIN READ ONLY', "SET LOCAL statement_timeout = '10s'", compactMandateQuery, 'ROLLBACK']);
  expect(healthy.release).toHaveBeenCalledWith(false);
  expect(compactMandateQuery).not.toMatch(/config|personal_data|SELECT\s+\*/i);
  expect(compactMandateQuery).toContain('mt.organization_id=c.organization_id');
});
