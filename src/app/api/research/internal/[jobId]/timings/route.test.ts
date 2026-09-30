import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authorized: vi.fn(), enabled: vi.fn(), save: vi.fn(), limit: vi.fn() }));
vi.mock('@/lib/research-service', () => ({ researchServiceAuthorized: mocks.authorized, researchEnabled: mocks.enabled }));
vi.mock('@/db/client', () => ({ requireDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }) }) }));
vi.mock('@/db/research-timing-repository', () => ({ saveResearchTimingSpans: mocks.save }));
import { POST } from './route';
const jobId = '00000000-0000-4000-8000-000000000001';
const span = { id: '00000000-0000-4000-8000-000000000002', step: 'extract-1', segment: 'extraction', startedAt: '2026-09-30T00:00:00.000Z', finishedAt: '2026-09-30T00:00:01.000Z', elapsedMs: 1000, outcome: 'succeeded' };
const send = (body: unknown) => POST(new Request('https://app.example/api/research/internal/timings', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ jobId }) });
beforeEach(() => { vi.clearAllMocks(); mocks.authorized.mockReturnValue(true); mocks.enabled.mockReturnValue(true); mocks.limit.mockResolvedValue([{ organizationId: 'org' }]); mocks.save.mockResolvedValue(undefined); });
it('requires service authorization and validates payload before database access', async () => {
  mocks.authorized.mockReturnValue(false);
  expect((await send({ spans: [span] })).status).toBe(403);
  expect(mocks.limit).not.toHaveBeenCalled();
  mocks.authorized.mockReturnValue(true);
  expect((await send({ spans: [{ ...span, elapsedMs: -1 }] })).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
});
it('persists against the job organization and reports missing jobs', async () => {
  expect((await send({ spans: [span] })).status).toBe(200);
  expect(mocks.save).toHaveBeenCalledWith(jobId, 'org', [span]);
  mocks.limit.mockResolvedValue([]);
  expect((await send({ spans: [span] })).status).toBe(404);
  expect(mocks.save).toHaveBeenCalledOnce();
});
