import { expect, it, vi } from 'vitest';
import { cachedResearchExtraction } from './research-extraction-cache';
const setup = () => {
  const saved = new Map<string, Response>();
  return { match: vi.fn(async (key: Request) => saved.get(key.url)?.clone()), put: vi.fn(async (key: Request, value: Response) => { saved.set(key.url, value); }) };
};
it('reuses exact scope and source only within the same run', async () => {
  const cache = setup(); const read = vi.fn(async () => ({ response: { findings: [] } }));
  const request = { messages: [{ content: 'scope and source text' }], response_format: { schema: 'v1' } };
  await cachedResearchExtraction(cache as unknown as Cache, 'a', request, read);
  await cachedResearchExtraction(cache as unknown as Cache, 'a', request, read);
  expect(read).toHaveBeenCalledOnce();
  await cachedResearchExtraction(cache as unknown as Cache, 'b', request, read);
  await cachedResearchExtraction(cache as unknown as Cache, 'a', { ...request, messages: [{ content: 'changed scope or source' }] }, read);
  await cachedResearchExtraction(cache as unknown as Cache, 'a', { ...request, response_format: { schema: 'v2' } }, read);
  expect(read).toHaveBeenCalledTimes(4);
});
it('shares simultaneous exact requests but does not cache rejected responses', async () => {
  const cache = setup();
  let release!: (result: object) => void;
  const read = vi.fn(() => new Promise<object>(resolve => { release = resolve; }));
  const a = cachedResearchExtraction(cache as unknown as Cache, 'run', { source: 'same' }, read);
  const b = cachedResearchExtraction(cache as unknown as Cache, 'run', { source: 'same' }, read);
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  release({ findings: [] }); expect(await a).toEqual(await b);
  const reject = vi.fn(async () => { throw new Error('schema rejected'); });
  for (let i = 0; i < 2; i++) await expect(cachedResearchExtraction(cache as unknown as Cache, 'run', {}, reject)).rejects.toThrow();
  expect(reject).toHaveBeenCalledTimes(2);
});
it('revalidates after expiry', async () => {
  vi.useFakeTimers();
  try {
    const cache = setup(); const read = vi.fn(async () => ({ findings: [] }));
    await cachedResearchExtraction(cache as unknown as Cache, 'run', {}, read);
    vi.advanceTimersByTime(3600001);
    await cachedResearchExtraction(cache as unknown as Cache, 'run', {}, read);
    expect(read).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
