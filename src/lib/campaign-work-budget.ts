import { AsyncLocalStorage } from "node:async_hooks";

const work = new AsyncLocalStorage<number | undefined>();

export class CampaignWorkDeferred extends Error {
  constructor() { super("Campaign scheduler work deferred to the next tick"); }
}

export function campaignRemainingMs() {
  const deadline = work.getStore();
  return deadline === undefined ? Infinity : Math.max(0, deadline - Date.now());
}

export function assertCampaignWorkRemaining() {
  if (campaignRemainingMs() === 0) throw new CampaignWorkDeferred();
}

export function campaignWorkDeferred(error: unknown) {
  return error instanceof CampaignWorkDeferred || campaignRemainingMs() === 0;
}

export function withCampaignWorkBudget<T>(milliseconds: number, callback: () => Promise<T>) {
  return work.run(Date.now() + Math.min(milliseconds, campaignRemainingMs()), callback);
}

// Finish atomic page commits, lease cleanup and already-started deliveries even
// when the scheduler's admission budget has expired. Never detach this work.
export function withoutCampaignWorkBudget<T>(callback: () => Promise<T>) {
  return work.run(undefined, callback);
}

export function withCampaignWorkCleanup<T>(callback: () => Promise<T>) {
  return Number.isFinite(campaignRemainingMs()) ? work.run(Date.now() + 5000, callback) : callback();
}

export function campaignReadSignal(timeoutMs = 50_000) {
  assertCampaignWorkRemaining();
  const remaining = campaignRemainingMs();
  // An individual stalled reader should leave time for other account work.
  const perRead = Number.isFinite(remaining) ? 10_000 : timeoutMs;
  const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(timeoutMs, perRead, remaining))));
  if (remaining > Math.min(timeoutMs, perRead)) return timeout;
  // Preserve the cause even if Node's timer fires just before the wall-clock
  // deadline. Scheduler deferral must not be misreported as a provider outage.
  const controller = new AbortController();
  timeout.addEventListener("abort", () => controller.abort(new CampaignWorkDeferred()), { once: true });
  return controller.signal;
}
