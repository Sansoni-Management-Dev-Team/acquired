import { expect, it, vi } from 'vitest';
import { providerStep } from './provider-step';
import type { ResearchSteps } from '../../src/domain/research-runner';
it('sleeps durably before work and replays the completed step without another request', async () => {
  let now = 0;
  const results = new Map<string, unknown>();
  const steps: ResearchSteps = { do: async (name, run) => { if (!results.has(name)) results.set(name, await run()); return results.get(name) as never; }, sleep: vi.fn(async (_name, ms) => { now += ms; }) };
  const reserve = vi.fn(async token => ({ granted: true, after: 10000, until: 12000, token, retryAfterMs: 10000 }));
  const run = vi.fn(async () => 'saved evidence');
  expect(await providerStep(steps, 'page-1', 'page', reserve, run, () => now)).toBe('saved evidence');
  expect(steps.sleep).toHaveBeenCalledWith('wait-page-1-0', 10000);
  now = 900000;
  expect(await providerStep(steps, 'page-1', 'page', reserve, run, () => now)).toBe('saved evidence');
  expect(reserve).toHaveBeenCalledOnce(); expect(run).toHaveBeenCalledOnce();
});
it('rebooks an expired slot without issuing an unadmitted request', async () => {
  let now = 0;
  const steps: ResearchSteps = { do: async (_name, run) => run(), sleep: async (_name, ms) => { now += ms + 3000; } };
  const reserve = vi.fn().mockResolvedValueOnce({ granted: true, after: 1000, until: 3000, retryAfterMs: 1000 }).mockImplementation(async token => ({ granted: true, after: now, until: now + 2000, retryAfterMs: 0, token }));
  const run = vi.fn(async () => 'done');
  await expect(providerStep(steps, 'page', 'page', reserve, run, () => now)).resolves.toBe('done');
  expect(run).toHaveBeenCalledOnce(); expect(reserve).toHaveBeenCalledTimes(2);
});
