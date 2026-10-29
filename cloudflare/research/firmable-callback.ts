import {FirmableCooldown} from '../../src/domain/research-provider-error';
export class FirmableCallbackError extends Error {
  constructor(public diagnostic: { origin: 'application-callback'; action: string; status: number; requestId?: string; durationMs: number; errorCode?: string }) {
    super(`Firmable application callback ${diagnostic.action} failed (${diagnostic.status}); request ${diagnostic.requestId || 'unknown'}; ${diagnostic.durationMs}ms${diagnostic.errorCode ? `; ${diagnostic.errorCode}` : ''}`);
  }
}
/** Never log raw bodies or profile values: only machine error codes and request IDs. */
export async function checkFirmableCallback(response: Response, action: string, startedAt: number) {
  if (response.ok) return;
  if(response.status===429){
    const body=await response.clone().json().catch(()=>null) as {provider?:string;category?:string;retryAfterMs?:number}|null;
    if(body?.provider==='firmable'&&body.category==='rate_limited'&&typeof body.retryAfterMs==='number'&&Number.isFinite(body.retryAfterMs)&&body.retryAfterMs>=1000)throw new FirmableCooldown(body.retryAfterMs);
  }
  let errorCode: string | undefined;
  try {
    const body = await response.clone().json() as { code?: unknown };
    if (typeof body.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(body.code)) errorCode = body.code;
  } catch { /* Proxy errors may be HTML. */ }
  const rawId = response.headers.get('x-vercel-id') || response.headers.get('x-request-id');
  const requestId = rawId && /^[\w:.-]{1,160}$/.test(rawId) ? rawId : undefined;
  const diagnostic = { origin: 'application-callback' as const, action, status: response.status, requestId, durationMs: Math.max(0, Date.now() - startedAt), errorCode };
  console.error('firmable_callback_failure', diagnostic);
  throw new FirmableCallbackError(diagnostic);
}
