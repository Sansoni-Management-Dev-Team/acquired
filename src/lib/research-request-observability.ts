import { researchQueryIdentity, researchResultMetrics } from './research-egress-metrics';
import { AsyncLocalStorage } from 'node:async_hooks';
import { saveResearchTimingSpans } from '@/db/research-timing-repository';
import type { ResearchTimingSpan } from '@/domain/research-timing';

type Batch = { jobId: string; organizationId: string; spans: Map<string, ResearchTimingSpan> };
export type ResearchDatabaseContext = { jobId?: string; organizationId?: string; mandateId?: string; runId?: string; stage?: string; action?: string; route?: string };
const contexts = new AsyncLocalStorage<ResearchDatabaseContext>();
export function withResearchDatabaseContext<T>(context: ResearchDatabaseContext, run: () => T): T { return contexts.run({ ...scopes.getStore()?.context, ...contexts.getStore(), ...context }, run); }
export function setResearchDatabaseContext(context: ResearchDatabaseContext) { const scope = scopes.getStore(); if (scope) Object.assign(scope.context, context); }
export function researchDatabaseContext() { return { ...scopes.getStore()?.context, ...contexts.getStore() }; }
function requestContext(request: Request): ResearchDatabaseContext {
  const path = new URL(request.url).pathname;
  const match = /^\/api\/(research|firmable)\/internal\/([a-zA-Z0-9_-]{1,100})(?:\/|$)/.exec(path);
  if (match) return { route: `/api/${match[1]}/internal/:id`, ...(match[1] === "research" ? { jobId: match[2] } : { runId: match[2] }), action: request.method === "GET" ? "control" : "callback" };
  const mandate = /^\/api\/mandates\/([a-zA-Z0-9_-]{1,100})\/(companies|research)(?:\/|$)/.exec(path);
  return mandate ? { route: `/api/mandates/:id/${mandate[2]}`, mandateId: mandate[1], action: request.method === "GET" ? "poll" : "start-or-recover" } : {};
}
type Scope = { requestBodyBytes: number | null; context: ResearchDatabaseContext; databaseResultJsonBytes: number; databaseByteMeasurementsUnavailable: number; requestId: string; started: number; batching: boolean; batches: Map<string, Batch>; databaseMs: number; databaseCalls: number; databaseRowsReturned: number };
const scopes = new AsyncLocalStorage<Scope>();
const responseBodySizes = new WeakMap<Response, number>();

/** Count the body already consumed by the handler. Do not clone/read it again. */
export async function researchRequestJson(request: Request): Promise<Awaited<ReturnType<Request["json"]>>> {
  const body = await request.arrayBuffer();
  const scope = scopes.getStore();
  if (scope) scope.requestBodyBytes = body.byteLength;
  return JSON.parse(new TextDecoder().decode(body));
}

/** Serialize once; measurements never include payload contents or protocol bytes. */
export function researchJsonResponse(data: unknown, init?: ResponseInit): Response {
  const body = JSON.stringify(data);
  if (body === undefined) throw new TypeError('Value cannot be serialized as JSON');
  const headers = new Headers(init?.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = new Response(body, { ...init, headers });
  responseBodySizes.set(response, Buffer.byteLength(body, 'utf8'));
  return response;
}
const safeRequestId = (value: string | null) => value && /^[a-zA-Z0-9_-]{8,100}$/.test(value) ? value : crypto.randomUUID();
export function configureResearchTelemetry(enabled: boolean) { const scope = scopes.getStore(); if (scope) scope.batching = enabled; }
export function researchRequestId() { return scopes.getStore()?.requestId; }
export function bufferResearchTiming(jobId: string, organizationId: string, spans: ResearchTimingSpan[]) {
  const scope = scopes.getStore();
  if (!scope?.batching) return false;
  const key = `${organizationId}:${jobId}`;
  const batch = scope.batches.get(key) || { jobId, organizationId, spans: new Map<string, ResearchTimingSpan>() };
  for (const span of spans) if (batch.spans.size < 2048 || batch.spans.has(span.id)) batch.spans.set(span.id, span);
  scope.batches.set(key, batch);
  return true;
}
export async function flushResearchTiming(): Promise<string[]> {
  const scope = scopes.getStore();
  if (!scope?.batches.size) return [];
  const accepted: string[] = [];
  for (const [key, batch] of scope.batches) {
    const spans = [...batch.spans.values()];
    try {
      await withResearchDatabaseContext({ jobId: batch.jobId, organizationId: batch.organizationId, stage: "telemetry", action: "flush-timings" }, () => saveResearchTimingSpans(batch.jobId, batch.organizationId, spans));
      accepted.push(...spans.map(span => span.id)); scope.batches.delete(key);
    } catch {
      console.info('research-pipeline', JSON.stringify({ event: 'timing_delivery_deferred', requestId: scope.requestId, jobId: batch.jobId, pending: spans.length }));
    }
  }
  return accepted;
}
export async function observeResearchOperation<T>(requestId: string, run: () => Promise<T>): Promise<T> {
  const scope: Scope = { requestBodyBytes: null, context: researchDatabaseContext(), databaseResultJsonBytes: 0, databaseByteMeasurementsUnavailable: 0, requestId, started: performance.now(), batching: true, batches: new Map(), databaseMs: 0, databaseCalls: 0, databaseRowsReturned: 0 };
  return scopes.run(scope, async () => {
    try { return await run(); }
    finally {
      await flushResearchTiming();
      console.info('research-request', JSON.stringify({ event: 'operation_finished', timestamp: new Date().toISOString(), ...scope.context, requestId, elapsedMs: performance.now() - scope.started, databaseRoundTripMs: scope.databaseMs, databaseCalls: scope.databaseCalls, databaseRowsReturned: scope.databaseRowsReturned, databaseResultJsonBytes: scope.databaseResultJsonBytes, databaseByteMeasurementsUnavailable: scope.databaseByteMeasurementsUnavailable, byteMeasurement: "utf8_json_returned_rows" }));
    }
  });
}
export async function observeResearchRequest(request: Request, run: () => Promise<Response>): Promise<Response> {
  const scope: Scope = { requestBodyBytes: request.body ? null : 0, context: requestContext(request), databaseResultJsonBytes: 0, databaseByteMeasurementsUnavailable: 0, requestId: safeRequestId(request.headers.get('x-request-id')), started: performance.now(), batching: false, batches: new Map(), databaseMs: 0, databaseCalls: 0, databaseRowsReturned: 0 };
  return scopes.run(scope, async () => {
    let response: Response | undefined;
    try { response = await run(); }
    finally {
      await flushResearchTiming();
      console.info('research-request', JSON.stringify({ event: 'request_finished', timestamp: new Date().toISOString(), ...scope.context, requestId: scope.requestId, elapsedMs: performance.now() - scope.started, databaseRoundTripMs: scope.databaseMs, databaseCalls: scope.databaseCalls, databaseRowsReturned: scope.databaseRowsReturned, databaseResultJsonBytes: scope.databaseResultJsonBytes, databaseByteMeasurementsUnavailable: scope.databaseByteMeasurementsUnavailable, byteMeasurement: "utf8_json_returned_rows", requestBodyBytes: scope.requestBodyBytes, requestBodyMeasurement: scope.requestBodyBytes === null ? 'not_consumed' : 'consumed_body', responseBodyBytes: response ? responseBodySizes.get(response) ?? null : null, bodyByteMeasurement: 'application_utf8_body', httpStatus: response?.status || 500 }));
    }
    response.headers.set('x-request-id', scope.requestId);
    if (scope.requestBodyBytes !== null) response.headers.set('x-research-request-body-bytes', String(scope.requestBodyBytes));
    const responseBytes = responseBodySizes.get(response);
    if (responseBytes !== undefined) response.headers.set('x-research-response-body-bytes', String(responseBytes));
    response.headers.set('server-timing', `app;dur=${(performance.now() - scope.started).toFixed(2)}, db;dur=${scope.databaseMs.toFixed(2)}`);
    response.headers.set('x-research-db-calls', String(scope.databaseCalls));
    response.headers.set('x-research-db-result-json-bytes', String(scope.databaseResultJsonBytes));
    return response;
  });
}

/** Measure awaitable execution, not fluent query construction. Never log SQL or bindings. */
export function observeResearchDatabase<T extends object>(database: T, driver: "postgres" | "neon" | "unknown" = "unknown"): T {
  const measure = async (operation: string, run: () => Promise<unknown>, query?: unknown) => {
    const scope = scopes.getStore();
    if (!scope) return run();
    const start = performance.now(); const context = researchDatabaseContext(); const identity = researchQueryIdentity(query); let outcome = 'succeeded'; let metrics: ReturnType<typeof researchResultMetrics> | undefined;
    try {
      const result = await run();
      metrics = researchResultMetrics(result);
      return result;
    }
    catch (error) { outcome = 'failed'; throw error; }
    finally {
      const elapsedMs = performance.now() - start;
      scope.databaseCalls++; scope.databaseMs += elapsedMs; scope.databaseRowsReturned += metrics?.rowsReturned || 0;
      scope.databaseResultJsonBytes += metrics?.resultJsonBytes || 0;
      if (metrics?.byteMeasurement === "unavailable") scope.databaseByteMeasurementsUnavailable++;
      console.info('research-db', JSON.stringify({ event: 'query_finished', timestamp: new Date().toISOString(), queryId: crypto.randomUUID(), ...context, ...identity, driver, requestId: scope.requestId, operation, elapsedMs, outcome, ...metrics, timingBasis: 'application_database_round_trip' }));
    }
  };
  const chain = (value: unknown, operation: string): unknown => {
    if (!value || typeof value !== 'object') return value;
    return new Proxy(value, {
      get(target, key, receiver) {
        const member = Reflect.get(target, key, receiver);
        if (key === 'then' && typeof member === 'function') return (yes: (v: unknown) => unknown, no: (e: unknown) => unknown) => measure(operation, () => new Promise((resolve, reject) => Reflect.apply(member, target, [resolve, reject])), target).then(yes, no);
        if (typeof member !== 'function') return member;
        return (...args: unknown[]) => {
          if (key === 'execute') return measure(operation, () => Promise.resolve(Reflect.apply(member, target, args)), target);
          const result = Reflect.apply(member, target, args);
          return result && typeof result === 'object' && ['then', 'from', 'set', 'values', 'execute'].some(name => typeof Reflect.get(result, name) === 'function') ? chain(result, operation) : result;
        };
      },
    });
  };
  return new Proxy(database, {
    get(target, key, receiver) {
      const member = Reflect.get(target, key, receiver);
      if (typeof member !== 'function') return member;
      if (['select', 'selectDistinct', 'insert', 'update', 'delete'].includes(String(key))) return (...args: unknown[]) => chain(Reflect.apply(member, target, args), String(key));
      if (key === 'transaction') return (callback: (tx: T) => unknown, ...options: unknown[]) => Reflect.apply(member, target, [(tx: T) => callback(observeResearchDatabase(tx, driver)), ...options]);
      if (key === 'execute') return (...args: unknown[]) => measure('execute', () => Promise.resolve(Reflect.apply(member, target, args)), args[0]);
      return member.bind(target);
    },
  });
}
