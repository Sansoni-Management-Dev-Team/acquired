import type { ResearchProvider } from '../../src/domain/research-provider-queue';
import { BrowserAdmissionDeferred } from '../../src/domain/research-provider-error';
import type { ResearchSteps } from '../../src/domain/research-runner';
export type Admission = { granted: boolean; managed?: boolean; queued?: boolean; retryAfterMs: number; after?: number; until?: number; token?: string };

// Admission and waiting are separate checkpoints. On replay, a finished work
// step returns its saved result without acquiring another slot or reading again.
export async function providerStep<T>(steps: ResearchSteps, name: string, provider: ResearchProvider, reserve: (token: string) => Promise<Admission>, run: (token: string) => Promise<T>, now = Date.now): Promise<T> {
  let misses = 0;
  let queuedCapacity = false;
  for (let round = 0; round < 480 && misses < 3; round++) {
    const token = `${name}-${round}`;
    const permit = await steps.do(`admit-${token}`, () => reserve(token));
    queuedCapacity ||= permit.queued === true || permit.managed === true;
    const wait = permit.granted ? Math.max(0, (permit.after || 0) - now()) : permit.retryAfterMs;
    if (wait) await steps.sleep(`wait-${token}`, wait);
    if (!permit.granted) { if (!permit.queued) misses++; continue; }
    const result = await steps.do(`${name}-admitted-${round}`, async () => {
      // Persist expiry as data. Workflow error transport need not preserve a
      // custom Error prototype, and a missed slot is not a failed page read.
      if (!permit.until || now() > permit.until) return { expired: true as const };
      try { return { expired: false as const, value: await run(permit.token || token) }; }
      catch (error) {
        if (error instanceof BrowserAdmissionDeferred) return { expired: true as const };
        throw error;
      }
    }, false);
    if (!queuedCapacity) misses++;
    // The slot can expire between the Workflow guard and the browser callback.
    // Rebook here; do not turn queue contention into a new research job.
    if (!result.expired && !(result.value && typeof result.value === 'object' && 'deferred' in result.value && result.value.deferred === true)) return result.value;
  }
  throw new BrowserAdmissionDeferred();
}
