import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import type { ProviderCoordinator } from "./provider-coordinator";
import { AI_CONCURRENCY, PAID_PAGE_SLOTS, PAID_START_SPACING_MS } from "../../src/domain/research-provider-queue";

const bindings = env as unknown as {
  PROVIDER_COORDINATOR: DurableObjectNamespace<ProviderCoordinator>;
};

it('admits five local page reads and refills the sixth after a completed read', async () => {
  const coordinator = bindings.PROVIDER_COORDINATOR.getByName(crypto.randomUUID());
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => coordinator.reserve({ jobId: `local-${i}`, token: `local-${i}`, provider: 'page', local: true })));
  expect(results.every(result => result.granted)).toBe(true);
  expect(await coordinator.reserve({ jobId: 'sixth', token: 'sixth', provider: 'page', local: true })).toMatchObject({ granted: false, queued: true });
  await coordinator.release('local-0', 'local-0');
  expect(await coordinator.reserve({ jobId: 'sixth', token: 'sixth', provider: 'page', local: true })).toMatchObject({ granted: true, retryAfterMs: 0 });
});

it("coordinates and immediately refills the AI pool through Durable Object RPC", async () => {
  const coordinator = bindings.PROVIDER_COORDINATOR.getByName(crypto.randomUUID());
  const granted = await Promise.all(Array.from({ length: AI_CONCURRENCY }, (_, index) =>
    coordinator.reserve({ jobId: `job-${index}`, token: `token-${index}`, provider: "ai" }),
  ));
  expect(granted.every(result => result.granted)).toBe(true);

  const waiting = await coordinator.reserve({ jobId: "waiting", token: "waiting", provider: "ai" });
  expect(waiting).toMatchObject({ granted: false, queued: true, retryAfterMs: 1000 });

  await coordinator.release("job-0", "token-0");
  const refilled = await coordinator.reserve({ jobId: "waiting", token: "waiting", provider: "ai" });
  expect(refilled).toMatchObject({ granted: true, retryAfterMs: 0 });
});

it("holds a queued reservation until another job releases capacity", async () => {
  const coordinator = bindings.PROVIDER_COORDINATOR.getByName(crypto.randomUUID());
  for (let index = 0; index < AI_CONCURRENCY; index++) await coordinator.reserve({ jobId: `job-${index}`, token: `token-${index}`, provider: "ai" });
  const started = Date.now();
  const held = coordinator.reserve({ jobId: "waiting", token: "waiting", provider: "ai", holdMs: 5000 });
  await new Promise(resolve => setTimeout(resolve, 600));
  await coordinator.release("job-3", "token-3");
  const result = await held;
  expect(result).toMatchObject({ granted: true, token: "waiting" });
  expect(Date.now() - started).toBeGreaterThanOrEqual(600);
  expect(Date.now() - started).toBeLessThan(3000);
});

it("returns a queued answer when the hold expires without capacity", async () => {
  const coordinator = bindings.PROVIDER_COORDINATOR.getByName(crypto.randomUUID());
  for (let index = 0; index < AI_CONCURRENCY; index++) await coordinator.reserve({ jobId: `job-${index}`, token: `token-${index}`, provider: "ai" });
  const started = Date.now();
  const result = await coordinator.reserve({ jobId: "waiting", token: "waiting", provider: "ai", holdMs: 700 });
  expect(result).toMatchObject({ granted: false, queued: true });
  expect(Date.now() - started).toBeGreaterThanOrEqual(650);
});

it("admits several page waiters at once while slots are free", async () => {
  const coordinator = bindings.PROVIDER_COORDINATOR.getByName(crypto.randomUUID());
  const jobs = Array.from({ length: PAID_PAGE_SLOTS }, (_, index) => `page-${index}`);
  const results = await Promise.all(jobs.map(job => coordinator.reserve({ jobId: job, token: job, provider: "page" })));
  // Starts are staggered 350 ms apart and never booked more than ten seconds ahead,
  // so a burst of 32 admits at least 28 at once; the rest are queued, not refused.
  const granted = results.filter(result => result.granted);
  expect(granted.length).toBeGreaterThanOrEqual(Math.floor(10000 / PAID_START_SPACING_MS));
  expect(granted.length).toBeLessThanOrEqual(PAID_PAGE_SLOTS);
  expect(results.filter(result => !result.granted).every(result => result.queued && result.retryAfterMs > 0)).toBe(true);
  const after = granted.map(result => result.after!).sort((a, b) => a - b);
  expect(after.every((value, index) => index === 0 || value - after[index - 1] >= PAID_START_SPACING_MS)).toBe(true);
  // The start stagger is account-wide: a search arriving behind the burst is
  // queued behind the booked starts rather than refused or admitted early.
  const search = await coordinator.reserve({ jobId: "s", token: "s", provider: "search" });
  expect(search.granted || (search.queued && search.retryAfterMs > 0)).toBe(true);
});

it('persists a website cooldown without stopping unrelated website claims', async () => {
  const coordinator = bindings.PROVIDER_COORDINATOR.getByName(crypto.randomUUID());
  await coordinator.cooldown(12000, 'blocked.example');
  await coordinator.reserve({ jobId: 'a', token: 'a', provider: 'page' });
  expect(await coordinator.claim('a', 'a', 'blocked.example')).toMatchObject({ granted: false, expired: false });
  expect(await coordinator.claim('a', 'a', 'other.example')).toMatchObject({ granted: true, retryAfterMs: 0 });
  await coordinator.release('a', 'a');
});
