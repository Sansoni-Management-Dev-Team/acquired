import { describe, expect, it, vi } from 'vitest';
import { FirmableAccount } from './account';
import { unseal } from './credentials';
import { retryDelay } from './transport';
const env = { FIRMABLE_CLIENT_COOKIE: 'initial-cookie-value-long-enough', FIRMABLE_SESSION_ID: 'sess_test', FIRMABLE_ORGANIZATION_ID: 'org_test', FIRMABLE_CREDENTIAL_KEY: 'a'.repeat(32) };
function setup(responses: Response[]) {
  const state = new Map<string, unknown>();
  const storage = { get: vi.fn(async (key: string) => state.get(key)), put: vi.fn(async (key: string, value: unknown) => { state.set(key, structuredClone(value)); }) };
  const fetcher = vi.fn(async () => responses.shift()!);
  const account = new FirmableAccount(storage as never, env, fetcher as typeof fetch);
  return { account, fetcher, storage, state };
}
function token(headers = {}) {
  const claims = { sid: env.FIRMABLE_SESSION_ID, o: { id: env.FIRMABLE_ORGANIZATION_ID }, exp: Math.floor(Date.now() / 1000) + 60 };
  return Response.json({ jwt: `e30.${btoa(JSON.stringify(claims)).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_")}.signature` }, { headers });
}
const company = { path: '/company', method: 'GET', query: { id: 'f123' } };
describe('Firmable account coordination', () => {
  it('shares one renewal across concurrent requests and persists encrypted rotation', async () => {
    const { account, fetcher, state } = setup([token({ 'Set-Cookie': '__client=rotated-cookie-value-long-enough; HttpOnly; Secure' }), Response.json({ id: 'f123', revenue: { 2: '$1M - $5M' } }), Response.json({ id: 'f123' })]);
    const results = await Promise.all([account.handle(company), account.handle(company)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(results[0].body.revenue).toBe('$1M - $5M');
    const saved = state.get('firmable:state') as { credentials: Parameters<typeof unseal>[0] };
    expect(JSON.stringify(saved)).not.toContain('rotated-cookie');
    expect((await unseal(saved.credentials, env.FIRMABLE_CREDENTIAL_KEY)).cookie).toBe('rotated-cookie-value-long-enough');
  });
  it('keeps rate-limit cooldown across account recreation without more upstream calls', async () => {
    const { account, fetcher, storage } = setup([token(), Response.json({}, { status: 429, headers: { 'Retry-After': '60' } })]);
    expect((await account.handle(company)).status).toBe(429);
    const recreated = new FirmableAccount(storage as never, env, fetcher as typeof fetch);
    expect((await recreated.handle(company)).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('marks rejected authentication as requiring reconnect and stops repeated renewal', async () => {
    const { account, fetcher } = setup([Response.json({}, { status: 401 }), Response.json({}, { status: 401 })]);
    expect((await account.handle(company)).body.category).toBe('reconnect_required');
    expect((await account.handle(company)).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not guess company identity from a similar name', async () => {
    const { account } = setup([token(), Response.json({ records: [{ id: 'f123', website: 'different.example' }] })]);
    expect((await account.handle({ ...company, query: { fqdn: 'raymax.com.au' } })).status).toBe(404);
  });
  it('handles date and missing retry headers', () => {
    expect(retryDelay(null)).toBe(30_000);
    expect(retryDelay(new Date(100_000).toUTCString(), 50_000)).toBe(50_000);
  });
});
it('renews the cached token after expiry', async () => {
  vi.useFakeTimers();
  try {
    const { account, fetcher } = setup([]);
    fetcher.mockImplementation(async () => fetcher.mock.calls.length % 2 === 1 ? token() : Response.json({ id: 'f123' }));
    expect((await account.handle(company)).status).toBe(200);
    vi.setSystemTime(Date.now() + 61_000);
    expect((await account.handle(company)).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(4);
  } finally { vi.useRealTimers(); }
});
it('searches companies once with AI and paginates the interpreted filters',async()=>{
 vi.useFakeTimers();try {
 const interpreted={filters:{country:{AU:'Australia'}},operators:{country:'OR'},excluded:{}};
 const {account,fetcher}=setup([token(),Response.json({success:true,records:[{id:'f1',revenue:'4'}],totalCompany:200,predictedFilters:interpreted}),Response.json({success:true,records:[{id:'f2'}],totalCompany:200})]);
 const first=await account.handle({path:'/company/search',method:'POST',query:{},body:{query:'Packaging companies',size:100}});expect(first.status).toBe(200);expect((first.body.records as Record<string,unknown>[])[0].revenue).toBe('4');
 const pending=account.handle({path:'/company/search',method:'POST',query:{},body:{from:100,size:100,interpreted}});await vi.advanceTimersByTimeAsync(1000);expect((await pending).status).toBe(200);
 const initial=JSON.parse(String(fetcher.mock.calls[1][1]?.body)),next=JSON.parse(String(fetcher.mock.calls[2][1]?.body));expect(initial.ai_search).toEqual({do_search:true});expect(next.filters).toEqual(interpreted.filters);expect(next.ai_search).toBeUndefined();expect(next.query).toBeUndefined();expect(next.from).toBe(100);
 } finally {vi.useRealTimers();}
});
it('persists the renewed session token encrypted and uses it on the next renewal',async()=>{
 vi.useFakeTimers();try{const {account,fetcher,state}=setup([token(),Response.json({id:'f123'}),token(),Response.json({id:'f123'})]);await account.handle(company);const saved=state.get('firmable:state') as {credentials:Parameters<typeof unseal>[0]};const credentials=await unseal(saved.credentials,env.FIRMABLE_CREDENTIAL_KEY);expect(credentials.sessionToken).toContain('.');expect(JSON.stringify(saved)).not.toContain(credentials.sessionToken);vi.setSystemTime(Date.now()+61000);await account.handle(company);expect(new URLSearchParams(String(fetcher.mock.calls[2][1]?.body)).get('token')).toBe(credentials.sessionToken);}finally{vi.useRealTimers();}
});
it('rejects pagination without interpreted filters and an invalid company query',async()=>{const {account,fetcher}=setup([]);expect((await account.handle({path:'/company/search',method:'POST',query:{},body:{from:100}})).status).toBe(400);expect((await account.handle({path:'/company/search',method:'POST',query:{},body:{query:''}})).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();});
it('treats a verified empty company search as no match and tries the domain prefix',async()=>{
 const {account,fetcher}=setup([token(),Response.json({success:false,totalCompany:0,totalPeople:0}),Response.json({success:true,records:[{id:'f123',website:'https://clean.example'}],totalCompany:1}),Response.json({id:'f123',website:'https://clean.example',name:'Clean Pty Ltd'})]);
 const result=await account.handle({...company,query:{fqdn:'clean.example',name:'Commercial cleaning title'}});
 expect(result.status).toBe(200);expect(result.body.id).toBe('f123');expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body)).search.company.name).toBe('clean');
});
it('returns not found when both company searches have verified zero results',async()=>{
 const {account}=setup([token(),Response.json({success:false,totalCompany:0,totalPeople:0}),Response.json({success:false,totalCompany:0,totalPeople:0})]);expect((await account.handle({...company,query:{fqdn:'clean.example',name:'Clean Pty Ltd'}})).status).toBe(404);
});
it('keeps malformed search responses as provider failures',async()=>{const {account}=setup([token(),Response.json({success:false,totalCompany:2})]);expect((await account.handle({...company,query:{fqdn:'clean.example'}})).status).toBe(502);});
it('email-only profile retrieval never requests phone unlock and excludes phone data', async () => {
 const { account, fetcher } = setup([token(), Response.json({id:'fp123',emails:[{value:'test@example.com'}],phones:[{value:'0412345678'}],phone:'0412345678'})]);
 const result = await account.handle({path:'/people',method:'GET',query:{id:'fp123',includePhones:'false'}});
 expect(result.status).toBe(200);expect(result.body.phones).toBeUndefined();expect(result.body.phone).toBeUndefined();expect(result.body.emails).toEqual([{value:'test@example.com'}]);
 expect(fetcher.mock.calls.map(call=>String(call[0]))).not.toContain(expect.stringContaining('/phones/'));
});
it('requires explicit confirmation before a credit-bearing phone lookup', async () => {
 const { account, fetcher } = setup([token()]);
 expect((await account.handle({path:'/people/phones',method:'POST',query:{},body:{id:'fp123'}})).status).toBe(400);
 expect(fetcher).not.toHaveBeenCalled();
});
it('does not unlock phone numbers again when already disclosed', async () => {
 const { account, fetcher } = setup([token(),Response.json({phones:[{value:'0412345678'}],hasViewedPhonesAlready:true})]);
 expect((await account.handle({path:'/people/phones',method:'POST',query:{},body:{id:'fp123',confirmCredits:true}})).body.phones).toEqual([{value:'0412345678'}]);
 expect(fetcher.mock.calls.some(call=>String(call[0]).endsWith('/phones/show'))).toBe(false);
});
it('uses the captured phone unlock endpoint only for explicit manual retrieval', async () => {
 const { account, fetcher } = setup([token(),Response.json({phones:[{masked_value:'04********'}],hasViewedPhonesAlready:false}),Response.json({phones:[{value:'0412345678',is_dnd:true}]})]);
 expect((await account.handle({path:'/people/phones',method:'POST',query:{},body:{id:'fp123',confirmCredits:true}})).status).toBe(200);
 expect(fetcher.mock.calls.filter(call=>String(call[0]).endsWith('/phones/show'))).toHaveLength(1);
});
