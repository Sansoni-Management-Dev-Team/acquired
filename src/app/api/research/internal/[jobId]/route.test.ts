import { beforeEach, expect, it, vi } from 'vitest';
import type { ResearchConfig } from '@/domain/research';
const mocks = vi.hoisted(() => ({ authorized: vi.fn(), get: vi.fn(), progress: vi.fn(), save: vi.fn(), after: vi.fn(), select: vi.fn(), cooldown: vi.fn() }));
vi.mock('@/lib/research-provider-queue', () => ({ coolDownResearchBrowser: mocks.cooldown, reserveResearchProvider: vi.fn(), releaseResearchProvider: vi.fn() }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/lib/research-service', () => ({ researchEnabled: () => true, researchServiceAuthorized: mocks.authorized }));
vi.mock('@/db/research-timing-repository', () => ({ saveResearchTimingSpans: mocks.save }));
vi.mock('@/db/research-repository', async original => {
  const actual = await original<typeof import('@/db/research-repository')>();
  return { ...actual, ResearchRepository: class { get = mocks.get; getExecution = mocks.get; getControl = mocks.get; progress = mocks.progress; } };
});
vi.mock('@/db/client', () => ({ requireDb: () => ({ select: mocks.select }) }));
import { GET, POST } from './route';
const jobId = '00000000-0000-4000-8000-000000000001';
const span = { id: '00000000-0000-4000-8000-000000000010', step: 'extract-1', segment: 'extraction', startedAt: '2026-09-30T00:00:00.000Z', finishedAt: '2026-09-30T00:00:00.001Z', elapsedMs: 1, outcome: 'succeeded' };
const config: ResearchConfig = { seeds: [], searchTerms: ['sensors'], geography: 'Australia', approved: true, discover: false, performanceFlags: { telemetryBatching: true }, budget: { maxPages: 3, maxModelCalls: 3, maxMinutes: 10, maxDomains: 3 } };
let job: { id: string; organizationId: string; mandateId: string; createdAt: Date; updatedAt: Date; status: string; seeds: string[]; config: ResearchConfig; revision: number; crawlId: null };
const call = (data: unknown) => POST(new Request('http://app/api', { method: 'POST', body: JSON.stringify(data), headers: { 'x-request-id': 'worker-request-123' } }), { params: Promise.resolve({ jobId }) });
const event = { revision: 1, status: 'crawling', pages: 0, modelCalls: 0, message: 'Heartbeat' };
beforeEach(() => {
  vi.clearAllMocks();
  job = { id: jobId, organizationId: 'org', mandateId: 'mandate', createdAt: new Date(), updatedAt: new Date(), status: 'queued', seeds: [], config: structuredClone(config), revision: 0, crawlId: null };
  mocks.authorized.mockReturnValue(true);
  mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [job] }) }) });
  mocks.get.mockImplementation(async () => job);
  mocks.progress.mockImplementation(async () => ({ ...job, status: event.status, revision: event.revision }));
  mocks.save.mockResolvedValue(undefined);
});
it('persists piggyback telemetry once and acknowledges only after the write succeeds', async () => {
  const response = await call({ ...event, timingSpans: [span] });
  expect(await response.json()).toMatchObject({ ok: true, timingAcceptedIds: [span.id] });
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save).toHaveBeenCalledWith(jobId, 'org', [span]);
  expect(mocks.progress).toHaveBeenCalledWith(jobId, expect.objectContaining(event), job);
  expect(mocks.get).not.toHaveBeenCalled();
  expect(response.headers.get('x-request-id')).toBe('worker-request-123');
  expect(response.headers.get('server-timing')).toContain('db;dur=');
});
it('saves useful progress when telemetry fails but does not acknowledge lost spans', async () => {
  mocks.save.mockRejectedValue(new Error('database unavailable for telemetry'));
  const response = await call({ ...event, timingSpans: [span] });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, timingAcceptedIds: [] });
  expect(mocks.progress).toHaveBeenCalledTimes(1);
});
it('does not acknowledge telemetry or save it when progress is rejected', async () => {
  mocks.progress.mockRejectedValue(new Error('write failed'));
  expect((await call({ ...event, timingSpans: [span] })).status).toBe(409);
  expect(mocks.save).not.toHaveBeenCalled();
});
it('rejects invalid or unauthorized timing batches before persistence', async () => {
  expect((await call({ ...event, timingSpans: Array(65).fill(span) })).status).toBe(400);
  mocks.authorized.mockReturnValue(false);
  expect((await call({ ...event, timingSpans: [span] })).status).toBe(403);
  expect(mocks.progress).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it('preserves legacy progress without requiring a timing acknowledgement', async () => {
  job.config.performanceFlags = undefined;
  const response = await call(event);
  expect(await response.json()).toMatchObject({ ok: true });
  expect(mocks.save).not.toHaveBeenCalled();
});
it('adds correlated timing headers to authorized and rejected control requests', async () => {
  const request = new Request('http://app/api', { headers: { 'x-request-id': 'worker-request-123' } });
  const response = await GET(request, { params: Promise.resolve({ jobId }) });
  expect(response.headers.get('x-request-id')).toBe('worker-request-123');
  expect(response.headers.get('server-timing')).toContain('app;dur=');
  mocks.authorized.mockReturnValue(false);
  const rejected = await GET(request, { params: Promise.resolve({ jobId }) });
  expect(rejected.status).toBe(403);
  expect(rejected.headers.get('x-request-id')).toBe('worker-request-123');
});

it('batches server-side spans with incoming worker spans but only acknowledges the worker IDs', async () => {
  const { measureResearchSegment } = await import('@/lib/research-segment-timing');
  mocks.progress.mockImplementation(async () => {
    await measureResearchSegment(jobId, 'org', 'db-save', 'persistence', async () => undefined);
    await measureResearchSegment(jobId, 'org', 'validation', 'other', async () => undefined);
    return job;
  });
  const response = await call({ ...event, timingSpans: [span] });
  expect((await response.json()).timingAcceptedIds).toEqual([span.id]);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0][2]).toHaveLength(3);
});

it('acknowledges a replayed batch after idempotent progress reports an already completed job', async () => {
  job.status = 'complete';
  mocks.progress.mockResolvedValue(job);
  const response = await call({ ...event, timingSpans: [span] });
  expect((await response.json()).timingAcceptedIds).toEqual([span.id]);
  expect(mocks.save).toHaveBeenCalledTimes(1);
});

it('uses a lean config projection for subsequent controls without fetching the full job twice', async () => {
  const { PgDialect } = await import('drizzle-orm/pg-core');
  const response = await GET(new Request('http://app/api?control=1'), { params: Promise.resolve({ jobId }) });
  expect(response.status).toBe(200);
  expect(mocks.select).toHaveBeenCalledTimes(1);
  const selected = mocks.select.mock.calls[0][0];
  const query = new PgDialect().sqlToQuery(selected.config);
  expect(query.sql).toContain('jsonb_build_object');
  expect(query.sql).not.toContain("'runtime'");
  expect(query.sql).not.toContain("'pipelineTiming'");
  expect(mocks.get).not.toHaveBeenCalled();
});
it('acknowledges replayed terminal telemetry without scheduling the run again', async () => {
 job.revision = 1;
 job.status = 'complete';
 const response = await call({ ...event, status: 'complete', timingSpans: [span] });
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({ timingAcceptedIds: [span.id] });
 expect(mocks.after).not.toHaveBeenCalled();
});


it('normalizes website cooldowns for the SQL fallback while retaining global capacity cooldowns', async () => {
  expect((await call({ action: 'browser-cooldown', retryAfterMs: 3000, domain: 'www.Example.com' })).status).toBe(200);
  expect(mocks.cooldown).toHaveBeenLastCalledWith(3000, 'example.com');
  expect((await call({ action: 'browser-cooldown', retryAfterMs: 3000 })).status).toBe(200);
  expect(mocks.cooldown).toHaveBeenLastCalledWith(3000, undefined);
});
it.each(['private.example/path', 'user:secret@example.com', 'https://example.com', '', 123, 'example.com:443'])('rejects malformed cooldown domain %s without poisoning the shared queue', async domain => {
  expect((await call({ action: 'browser-cooldown', retryAfterMs: 3000, domain })).status).toBe(400);
  expect(mocks.cooldown).not.toHaveBeenCalled();
});
