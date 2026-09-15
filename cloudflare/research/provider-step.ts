import type { ResearchProvider } from '../../src/domain/research-provider-queue';
import { BrowserAdmissionDeferred } from '../../src/domain/research-provider-error';
import type { ResearchSteps } from '../../src/domain/research-runner';
export type Admission = { granted: boolean; retryAfterMs: number; after?: number; until?: number; token?: string };

// Admission and waiting are separate checkpoints. On replay, a finished work
// step returns its saved result without acquiring another slot or reading again.
export async function providerStep<T>(steps: ResearchSteps, name: string, provider: ResearchProvider, reserve: (token: string) => Promise<Admission>, run: (token: string) => Promise<T>, now = Date.now): Promise<T> {
  for (let round = 0; round < 3; round++) {
    const token = `${name}-${round}`;
    const permit = await steps.do(`admit-${token}`, () => reserve(token));
    const wait = permit.granted ? Math.max(0, (permit.after || 0) - now()) : permit.retryAfterMs;
    if (wait) await steps.sleep(`wait-${token}`, wait);
    if (!permit.granted) continue;
    const result = await steps.do(`${name}-admitted-${round}`, async () => {
      // Persist expiry as data. Workflow error transport need not preserve a
      // custom Error prototype, and a missed slot is not a failed page read.
      if (!permit.until || now() > permit.until) return { expired: true as const };
      return { expired: false as const, value: await run(permit.token || token) };
    }, false);
    if (!result.expired) return result.value;
  }
  throw new BrowserAdmissionDeferred();
}
