import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import type { ProviderCoordinator } from "./provider-coordinator";

const bindings = env as unknown as {
  PROVIDER_COORDINATOR: DurableObjectNamespace<ProviderCoordinator>;
};

it("coordinates and immediately refills eight AI slots through Durable Object RPC", async () => {
  const coordinator = bindings.PROVIDER_COORDINATOR.getByName(crypto.randomUUID());
  const granted = await Promise.all(Array.from({ length: 8 }, (_, index) =>
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
  for (let index = 0; index < 8; index++) await coordinator.reserve({ jobId: `job-${index}`, token: `token-${index}`, provider: "ai" });
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
  for (let index = 0; index < 8; index++) await coordinator.reserve({ jobId: `job-${index}`, token: `token-${index}`, provider: "ai" });
  const started = Date.now();
  const result = await coordinator.reserve({ jobId: "waiting", token: "waiting", provider: "ai", holdMs: 700 });
  expect(result).toMatchObject({ granted: false, queued: true });
  expect(Date.now() - started).toBeGreaterThanOrEqual(650);
});

it("admits several page waiters at once while slots are free", async () => {
  const coordinator = bindings.PROVIDER_COORDINATOR.getByName(crypto.randomUUID());
  const results = await Promise.all(["a", "b", "c", "d"].map(job => coordinator.reserve({ jobId: job, token: job, provider: "page" })));
  expect(results.filter(result => result.granted)).toHaveLength(4);
  expect(await coordinator.reserve({ jobId: "e", token: "e", provider: "page" })).toMatchObject({ granted: false, queued: true });
  expect((await coordinator.reserve({ jobId: "s", token: "s", provider: "search" })).granted).toBe(true);
});
