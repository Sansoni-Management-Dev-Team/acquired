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
