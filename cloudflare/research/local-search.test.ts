import { expect, it, vi } from "vitest";
import { localSearch, localSearchEndpoint, normaliseLocalSearch } from "./local-search";
it("only runs against the loopback OpenSERP container in local development", () => {
  expect(localSearchEndpoint({ LOCAL_DEVELOPMENT: "true", LOCAL_SEARCH_URL: "http://127.0.0.1:7000" })).toBe("http://127.0.0.1:7000/duckduckgo/search");
  expect(localSearchEndpoint({ LOCAL_DEVELOPMENT: "false", LOCAL_SEARCH_URL: "http://127.0.0.1:7000" })).toBeNull();
  expect(localSearchEndpoint({ LOCAL_DEVELOPMENT: "true" })).toBeNull();
  expect(() => localSearchEndpoint({ LOCAL_DEVELOPMENT: "true", LOCAL_SEARCH_URL: "https://search.example.com" })).toThrow();
});
it("normalises results, keeps snippets verbatim and drops redirect wrappers and duplicates", () => {
  const results = normaliseLocalSearch({ results: [
    { title: "Example  Co", url: "https://profiles.example.net/company/example-co", snippet: "Example Co employs  40 employees." },
    { title: "Wrapped", url: "https://www.google.com/goto?url=abc", snippet: "hidden" },
    { title: "Dup", url: "https://profiles.example.net/company/example-co/", snippet: "again" },
    { title: "Private", url: "http://10.0.0.1/x", snippet: "no" },
  ] });
  expect(results).toEqual([{ url: "https://profiles.example.net/company/example-co", title: "Example Co", snippet: "Example Co employs 40 employees." }]);
});

it('correlates every bounded search-engine attempt with the safe research trace without forwarding diagnostic headers',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{}),trace={mandateId:'mandate-12345',runId:'run-12345',jobId:'job-12345',operationId:'operation-12345',requestId:'request-12345',logicalCallId:'call-12345'},env={LOCAL_DEVELOPMENT:'true',LOCAL_SEARCH_URL:'http://127.0.0.1:7000'},fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({error:'PRIVATE error contents'},{status:503})).mockResolvedValueOnce(Response.json([{url:'https://example.com',title:'PRIVATE result title',snippet:'PRIVATE result content'}]));
 try{await localSearch(env,'PRIVATE search query',{...trace,start:10},fetcher);expect(fetcher.mock.calls.map(([url])=>new URL(String(url)).pathname)).toEqual(['/duckduckgo/search','/google/search']);expect(fetcher.mock.calls.every(([url,init])=>new URL(String(url)).searchParams.get('start')==='10'&&init?.headers===undefined)).toBe(true);const events=log.mock.calls.filter(([tag])=>tag==='research-provider').map(([,body])=>JSON.parse(String(body)));expect(events).toHaveLength(4);for(const event of events)expect(event).toMatchObject({...trace,provider:'local-openserp'});expect(events.map(event=>event.operation)).toEqual(['web_search_duckduckgo','web_search_duckduckgo','web_search_google','web_search_google']);
 log.mockClear();const safe=vi.fn<typeof fetch>(async()=>Response.json([{url:'https://example.com',title:'PRIVATE response'}]));await localSearch(env,'PRIVATE search query',{mandateId:'private@example.invalid',runId:'PRIVATE_RUN\nvalue',operationId:'PRIVATE_OPERATION?secret',requestId:'request-12345',engine:'google'},safe);const unsafeEvents=log.mock.calls.filter(([tag])=>tag==='research-provider').map(([,body])=>JSON.parse(String(body)));for(const event of unsafeEvents){expect(event).not.toHaveProperty('mandateId');expect(event).not.toHaveProperty('runId');expect(event).not.toHaveProperty('operationId');}expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|private@example/);expect(new URL(String(safe.mock.calls[0][0])).pathname).toBe('/google/search');expect(safe).toHaveBeenCalledOnce();
 }finally{log.mockRestore();}
});
