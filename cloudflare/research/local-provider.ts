import { BrowserAdmissionDeferred } from '../../src/domain/research-provider-error';
import type { Admission } from './provider-step';

type Callback = (body: { action: string; token: string; provider?: 'page' | 'search' }) => Promise<unknown>;

// Workflow callers have already waited durably. Direct search/fallback callers
// use the same queue, with a short bounded wait instead of bypassing admission.
export async function withLocalProvider<T>(provider: 'page' | 'search', token: string | undefined, callback: Callback, run: () => Promise<T>): Promise<T> {
  const reservedToken = token || crypto.randomUUID();
  try {
    if (!token) {
      const permit = await callback({ action: 'provider-reserve', provider, token: reservedToken }) as Admission;
      if (!permit.granted || permit.retryAfterMs > 35000) throw new BrowserAdmissionDeferred();
      if (permit.retryAfterMs > 0) await new Promise(resolve => setTimeout(resolve, permit.retryAfterMs));
    }
    const permit = await callback({ action: 'browser-permit', token: reservedToken }) as Admission;
    if (!permit.granted) throw new BrowserAdmissionDeferred();
    return await run();
  } finally {
    // A failed release cannot replace the actual read result. The bounded lease
    // also recovers capacity if the worker dies before this callback completes.
    await callback({ action: 'provider-release', token: reservedToken }).catch(() => {});
  }
}
