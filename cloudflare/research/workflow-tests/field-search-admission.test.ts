import { expect, it, vi } from 'vitest';
import worker from '../index';

const jobId = '00000000-0000-4000-8000-000000000001';
const token = 'rca-reserved-search';
function setup() {
  const coordinator = {
    reserve: vi.fn(async (input: { token: string }) => ({ granted: true, managed: true, retryAfterMs: 0, token: input.token })),
    claim: vi.fn(async () => ({ granted: true, retryAfterMs: 0 })),
    release: vi.fn(async () => {}),
  };
  const environment = {
    SERVICE_SECRET: 'offline-fixture', CF_ACCOUNT_ID: 'offline', CF_BROWSER_TOKEN: 'offline',
    PROVIDER_COORDINATOR: { getByName: () => coordinator },
  } as unknown as Parameters<typeof worker.fetch>[1];
  return { coordinator, environment };
}
function request(reserved = false) {
  return new Request('https://worker.example/search', {
    method: 'POST', headers: {
      authorization: 'Bearer offline-fixture', 'content-type': 'application/json',
      'x-research-job-id': jobId,
      ...(reserved ? { 'x-research-browser-reservation': token } : {}),
    }, body: JSON.stringify({ query: 'site:example.com company contact' }),
  });
}
it('admits an unreserved background field search through the shared coordinator', async () => {
  const { environment, coordinator } = setup();
  const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
    success: true, result: '## [Example Company](https://example.com/contact)\nCompany contact details',
  }));
  try {
    const response = await worker.fetch(request(), environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ seeds: ['https://example.com/contact'] });
    expect(coordinator.reserve).toHaveBeenCalledOnce();
    const reservation = coordinator.reserve.mock.calls[0][0] as { token: string };
    expect(coordinator.claim).toHaveBeenCalledWith(jobId, reservation.token, 'html.duckduckgo.com');
    expect(coordinator.release).toHaveBeenCalledWith(jobId, reservation.token);
    expect(upstream).toHaveBeenCalledOnce();
  } finally { upstream.mockRestore(); }
});
it('a reserved control reaches the browser and returns search results', async () => {
  const { environment, coordinator } = setup();
  const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
    success: true, result: '## [Example Company](https://example.com/contact)\nCompany contact details',
  }));
  try {
    const response = await worker.fetch(request(true), environment);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ seeds: ['https://example.com/contact'] });
    expect(coordinator.reserve).not.toHaveBeenCalled();
    expect(coordinator.claim).toHaveBeenCalledWith(jobId, token, 'html.duckduckgo.com');
    expect(coordinator.release).toHaveBeenCalledWith(jobId, token);
    expect(upstream).toHaveBeenCalledOnce();
  } finally { upstream.mockRestore(); }
});

it('waits for shared capacity and releases its reservation after an upstream error', async () => {
  vi.useFakeTimers();
  const { environment, coordinator } = setup();
  coordinator.reserve.mockResolvedValueOnce({ granted: false, managed: true, retryAfterMs: 1000, token: '' });
  const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: false }, { status: 502 }));
  try {
    const pending = worker.fetch(request(), environment);
    await vi.advanceTimersByTimeAsync(500);
    expect(upstream).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    const response = await pending;
    expect(response.status).toBe(502);
    expect(coordinator.reserve).toHaveBeenCalledTimes(2);
    expect(coordinator.release).toHaveBeenCalledOnce();
    expect(upstream).toHaveBeenCalledOnce();
  } finally { upstream.mockRestore(); vi.useRealTimers(); }
});
it('cleans up a queued reservation when capacity cannot be admitted within the caller deadline', async () => {
  const { environment, coordinator } = setup();
  coordinator.reserve.mockResolvedValue({ granted: false, managed: true, retryAfterMs: 30000, token: '' });
  const upstream = vi.spyOn(globalThis, 'fetch');
  const req = request(); req.headers.set('x-research-deadline', String(Date.now() + 500));
  try {
    const response = await worker.fetch(req, environment);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ category: 'browser_admission' });
    expect(coordinator.release).toHaveBeenCalledOnce();
    expect(coordinator.claim).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  } finally { upstream.mockRestore(); }
});
it('never sends an expired supplied reservation upstream and releases it', async () => {
  const { environment, coordinator } = setup();
  coordinator.claim.mockResolvedValue({ granted: false, retryAfterMs: 0, expired: true } as Awaited<ReturnType<typeof coordinator.claim>>);
  const upstream = vi.spyOn(globalThis, 'fetch');
  try {
    const response = await worker.fetch(request(true), environment);
    expect(response.status).toBe(503);
    expect(coordinator.reserve).not.toHaveBeenCalled();
    expect(coordinator.release).toHaveBeenCalledWith(jobId, token);
    expect(upstream).not.toHaveBeenCalled();
  } finally { upstream.mockRestore(); }
});
it('does not book capacity after the background deadline has passed', async () => {
  const { environment, coordinator } = setup();
  const req = request(); req.headers.set('x-research-deadline', String(Date.now() - 1));
  const response = await worker.fetch(req, environment);
  expect(response.status).toBe(503);
  expect(coordinator.reserve).not.toHaveBeenCalled();
  expect(coordinator.claim).not.toHaveBeenCalled();
});

it('shares rate-limit cooldown and releases the synchronous search slot', async () => {
  const { environment, coordinator } = setup();
  const cooldown = vi.fn(async () => {});
  environment.PROVIDER_COORDINATOR = { getByName: () => ({ ...coordinator, cooldown }) } as unknown as NonNullable<typeof environment.PROVIDER_COORDINATOR>;
  const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success: false }, { status: 429, headers: { 'retry-after': '2' } }));
  try {
    const response = await worker.fetch(request(), environment);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({category:'browser_admission'});
    expect(cooldown).toHaveBeenCalledWith(2000, undefined);
    expect(coordinator.release).toHaveBeenCalledOnce();
    expect(upstream).toHaveBeenCalledOnce();
  } finally { upstream.mockRestore(); }
});
it('releases capacity even when the browser transport throws', async () => {
  const { environment, coordinator } = setup();
  const upstream = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private transport diagnostic'));
  try {
    const response = await worker.fetch(request(), environment);
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({category:'transport'});
    expect(JSON.stringify(body)).not.toContain('private');
    expect(coordinator.release).toHaveBeenCalledOnce();
  } finally { upstream.mockRestore(); }
});
