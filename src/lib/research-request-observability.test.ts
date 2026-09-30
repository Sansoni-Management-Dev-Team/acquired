import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/db/research-timing-repository', () => ({ saveResearchTimingSpans: mocks.save }));
import { measureResearchSegment } from './research-segment-timing';
import { observeResearchRequest, configureResearchTelemetry, observeResearchDatabase, researchRequestJson, researchJsonResponse } from './research-request-observability';
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });
it('batches server spans per request and correlates safe response timings', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const response = await observeResearchRequest(new Request('https://example.com/?private=buyer', { headers: { 'x-request-id': 'request-1234' } }), async () => {
    configureResearchTelemetry(true);
    await measureResearchSegment('job-1', 'org-1', 'first', 'coordination', async () => 1);
    await measureResearchSegment('job-1', 'org-1', 'second', 'persistence', async () => 2);
    expect(mocks.save).not.toHaveBeenCalled();
    return Response.json({ ok: true });
  });
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0][2]).toHaveLength(2);
  expect(response.headers.get('x-request-id')).toBe('request-1234');
  expect(response.headers.get('server-timing')).toMatch(/app;dur=\d/);
  expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});
it('records database execution rather than builder creation, including failed statements', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const builder = { where: () => builder, then: (yes: (value: unknown) => void, no: (error: Error) => void) => Promise.reject(new Error('private SQL')).then(yes, no) };
  const db = observeResearchDatabase({ select: () => ({ from: () => builder }) });
  const response = await observeResearchRequest(new Request('https://example.com'), async () => {
    const query = db.select().from().where();
    expect(log).not.toHaveBeenCalled();
    await expect(query).rejects.toThrow('private SQL');
    return Response.json({ ok: true });
  });
  expect(response.headers.get('server-timing')).toMatch(/db;dur=/);
  expect(log.mock.calls.some(([tag, body]) => tag === 'research-db' && JSON.parse(body).outcome === 'failed')).toBe(true);
  expect(JSON.stringify(log.mock.calls)).not.toContain('private SQL');
});
it('keeps useful progress successful when batched telemetry fails', async () => {
  mocks.save.mockRejectedValueOnce(new Error('offline'));
  const response = await observeResearchRequest(new Request('https://example.com'), async () => {
    configureResearchTelemetry(true);
    await measureResearchSegment('job-1', 'org-1', 'save', 'persistence', async () => true);
    return Response.json({ ok: true });
  });
  expect(response.status).toBe(200);
});
it('isolates concurrent request buffers', async () => {
  await Promise.all(['job-a', 'job-b'].map(job => observeResearchRequest(new Request('https://example.com'), async () => {
    configureResearchTelemetry(true);
    await measureResearchSegment(job, 'org', 'save', 'persistence', async () => Promise.resolve());
    return Response.json({ ok: true });
  })));
  expect(mocks.save).toHaveBeenCalledTimes(2);
  for (const [, , spans] of mocks.save.mock.calls) expect(spans).toHaveLength(1);
});

it('flushes accumulated spans when a handler fails without hiding the failure', async () => {
 await expect(observeResearchRequest(new Request('https://example.com'), async () => {
  configureResearchTelemetry(true);
  await measureResearchSegment('job-a', 'org', 'save', 'persistence', async () => true);
  throw new Error('handler failed');
 })).rejects.toThrow('handler failed');
 expect(mocks.save).toHaveBeenCalledTimes(1);
});
it('counts returned rows for an egress baseline without logging record contents', async () => {
 const log = vi.spyOn(console, 'info').mockImplementation(() => {});
 const db = observeResearchDatabase({ execute: async () => ({ rows: [{ secret: 'private-row' }, { secret: 'private-row' }] }) });
 await observeResearchRequest(new Request('https://example.com'), async () => {
  await db.execute();
  return Response.json({ ok: true });
 });
 const query = log.mock.calls.find(([tag]) => tag === 'research-db');
 expect(JSON.parse(query![1]).rowsReturned).toBe(2);
 const request = log.mock.calls.find(([tag]) => tag === 'research-request');
 expect(JSON.parse(request![1]).databaseRowsReturned).toBe(2);
 expect(JSON.stringify(log.mock.calls)).not.toContain('private-row');
});

it('measures consumed callback UTF-8 bytes once without logging content or writing telemetry', async () => {
 const log = vi.spyOn(console, 'info').mockImplementation(() => {});
 const body = JSON.stringify({ action: 'progress', message: 'private café 🦘' });
 const request = new Request('https://example.com/api/research/internal/job-12345', { method: 'POST', body, headers: { 'content-length': '1' } });
 const data = { ok: true, message: 'private café 🦘' };
 const response = await observeResearchRequest(request, async () => {
  expect(await researchRequestJson(request)).toEqual(JSON.parse(body));
  return researchJsonResponse(data, { status: 202, headers: { 'cache-control': 'no-store' } });
 });
 expect(await response.json()).toEqual(data);
 expect(response.status).toBe(202);
 expect(response.headers.get('cache-control')).toBe('no-store');
 expect(response.headers.get('content-type')).toBe('application/json');
 expect(response.headers.get('x-research-request-body-bytes')).toBe(String(Buffer.byteLength(body)));
 expect(response.headers.get('x-research-response-body-bytes')).toBe(String(Buffer.byteLength(JSON.stringify(data))));
 const metrics = JSON.parse(log.mock.calls.find(([tag]) => tag === 'research-request')![1]);
 expect(metrics).toMatchObject({ requestBodyBytes: Buffer.byteLength(body), responseBodyBytes: Buffer.byteLength(JSON.stringify(data)), bodyByteMeasurement: 'application_utf8_body', databaseCalls: 0 });
 expect(mocks.save).not.toHaveBeenCalled();
 expect(JSON.stringify(log.mock.calls)).not.toContain('private café');
});

it('counts malformed JSON consumed by a callback and does not claim bytes for an unread body', async () => {
 const log = vi.spyOn(console, 'info').mockImplementation(() => {});
 const malformed = new Request('https://example.com', { method: 'POST', body: 'private invalid 🦘' });
 const response = await observeResearchRequest(malformed, async () => {
  await expect(researchRequestJson(malformed)).rejects.toThrow();
  return researchJsonResponse({ error: 'Invalid JSON' }, { status: 400 });
 });
 expect(response.headers.get('x-research-request-body-bytes')).toBe(String(Buffer.byteLength('private invalid 🦘')));
 const denied = await observeResearchRequest(new Request('https://example.com', { method: 'POST', body: 'private' }), async () => researchJsonResponse({ error: 'Not available' }, { status: 403 }));
 expect(denied.headers.has('x-research-request-body-bytes')).toBe(false);
 expect(JSON.parse(log.mock.calls.filter(([tag]) => tag === 'research-request').at(-1)![1])).toMatchObject({ requestBodyBytes: null, requestBodyMeasurement: 'not_consumed' });
 expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});

it('records zero bytes for a bodyless request and leaves uninstrumented or streaming responses untouched', async () => {
 const response = await observeResearchRequest(new Request('https://example.com'), async () => new Response('streamed'));
 expect(response.headers.get('x-research-request-body-bytes')).toBe('0');
 expect(response.headers.has('x-research-response-body-bytes')).toBe(false);
 expect(await response.text()).toBe('streamed');
});

it('attributes concurrent stages independently and reports request byte totals without row contents', async () => {
 const { withResearchDatabaseContext, setResearchDatabaseContext } = await import('./research-request-observability');
 const log = vi.spyOn(console, 'info').mockImplementation(() => {});
 const rows = [{config:{private:'£🚀'}}];
 const db = observeResearchDatabase({ execute: async () => { await Promise.resolve(); return {rows}; } });
 const response = await observeResearchRequest(new Request('https://example.com/api/research/internal/job-1?secret=hidden'), async () => {
  setResearchDatabaseContext({organizationId:'org',runId:'root'});
  await Promise.all(['coordination','persistence'].map(stage => withResearchDatabaseContext({stage}, () => db.execute())));
  return Response.json({ok:true});
 });
 const expected = Buffer.byteLength(JSON.stringify(rows));
 expect(response.headers.get('x-research-db-result-json-bytes')).toBe(String(expected * 2));
 const queries = log.mock.calls.filter(([tag])=>tag==='research-db').map(([,body])=>JSON.parse(body));
 expect(queries.map(query=>query.stage).sort()).toEqual(['coordination','persistence']);
 expect(queries.every(query=>query.jobId==='job-1' && query.runId==='root' && query.resultJsonBytes===expected)).toBe(true);
 expect(JSON.stringify(log.mock.calls)).not.toContain('hidden');
 expect(JSON.stringify(log.mock.calls)).not.toContain('£🚀');
});
it('instruments transaction queries and retains query fingerprints for real Drizzle execution', async () => {
 const { drizzle } = await import('drizzle-orm/node-postgres');
 const { researchJobs } = await import('@/db/schema');
 const { sql } = await import('drizzle-orm');
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 const client={query:vi.fn().mockResolvedValue({rows:[['job']]})};
 const database=observeResearchDatabase(drizzle({client:client as never}));
 await observeResearchRequest(new Request('https://example.com'),async()=>{
  await database.select({id:researchJobs.id}).from(researchJobs).limit(1);
  const tx=observeResearchDatabase({transaction:async(callback:(db:{execute:()=>Promise<unknown>})=>unknown)=>callback({execute:async()=>({rows:[]})})});
  await tx.transaction(db=>db.execute());
  await database.execute(sql`select id from research_jobs`);
  return Response.json({ok:true});
 });
 const queries=log.mock.calls.filter(([tag])=>tag==='research-db').map(([,body])=>JSON.parse(body));
 expect(queries).toHaveLength(3);
 expect(queries[0]).toMatchObject({tables:['research_jobs'],queryFingerprint:expect.any(String)});
 expect(queries[2]).toMatchObject({tables:['research_jobs'],queryFingerprint:expect.any(String)});
});
it('reports unavailable byte measurements without failing successful queries',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 const db=observeResearchDatabase({execute:async()=>({rows:[{value:BigInt(1)}]})});
 await observeResearchRequest(new Request('https://example.com'),async()=>{await db.execute();return Response.json({ok:true});});
 const request=log.mock.calls.find(([tag])=>tag==='research-request');
 expect(JSON.parse(request![1])).toMatchObject({databaseByteMeasurementsUnavailable:1,databaseResultJsonBytes:0});
});
