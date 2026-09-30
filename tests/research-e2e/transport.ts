/** Test-only transport around the real worker, with a closed outbound allowlist. */
export type FixtureEnv = { E2E_FIXTURE_ORIGIN: string; APP_ORIGIN: string; E2E_READER_ORIGIN?: string };
const localOrigin = (value: string) => {
 const url = new URL(value);
 if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', 'host.docker.internal'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('E2E requires local origins');
 return url.origin;
};
type CallbackEvent = { jobId: string; phase: string; action?: string; httpStatus?: number; revision?: number; pages?: number; modelCalls?: number; status?: string; timingCount?: number; acceptedTimingCount?: number; acceptedTimingIds?: string[]; pageFindingCount?: number; timingFailure?: boolean };
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function createFixtureFetch(env: FixtureEnv, nativeFetch: typeof fetch): typeof fetch {
 const fixture = localOrigin(env.E2E_FIXTURE_ORIGIN), app = localOrigin(env.APP_ORIGIN), reader = env.E2E_READER_ORIGIN ? localOrigin(env.E2E_READER_ORIGIN) : undefined;
 const blocked = async () => {
  // Record only that a destination was rejected, never the URL or credentials.
  await nativeFetch(`${fixture}/__events`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({event:'outbound_blocked'}), redirect:'manual' }).catch(() => {});
  throw new Error('E2E outbound destination blocked');
 };
 const checked = async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await nativeFetch(input, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('E2E redirect blocked'); }
  return response;
 };
 const record = async (event: CallbackEvent) => {
  const response = await checked(`${fixture}/__events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
  if (!response.ok) throw new Error('E2E event recording failed');
  return object(await response.json());
 };
 return async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.username || url.password) return blocked();
  if (url.href === 'https://openrouter.ai/api/v1/chat/completions') {
   const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined)); headers.delete('authorization');
   return checked(`${fixture}/openrouter`, { ...(input instanceof Request ? {method:input.method,body:await input.text()} : {}), ...init, headers });
  }
  if (url.origin === 'http://127.0.0.1:18083' && url.pathname === '/crawl' && !url.search && reader) return checked(`${reader}/crawl`, init);
  if (url.origin === fixture || (reader && url.origin === reader && url.pathname === '/crawl')) return checked(input, init);
  const callback = url.origin === app && url.pathname.match(/^\/api\/research\/internal\/([a-f0-9-]{36})(?:\/(timings))?$/i);
  if (!callback) return blocked();
  let body: Record<string, unknown> = {};
  try { body = object(typeof init?.body === 'string' ? JSON.parse(init.body) : input instanceof Request ? await input.clone().json() : {}); } catch { /* No content recorded for non-JSON control requests. */ }
  const event: CallbackEvent = { jobId: callback[1], phase: 'before', action: callback[2] || (typeof body.action === 'string' ? body.action : typeof body.revision === 'number' ? 'progress' : 'control') };
  for (const key of ['revision','pages','modelCalls'] as const) if (typeof body[key] === 'number') event[key] = body[key];
  if (typeof body.status === 'string') event.status = body.status;
  if (Array.isArray(body.timingSpans)) event.timingCount = body.timingSpans.length;
  if (Array.isArray(body.spans)) event.timingCount = body.spans.length;
  const findings = object(body.page).findings;
  if (Array.isArray(findings)) event.pageFindingCount = findings.length;
  const flagsBefore = callback[2] === 'timings' || (event.action === 'progress' && event.timingCount) ? await record(event) : {};
  if (flagsBefore.timingFailure) {
   event.timingFailure = true;
   if (callback[2] === 'timings') return Response.json({error:'Injected telemetry delivery failure'}, {status:503});
   // Lose telemetry only. Useful progress still travels to the real application.
   const forwarded = { ...body }; delete forwarded.timingSpans;
   init = { ...init, body:JSON.stringify(forwarded) };
  }
  let response = await checked(input, init);
  if (event.timingFailure && response.ok) {
   const data = object(await response.clone().json());
   response = Response.json({ ...data, timingAcceptedIds:[] }, {status:response.status,headers:response.headers});
  }
  let acknowledgement: Record<string, unknown> = {};
  try { acknowledgement = object(await response.clone().json()); } catch { /* HTTP failures may have no JSON body. */ }
  if (Array.isArray(acknowledgement.timingAcceptedIds)) {
   event.acceptedTimingIds = acknowledgement.timingAcceptedIds.filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id)).slice(0,64);
   event.acceptedTimingCount = event.acceptedTimingIds.length;
  }
  const flags = await record({ ...event, phase:'after', httpStatus:response.status });
  if (flags.dropProgressResponse) throw new Error('Injected lost progress response after successful persistence');
  return response;
 };
}
