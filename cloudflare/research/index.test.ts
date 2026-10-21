import { expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ WorkflowEntrypoint: class {}, DurableObject: class {} }));
import worker from './index';
it('does not accept the diagnostic credential for other service routes', async () => {
  const env = { SERVICE_SECRET: 'service', FIRMABLE_VALIDATION_SECRET: 'diagnostic' } as Parameters<typeof worker.fetch>[1];
  const headers = { authorization: 'Bearer diagnostic' };
  const probe = await worker.fetch(new Request('https://worker.example.com/firmable/validate', { method: 'POST', headers }), env);
  expect(probe.status).toBe(503);
  const other = await worker.fetch(new Request('https://worker.example.com/search', { method: 'POST', headers }), env);
  expect(other.status).toBe(401);
});
it('requires service authentication for Firmable diagnostics', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const response = await worker.fetch(new Request('https://worker.example.com/firmable/validate', { method: 'POST' }), { SERVICE_SECRET: 'test' } as Parameters<typeof worker.fetch>[1]);
  expect(response.status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockRestore();
});
it.each([{ page: 2 }, { engine: 'google' }])('explicitly rejects unsupported production search %j without a provider call', async parameters => {
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const request = new Request('https://worker.example.com/search', { method: 'POST', headers: { authorization: 'Bearer test' }, body: JSON.stringify({ query: 'calibration Australia', ...parameters }) });
  const response = await worker.fetch(request, { SERVICE_SECRET: 'test' } as Parameters<typeof worker.fetch>[1]);
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ category: 'unsupported_search' });
  expect(fetcher).not.toHaveBeenCalled();
  fetcher.mockRestore();
});
it('scopes the Firmable service credential and delegates only supported methods', async () => {
  const firmable = vi.fn(async () => ({ status: 200, body: { configured: true } }));
  const env = { SERVICE_SECRET: 'research', FIRMABLE_SERVICE_SECRET: 'firmable', PROVIDER_COORDINATOR: { idFromName: vi.fn(() => 'account'), get: vi.fn(() => ({ firmable })) } } as unknown as Parameters<typeof worker.fetch>[1];
  const headers = { authorization: 'Bearer firmable' };
  expect((await worker.fetch(new Request('https://worker.example/firmable/status', { headers }), env)).status).toBe(200);
  expect(firmable).toHaveBeenCalledOnce();
  expect((await worker.fetch(new Request('https://worker.example/search', { method: 'POST', headers }), env)).status).toBe(401);
  expect((await worker.fetch(new Request('https://worker.example/firmable/reconnect', { headers }), env)).status).toBe(405);
});
it('passes explicit diagnostic correlation separately from native research authority',async()=>{
 const firmable=vi.fn(async(input:unknown)=>{void input;return {status:200,body:{id:'f123'}};});
 const env={FIRMABLE_SERVICE_SECRET:'service',PROVIDER_COORDINATOR:{idFromName:()=> 'account',get:()=>({firmable})}} as unknown as Parameters<typeof worker.fetch>[1];
 const result=await worker.fetch(new Request('https://worker.example/firmable/company?id=f123',{headers:{authorization:'Bearer service','x-acquire-research-job':'job-123','x-request-id':'request-123','x-acquire-research-call':'call-123'}}),env);
 expect(result.status).toBe(200);expect(firmable.mock.calls[0][0]).toMatchObject({traceContext:{jobId:'job-123',requestId:'request-123',logicalCallId:'call-123'}});expect(firmable.mock.calls[0][0]).not.toHaveProperty('nativeResearch');
});
