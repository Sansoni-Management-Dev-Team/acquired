import { DurableObject } from "cloudflare:workers";
import {
  consumeProvider,
  coolDownBrowser,
  releaseProvider,
  reservationDelay,
  reserveProvider,
  type ProviderQueue,
  type ResearchProvider,
} from "../../src/domain/research-provider-queue";

type ReserveInput = { jobId: string; token: string; provider: ResearchProvider; maxWaitMs?: number; local?: boolean; holdMs?: number };
const HOLD_POLL_MS = 250;

export class ProviderCoordinator extends DurableObject {
  private async update<T>(change: (queue: ProviderQueue, now: number) => { queue: ProviderQueue; value: T }) {
    return this.ctx.storage.transaction(async transaction => {
      const queue = await transaction.get<ProviderQueue>("queue") || {};
      const next = change(queue, Date.now());
      await transaction.put("queue", next.queue);
      return next.value;
    });
  }

  // A queued caller may ask the coordinator to hold its request until capacity
  // frees or the hold expires, instead of sleeping and polling from a Workflow.
  async reserve(input: ReserveInput) {
    const deadline = Date.now() + Math.max(0, Math.min(input.holdMs || 0, 25000));
    for (;;) {
      const result = await this.update((queue, now) => {
        const result = reserveProvider(queue, input.jobId, input.token, input.provider, now, input.maxWaitMs, input.local, true);
        return { queue: result.queue, value: { managed: true, granted: Boolean(result.reservation), queued: 'queued' in result && result.queued === true, retryAfterMs: result.retryAfterMs, ...(result.reservation ? { after: result.reservation.after, until: result.reservation.until, token: input.token } : {}) } };
      });
      const remaining = deadline - Date.now();
      // Hold only for ordinary capacity waits; cooldowns and duplicate tokens return at once.
      if (result.granted || !result.queued || result.retryAfterMs > 1000 || remaining <= 0) return result;
      await new Promise(resolve => setTimeout(resolve, Math.min(HOLD_POLL_MS, remaining)));
    }
  }

  async claim(jobId: string, token: string, domain?: string) {
    return this.update((queue, now) => {
      const delay = reservationDelay(queue, token, jobId, now, domain);
      const consumed = delay === 0 ? consumeProvider(queue, token, jobId, now, domain) : null;
      return { queue: consumed || queue, value: { granted: Boolean(consumed), retryAfterMs: delay ?? 0, expired: delay === null } };
    });
  }

  async release(jobId: string, token: string) {
    return this.update(queue => ({ queue: releaseProvider(queue, token, jobId), value: true }));
  }

  async cooldown(retryAfterMs: number, domain?: string) {
    return this.update((queue, now) => ({ queue: coolDownBrowser(queue, now, retryAfterMs, domain), value: true }));
  }
}
