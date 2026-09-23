import { expect, it } from 'vitest';
import { releaseProvider, reserveProvider, AI_CONCURRENCY, type ProviderQueue } from './research-provider-queue';

function managedDuration(calls: number, durationMs: number) {
  let queue: ProviderQueue = {};
  let next = 0;
  const running: { job: string; token: string; completesAt: number }[] = [];
  const start = (now: number) => {
    while (next < calls && running.length < AI_CONCURRENCY) {
      const job = `job-${next}`, token = `token-${next++}`;
      const result = reserveProvider(queue, job, token, 'ai', now, undefined, false, true);
      queue = result.queue;
      expect(result.reservation).toBeDefined();
      running.push({ job, token, completesAt: now + durationMs });
    }
  };
  start(0);
  let now = 0;
  while (running.length) {
    now = Math.min(...running.map(item => item.completesAt));
    for (const item of running.filter(item => item.completesAt === now)) queue = releaseProvider(queue, item.token, item.job);
    for (let i = running.length - 1; i >= 0; i--) if (running[i].completesAt === now) running.splice(i, 1);
    start(now);
  }
  return now;
}

it('cuts the observed 133-call AI schedule from about 26 minutes to one minute under full demand', () => {
  const calls = 133, representativeCallMs = 12000;
  const previousDuration = Math.floor((calls - 1) / 4) * 47000 + representativeCallMs;
  const nextDuration = managedDuration(calls, representativeCallMs);
  expect(previousDuration).toBe(1563000);
  expect(nextDuration).toBe(60000);
  expect(nextDuration).toBeLessThan(previousDuration / 20);
});
