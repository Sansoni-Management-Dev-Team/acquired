import { expect, it, vi } from "vitest";
import { localRead, localReaderEndpoint } from "./local-reader";
const env = { LOCAL_DEVELOPMENT: "true", LOCAL_CRAWL4AI_URL: "http://127.0.0.1:18083" };
it("reads through loopback Crawl4AI with the common page contract and no cloud credentials", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ url: "https://example.com/", markdown: "Example business" }));
  expect(await localRead(env, "https://example.com/", { jobId: "test-job" }, fetcher)).toEqual({ status: "completed", page: { url: "https://example.com/", markdown: "Example business" } });
  expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:18083/crawl");
  expect(fetcher.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
});
it("requires explicit local mode and only the fixed loopback endpoint", () => {
  expect(() => localReaderEndpoint({})).toThrow(/local development/);
  for (const endpoint of ["https://remote.example.com", "http://127.0.0.1:9999", "http://user:secret@127.0.0.1:18083", "http://127.0.0.1:18083/other"]) expect(() => localReaderEndpoint({ ...env, LOCAL_CRAWL4AI_URL: endpoint })).toThrow();
});
it("retains search query parameters but rejects private targets and never retries remotely", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "Reader offline" }, { status: 502 }));
  await expect(localRead(env, "https://html.duckduckgo.com/html/?q=example", {}, fetcher)).rejects.toThrow(/502/);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).url).toContain("?q=example");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(localRead(env, "http://localhost/private", {}, fetcher)).rejects.toThrow(/Unsupported/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('retains the actual reader failure and forwards the same safe correlation IDs',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({error:'private body',category:'dns_resolution_failed'},{status:503}));
 await expect(localRead(env,'https://example.com',{jobId:'job-12345678',requestId:'request-12345678'},fetcher)).rejects.toMatchObject({status:503,category:'dns_resolution_failed'});
 expect(fetcher.mock.calls[0][1].headers).toMatchObject({'x-request-id':'request-12345678','x-research-job-id':'job-12345678'});
 expect(fetcher).toHaveBeenCalledOnce();
});
it('correlates reader logs with the complete safe research trace without expanding the reader header contract',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{}),fetcher=vi.fn<typeof fetch>(async()=>Response.json({url:'https://example.com/',markdown:'PRIVATE page contents'})),trace={mandateId:'mandate-12345',runId:'run-12345',jobId:'job-12345',operationId:'operation-12345',requestId:'request-12345',logicalCallId:'call-12345'};
 try{await localRead(env,'https://example.com/?q=PRIVATE_SEARCH',{...trace,operation:'company_profile_read'},fetcher);const events=log.mock.calls.filter(([tag])=>tag==='research-provider').map(([,body])=>JSON.parse(String(body)));expect(events).toHaveLength(2);for(const event of events)expect(event).toMatchObject({...trace,provider:'local-crawl4ai',operation:'company_profile_read'});const headers=new Headers(fetcher.mock.calls[0][1]?.headers);expect(headers.get('x-request-id')).toBe(trace.requestId);expect(headers.get('x-research-job-id')).toBe(trace.jobId);for(const key of ['x-acquire-mandate-id','x-acquire-research-run','x-acquire-agent-operation','x-acquire-native-research-job'])expect(headers.has(key)).toBe(false);
 log.mockClear();await localRead(env,'https://example.com/?q=PRIVATE_SEARCH',{mandateId:'private@example.invalid',runId:'PRIVATE_RUN\nvalue',operationId:'PRIVATE_OPERATION?secret',jobId:'job-12345',requestId:'request-12345'},fetcher);const unsafeEvents=log.mock.calls.filter(([tag])=>tag==='research-provider').map(([,body])=>JSON.parse(String(body)));for(const event of unsafeEvents){expect(event).not.toHaveProperty('mandateId');expect(event).not.toHaveProperty('runId');expect(event).not.toHaveProperty('operationId');}expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|private@example/);expect(fetcher).toHaveBeenCalledTimes(2);
 }finally{log.mockRestore();}
});
