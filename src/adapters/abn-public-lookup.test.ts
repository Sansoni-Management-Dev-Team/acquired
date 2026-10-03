import { expect, it, vi } from 'vitest';
import { createPublicAbnClient, createPublicAbnLookup } from './abn-public-lookup';
import { classifyAbnMatches } from '@/domain/abn-public-lookup.mjs';
const candidate = { abn: '70092250596', name: 'CONTRACT MANUFACTURING & PACKAGING SERVICES PTY LTD', nameType: 'Entity Name', location: '2164 NSW', active: true, sourceUrl: 'https://abr.business.gov.au/ABN/View?abn=70092250596' };
const html = '<title>Search results | ABN Lookup</title><table><caption>Matching names</caption><tr><td><a href="/ABN/View?abn=70092250596">70 092 250 596</a> Active</td><td>CONTRACT MANUFACTURING &amp; PACKAGING SERVICES PTY LTD</td><td>Entity Name</td><td>2164 NSW</td></tr><tr><td><a href="/ABN/View?abn=56663118241">56 663 118 241</a> Active</td><td>CONTRACT SERVICES</td><td>Trading Name</td><td>3053 VIC</td></tr></table>';
it('selects the exact AND/& name among unrelated results, retaining all candidates', async () => {
  const lookup = createPublicAbnLookup(async () => new Response(html), { concurrency: 2, spacingMs: 0, timeoutMs: 1000 });
  const result = await lookup('Contract Manufacturing and Packaging Services Pty Ltd');
  expect(result.status).toBe('exact_name_match');
  expect(result.match).toEqual(candidate);
  expect(result.candidates).toHaveLength(2);
});
it('does not select the first of competing matching entities or use fuzzy names', () => {
  expect(classifyAbnMatches(candidate.name, [candidate, { ...candidate, abn: '56663118241' }]).match).toBeNull();
  expect(classifyAbnMatches(candidate.name, [candidate, { ...candidate, nameType: 'Trading Name' }]).match).toEqual(candidate);
  expect(classifyAbnMatches('Contract Services', [candidate]).match).toBeNull();
});
it('bounds overlapping requests and coalesces duplicate concurrent queries', async () => {
  let active = 0, peak = 0, calls = 0;
  const lookup = createPublicAbnLookup(async () => {
    active++; calls++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return new Response(html);
  }, { concurrency: 2, spacingMs: 0, timeoutMs: 1000 });
  await Promise.all(['One', 'Two', 'Three', 'Four', 'One'].map(lookup));
  expect(calls).toBe(4);
  expect(peak).toBe(2);
});
it('reports provider errors and releases capacity for the next lookup', async () => {
  let calls = 0;
  const lookup = createPublicAbnLookup(async () => ++calls === 1 ? new Response('unavailable', { status: 503 }) : new Response(html), { concurrency: 1, spacingMs: 0, timeoutMs: 1000 });
  const results = await Promise.allSettled([lookup('First'), lookup(candidate.name)]);
  expect(results[0].status).toBe('rejected');
  expect(results[1].status).toBe('fulfilled');
});
it('pauses queued starts after an HTTP 429 instead of retrying a burst', async () => {
  vi.useFakeTimers();
  try {
    let calls = 0;
    const lookup = createPublicAbnLookup(async () => ++calls === 1 ? new Response('busy', { status: 429, headers: { 'retry-after': '40' } }) : new Response(html), { concurrency: 1, spacingMs: 0, timeoutMs: 1000 });
    const results = Promise.allSettled([lookup('First'), lookup(candidate.name)]);
    await vi.advanceTimersByTimeAsync(39999);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    expect((await results)[0].status).toBe('rejected');
  } finally { vi.useRealTimers(); }
});

it('shares request capacity and deduplication across search and official detail reads',async()=>{
 let active=0,peak=0,calls=0;const detail='<title>Current details for ABN 70 092 250 596 | ABN Lookup</title><table><tr><th>Entity name:</th><td>CONTRACT MANUFACTURING &amp; PACKAGING SERVICES PTY LTD</td></tr><tr><th>ABN status:</th><td>Active from 1999</td></tr></table>';
 const client=createPublicAbnClient(async url=>{calls++;peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,10));active--;return new Response(String(url).includes('/ABN/View')?detail:html);},{concurrency:2,spacingMs:0,timeoutMs:1000});
 await Promise.all([client.search('One'),client.record(candidate.abn),client.search('Two'),client.record(candidate.abn),client.search('Three')]);expect(calls).toBe(4);expect(peak).toBe(2);
});
it('does not make a registry request after a caller deadline',async()=>{const fetcher=vi.fn(async()=>new Response(html));const client=createPublicAbnClient(fetcher,{concurrency:2,spacingMs:0,timeoutMs:1000});await expect(client.search('One',0)).rejects.toThrow('deadline');expect(fetcher).not.toHaveBeenCalled();});
