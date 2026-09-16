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

type ReserveInput = { jobId: string; token: string; provider: ResearchProvider; maxWaitMs?: number; local?: boolean };

export class ProviderCoordinator extends DurableObject {
  private async update<T>(change: (queue: ProviderQueue, now: number) => { queue: ProviderQueue; value: T }) {
    return this.ctx.storage.transaction(async transaction => {
      const queue = await transaction.get<ProviderQueue>("queue") || {};
      const next = change(queue, Date.now());
      await transaction.put("queue", next.queue);
      return next.value;
    });
  }

  async reserve(input: ReserveInput) {
    return this.update((queue, now) => {
      const result = reserveProvider(queue, input.jobId, input.token, input.provider, now, input.maxWaitMs, input.local, true);
      return { queue: result.queue, value: { managed: true, granted: Boolean(result.reservation), queued: 'queued' in result && result.queued === true, retryAfterMs: result.retryAfterMs, ...(result.reservation ? { after: result.reservation.after, until: result.reservation.until, token: input.token } : {}) } };
    });
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

  async cooldown(retryAfterMs: number) {
    return this.update((queue, now) => ({ queue: coolDownBrowser(queue, now, retryAfterMs), value: true }));
  }
}
