import { expect, it, vi } from 'vitest';
import { createPublicAbnClient } from './abn-public-lookup';
import { createAbnIdentityResolver } from './abn-identity-resolver';

const guid = 'test-server-only-guid';
const options = { concurrency: 2, spacingMs: 0, timeoutMs: 1000, guid };
const abn = '51824753556';
const detail = { Message: '', Abn: abn, EntityName: 'AUSTRALIAN TAXATION OFFICE', AbnStatus: 'Active', AbnStatusEffectiveFrom: '1999-11-01', BusinessName: ['ATO'], AddressPostcode: '2640', AddressState: 'NSW' };
const row = { Abn: abn, Name: detail.EntityName, NameType: 'Entity Name', AbnStatus: '0000000001', IsCurrent: true, Postcode: '2640', State: 'NSW', Score: 100 };
const jsonp = (data: unknown) => new Response(`callback(${JSON.stringify(data)});`);
const html = `<title>Current details for ABN 51 824 753 556 | ABN Lookup</title><table><tr><th>Entity name:</th><td>${detail.EntityName}</td></tr><tr><th>ABN status:</th><td>Active from 1999</td></tr></table>`;

it('uses API search and details with canonical evidence URLs and no retained GUID', async () => {
  const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => jsonp(String(url).includes('MatchingNames') ? { Message: '', Names: [row] } : detail));
  const client = createPublicAbnClient(fetcher, options);
  const search = await client.search(detail.EntityName);
  const record = await client.record(abn);
  expect(search.status).toBe('exact_name_match');
  expect(search.registrySource).toBe('web_service');
  expect(record).toMatchObject({ abn, active: true, names: ['ATO'], entityName: detail.EntityName, registrySource: 'web_service' });
  expect(record.quote).toContain('Active from 1999-11-01');
  expect(JSON.stringify({ search, record })).not.toContain(guid);
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [url] of fetcher.mock.calls) expect(new URL(String(url)).searchParams.get('guid')).toBe(guid);
});

it('retains cancelled and historical status instead of treating it as an API failure', async () => {
  const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => jsonp(String(url).includes('MatchingNames') ? { Message: '', Names: [{ ...row, IsCurrent: false }, { ...row, AbnStatus: '0000000002' }] } : { ...detail, AbnStatus: 'Cancelled' }));
  const client = createPublicAbnClient(fetcher, options);
  expect((await client.search(detail.EntityName)).match).toBeNull();
  expect((await client.record(abn)).active).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('keeps a valid empty API search without falling back', async () => {
  const fetcher = vi.fn(async () => jsonp({ Message: '', Names: [] }));
  expect((await createPublicAbnClient(fetcher, options).search('Unknown')).status).toBe('no_results');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(['http', 'message', 'malformed', 'wrong-abn', 'network'])('falls back on %s failures without exposing service credentials', async failure => {
  const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
    if (!String(url).includes('/json/')) return new Response(html);
    if (failure === 'http') return new Response('unavailable', { status: 503 });
    if (failure === 'message') return jsonp({ Message: `Invalid GUID: ${guid}` });
    if (failure === 'malformed') return new Response('callback(alert("invalid"));');
    if (failure === 'network') throw new Error(String(url));
    return jsonp({ ...detail, Abn: '26008672179' });
  });
  const record = await createPublicAbnClient(fetcher, options).record(abn);
  expect(record).toMatchObject({ abn, registrySource: 'public_html' });
  expect(JSON.stringify(record)).not.toContain(guid);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('falls back for failed API name searches', async () => {
  const searchHtml = `<title>Search results | ABN Lookup</title><table><caption>Matching names</caption><tr><td><a href="/ABN/View?abn=${abn}">${abn}</a> Active</td><td>${detail.EntityName}</td><td>Entity Name</td><td>2640 NSW</td></tr></table>`;
  const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => String(url).includes('/json/') ? jsonp({ Message: 'Invalid GUID' }) : new Response(searchHtml));
  const result = await createPublicAbnClient(fetcher, options).search(detail.EntityName);
  expect(result).toMatchObject({ registrySource: 'public_html', status: 'exact_name_match' });
});

it('uses HTML directly when no GUID is configured', async () => {
  const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
    expect(String(url)).not.toContain('/json/');
    return new Response(html);
  });
  await createPublicAbnClient(fetcher, { ...options, guid: '' }).record(abn);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0]?.[0])).not.toContain('/json/');
});

it('shares capacity and coalesces API requests', async () => {
  let active = 0, peak = 0;
  const fetcher = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return jsonp(String(url).includes('MatchingNames') ? { Message: '', Names: [row] } : detail);
  });
  const client = createPublicAbnClient(fetcher, options);
  await Promise.all([client.record(abn), client.record(abn), client.search('One'), client.search('Two')]);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(peak).toBe(2);
});

it('makes no requests after the deadline or for invalid ABNs', async () => {
  const fetcher = vi.fn(async () => jsonp(detail));
  const client = createPublicAbnClient(fetcher, options);
  await expect(client.record(abn, 0)).rejects.toThrow('deadline');
  await expect(client.record('12345678901')).rejects.toThrow('Invalid ABN');
  expect(fetcher).not.toHaveBeenCalled();
});

it('uses API records through the pipeline while requiring website corroboration of search candidates', async () => {
  const client = createPublicAbnClient(async url => jsonp(String(url).includes('MatchingNames') ? { Message: '', Names: [row] } : detail), options);
  const resolve = createAbnIdentityResolver({ ...client, website: async url => ({ url, html: '<p>No legal identity here</p>' }) });
  const input = { name: detail.EntityName, website: 'https://ato.gov.au' };
  expect((await resolve(input)).abn).toBeNull();
  const verified = await resolve({ ...input, explicitAbns: [{ abn, sourcePath: 'industry_codes.abn' }] });
  expect(verified).toMatchObject({ status: 'matched', abn, record: { registrySource: 'web_service' } });
  expect(JSON.stringify(verified)).not.toContain(guid);
});
