import { expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ WorkflowEntrypoint: class {}, DurableObject: class {} }));
import worker from './index';
it.each([{ page: 2 }, { engine: 'google' }])('explicitly rejects unsupported production search %j without a provider call', async parameters => {
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const request = new Request('https://worker.example.com/search', { method: 'POST', headers: { authorization: 'Bearer test' }, body: JSON.stringify({ query: 'calibration Australia', ...parameters }) });
  const response = await worker.fetch(request, { SERVICE_SECRET: 'test' } as Parameters<typeof worker.fetch>[1]);
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ category: 'unsupported_search' });
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockRestore();
});
