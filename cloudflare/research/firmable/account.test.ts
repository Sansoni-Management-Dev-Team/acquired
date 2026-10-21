import { describe, expect, it, vi } from 'vitest';
import { FirmableAccount } from './account';
import { seal, unseal } from './credentials';
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
it('persists renewed tokens encrypted but omits them after expiry',async()=>{
 vi.useFakeTimers();try{const {account,fetcher,state}=setup([token(),Response.json({id:'f123'}),token(),Response.json({id:'f123'})]);await account.handle(company);const saved=state.get('firmable:state') as {credentials:Parameters<typeof unseal>[0]};const credentials=await unseal(saved.credentials,env.FIRMABLE_CREDENTIAL_KEY);expect(credentials.sessionToken).toContain('.');expect(JSON.stringify(saved)).not.toContain(credentials.sessionToken);vi.setSystemTime(Date.now()+61000);await account.handle(company);expect(new URLSearchParams(String(fetcher.mock.calls[2][1]?.body)).has('token')).toBe(false);}finally{vi.useRealTimers();}
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

it('expands company details and obtains the available contact count without phone unlocking',async()=>{
 const {account,fetcher}=setup([token(),Response.json({id:'f123',name:'Example',employee_count:42,region:{AU:{employee_count:30,emails:['info@example.test'],business_identifiers:{acn:{value:'609047878'}}}}}),Response.json({success:true,total:30,records:[{id:'fp123'}]})]);
 const result=await account.handle({...company,query:{id:'f123',country:'AU',includePeople:'true'}});
 expect(result.status).toBe(200);expect(result.body.available_people_count).toBe(30);expect(result.body.acn).toBe('609047878');expect(result.body.company_emails).toEqual(['info@example.test']);expect(result.body.employee_count).toBe(42);
 expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({companyId:'f123',companyName:'Example',selectedCountry:'AU',from:0,size:1});
 expect(fetcher.mock.calls.some(([url])=>String(url).includes('/phones/'))).toBe(false);
});
it('preserves company data and an unknown contact count when summary retrieval fails',async()=>{
 const {account}=setup([token(),Response.json({id:'f123',name:'Example'}),Response.json({}, {status:500})]);
 const result=await account.handle({...company,query:{id:'f123',includePeople:'true'}});
 expect(result.status).toBe(200);expect(result.body.name).toBe('Example');expect(result.body.available_people_count).toBeNull();expect(result.body.people_summary).toMatchObject({status:'failed'});
});
it('recognizes a verified empty contact search without conflating it with employee count',async()=>{
 const {account}=setup([token(),Response.json({id:'f123',employee_count:42}),Response.json({success:false,totalPeople:0})]);
 const result=await account.handle({...company,query:{id:'f123',includePeople:'true'}});
 expect(result.body.available_people_count).toBe(0);expect(result.body.people_summary).toMatchObject({status:'complete',total:0});
});
it('returns a completed empty people page for Firmable totalPeople zero',async()=>{
 const {account}=setup([token(),Response.json({success:false,totalPeople:0})]);
 const r=await account.handle({path:'/people/search',method:'POST',query:{},body:{companyId:'f123',size:100,from:0}});
 expect(r.status).toBe(200);expect(r.body).toMatchObject({success:true,total:0,records:[],browserResponse:{success:false,totalPeople:0}});
});
it('does not turn a malformed or unsuccessful nonempty people search into zero contacts',async()=>{
 const {account}=setup([token(),Response.json({success:false,totalPeople:30})]);
 const r=await account.handle({path:'/people/search',method:'POST',query:{},body:{companyId:'f123',size:100,from:0}});
 expect(r.status).toBe(502);expect(r.body.category).toBe('invalid_upstream_response');
});

it('native account integration reserves every physical auth/profile request while preserving one shared token',async()=>{
 const storageData=new Map<string,unknown>(),storage={get:async(key:string)=>storageData.get(key),put:async(key:string,value:unknown)=>{storageData.set(key,value);}};
 const calls:string[]=[],receipts:unknown[]=[],nativeEnv={...env,FIRMABLE_SESSION_TOKEN:seed({sid:env.FIRMABLE_SESSION_ID,o:{id:env.FIRMABLE_ORGANIZATION_ID},exp:1}),APP_ORIGIN:'https://app.example.invalid',SERVICE_SECRET:'synthetic-worker-secret'};
 const fetcher:typeof fetch=async(input,init)=>{const url=String(input);if(url.startsWith(nativeEnv.APP_ORIGIN)){const p=JSON.parse(String(init?.body));calls.push(p.action);if(p.action==='native-provider-begin')return Response.json({kind:'started',operationId:'attempt',fence:'1'});receipts.push(p.outcome);return Response.json({ok:true});}calls.push(url.includes('clerk.')?'AUTH':'PROFILE');if(url.includes('clerk.'))expect(new URLSearchParams(String(init?.body)).has('token')).toBe(false);return url.includes('clerk.')?token():Response.json({id:'f123',name:'Synthetic company'});};
 const account=new FirmableAccount(storage as never,nativeEnv,fetcher),nativeResearch={jobId:'a1a639c7-169c-4bcd-893a-991470047023',key:'company:f123'};
 expect((await account.handle({...company,nativeResearch})).status).toBe(200);
 expect(calls).toEqual(['native-provider-begin','AUTH','native-provider-finish','native-provider-begin','PROFILE','native-provider-finish']);expect(receipts).toHaveLength(2);expect(JSON.stringify(receipts)).not.toContain('signature');
});
it('native account budget denial stops before auth renewal or any provider HTTP',async()=>{
 const storage={get:async()=>undefined,put:async()=>{}},upstream=vi.fn(),nativeEnv={...env,APP_ORIGIN:'https://app.example.invalid',SERVICE_SECRET:'synthetic-worker-secret'},fetcher:typeof fetch=async(input)=>{if(String(input).startsWith(nativeEnv.APP_ORIGIN))return Response.json({error:'Budget exhausted'},{status:409});return upstream();};
 const account=new FirmableAccount(storage as never,nativeEnv,fetcher);
 expect((await account.handle({...company,nativeResearch:{jobId:'a1a639c7-169c-4bcd-893a-991470047023',key:'company:f123'}})).status).toBe(409);expect(upstream).not.toHaveBeenCalled();
});
it('retains do-not-contact when phone fields are omitted from a person response',async()=>{
 const {account}=setup([token(),Response.json({id:'fp123',name:'Synthetic person',phones:[{value:'+61 400 000 000',is_dnd:true}]})]);
 const result=await account.handle({path:'/people',method:'GET',query:{id:'fp123',includePhones:'false'}});expect(result.status).toBe(200);expect(result.body.do_not_contact).toBe(true);expect(JSON.stringify(result.body)).not.toContain('+61 400 000 000');
});

function seed(claims:Record<string,unknown>){return `e30.${btoa(JSON.stringify(claims)).replaceAll('=','').replaceAll('+','-').replaceAll('/','_')}.signature`;}
it.each(['expired','malformed','foreign_session','foreign_org','missing_exp','nonfinite_exp'] as const)('omits %s optional renewal hint without changing cookie authority',async kind=>{
 const claims={sid:env.FIRMABLE_SESSION_ID,o:{id:env.FIRMABLE_ORGANIZATION_ID},exp:Math.floor(Date.now()/1000)+60};
 const hint=kind==='malformed'?'e30.bm90LWpzb24.signature':seed({...claims,...(kind==='expired'?{exp:1}:kind==='foreign_session'?{sid:'sess_other'}:kind==='foreign_org'?{o:{id:'org_other'}}:kind==='missing_exp'?{exp:undefined}:kind==='nonfinite_exp'?{exp:'Infinity'}:{})});
 const {storage,fetcher}=setup([token(),Response.json({id:'f123'})]);const account=new FirmableAccount(storage as never,{...env,FIRMABLE_SESSION_TOKEN:hint},fetcher as typeof fetch);
 expect((await account.handle(company)).status).toBe(200);const request=fetcher.mock.calls[0][1]!;expect(new URLSearchParams(String(request.body)).has('token')).toBe(false);expect(new Headers(request.headers).get('Cookie')).toBe('__client='+env.FIRMABLE_CLIENT_COOKIE);
});
it('retains a fresh matching optional hint and ignores an expired encrypted hint after recreation',async()=>{
 const fresh=seed({sid:env.FIRMABLE_SESSION_ID,o:{id:env.FIRMABLE_ORGANIZATION_ID},exp:Math.floor(Date.now()/1000)+60});
 const f=setup([token(),Response.json({id:'f123'})]);expect((await new FirmableAccount(f.storage as never,{...env,FIRMABLE_SESSION_TOKEN:fresh},f.fetcher as typeof fetch).handle(company)).status).toBe(200);expect(new URLSearchParams(String(f.fetcher.mock.calls[0][1]?.body)).get('token')).toBe(fresh);
 const other=setup([token(),Response.json({id:'f123'})]);other.state.set('firmable:state',{credentials:await seal({cookie:env.FIRMABLE_CLIENT_COOKIE,sessionId:env.FIRMABLE_SESSION_ID,organizationId:env.FIRMABLE_ORGANIZATION_ID,sessionToken:seed({sid:env.FIRMABLE_SESSION_ID,o:{id:env.FIRMABLE_ORGANIZATION_ID},exp:1})},env.FIRMABLE_CREDENTIAL_KEY)});
 expect((await new FirmableAccount(other.storage as never,env,other.fetcher as typeof fetch).handle(company)).status).toBe(200);expect(new URLSearchParams(String(other.fetcher.mock.calls[0][1]?.body)).has('token')).toBe(false);
});
it('never accepts a returned token for another context or silently clears an authentication latch',async()=>{
 const bad=seed({sid:'sess_other',o:{id:env.FIRMABLE_ORGANIZATION_ID},exp:Math.floor(Date.now()/1000)+60});const f=setup([Response.json({jwt:bad})]);expect((await f.account.handle(company))).toMatchObject({status:502,body:{category:'unexpected_token_context'}});expect(f.fetcher).toHaveBeenCalledOnce();
 f.state.set('firmable:state',{reconnectRequired:true});expect((await f.account.handle(company))).toMatchObject({status:401,body:{category:'reconnect_required'}});expect(f.fetcher).toHaveBeenCalledOnce();
 f.fetcher.mockResolvedValueOnce(token());expect((await f.account.handle({path:'/reconnect',method:'POST',query:{},body:{cookie:env.FIRMABLE_CLIENT_COOKIE,sessionId:env.FIRMABLE_SESSION_ID,organizationId:env.FIRMABLE_ORGANIZATION_ID}})).status).toBe(200);expect((await f.account.handle({path:'/status',method:'GET',query:{}})).body.reconnectRequired).toBe(false);
});

it('logs correlated queue/pacing/renewal/upstream boundaries without leaking account credentials or person data',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{}),f=setup([token(),Response.json({id:'f123',private:'PRIVATE provider body'})]);f.state.set('firmable:state',{nextRequestAt:Date.now()+15});
 try{expect((await f.account.handle({...company,traceContext:{jobId:'job-12345',requestId:'request-12345',logicalCallId:'client-call-12345'}})).status).toBe(200);const events=log.mock.calls.filter(([tag])=>tag==='firmable-account').map(([,body])=>JSON.parse(body));expect(events.map(e=>e.event)).toEqual(expect.arrayContaining(['request_started','queue_entered','queue_started','pacing_wait','renewal_started','renewal_finished','upstream_attempt_started','upstream_attempt_finished','request_finished']));expect(events.every(e=>e.module==='firmable.account'&&e.jobId==='job-12345'&&e.logicalCallId==='client-call-12345')).toBe(true);expect(events.at(-1)).toMatchObject({outcome:'succeeded',httpStatus:200});expect(JSON.stringify(events)).not.toMatch(/PRIVATE|initial-cookie|sess_test|org_test|signature/);expect(f.fetcher).toHaveBeenCalledTimes(2);}finally{log.mockRestore();}
});
it('records bounded queue rejection and cooldown without starting new provider calls',async()=>{const log=vi.spyOn(console,'info').mockImplementation(()=>{}),f=setup([]);try{const results=await Promise.all(Array.from({length:11},()=>f.account.handle({path:'/status',method:'GET',query:{}})));expect(results.some(r=>r.status===429)).toBe(true);f.state.set('firmable:state',{cooldownUntil:Date.now()+60000,requestSpacingMs:4000});expect((await f.account.handle({...company,traceContext:{jobId:'job-12345'}})).status).toBe(429);const events=log.mock.calls.filter(([tag])=>tag==='firmable-account').map(([,body])=>JSON.parse(body));expect(events.map(e=>e.event)).toContain('queue_rejected');expect(events.map(e=>e.event)).toContain('cooldown_active');expect(f.fetcher).not.toHaveBeenCalled();expect(f.state.get('firmable:state')).toMatchObject({requestSpacingMs:4000});}finally{log.mockRestore();}});
it('persists conservative upstream-429 spacing across recreation without a cooldown-end burst',async()=>{
 vi.useFakeTimers();vi.spyOn(console,'info').mockImplementation(()=>{});
 try{
  const initial=Date.now();
  const {account,fetcher,storage,state}=setup([token(),Response.json({}, {status:429,headers:{'Retry-After':'2'}}),token(),Response.json({id:'f123'}),Response.json({id:'f123'})]);
  expect((await account.handle(company)).status).toBe(429);
  expect(state.get('firmable:state')).toMatchObject({requestSpacingMs:2000,nextRequestAt:initial+4000});
  const recreated=new FirmableAccount(storage as never,env,fetcher as typeof fetch);
  await vi.advanceTimersByTimeAsync(2000);
  const next=recreated.handle(company);
  await vi.advanceTimersByTimeAsync(1999);expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);expect((await next).status).toBe(200);
  expect(state.get('firmable:state')).toMatchObject({requestSpacingMs:2000,nextRequestAt:initial+6000});
  const final=recreated.handle(company);await vi.advanceTimersByTimeAsync(1999);expect(fetcher).toHaveBeenCalledTimes(4);
  await vi.advanceTimersByTimeAsync(1);expect((await final).status).toBe(200);
  expect(state.get('firmable:state')).toMatchObject({requestSpacingMs:2000});
 }finally{vi.useRealTimers();vi.restoreAllMocks();}
});
it.each([
 {path:'/people/search',method:'POST',query:{},body:{companyId:'f123'}},
 {path:'/people',method:'GET',query:{id:'fp123'}},
 {path:'/people/phones',method:'POST',query:{},body:{id:'fp123',confirmCredits:true}},
 {path:'/company',method:'GET',query:{id:'f123',includePeople:'true'}},
])('enforces the current company-only parent before any People upstream for $path',async input=>{

 const upstream:string[]=[],classes:string[]=[],state=new Map<string,unknown>();
 const fetcher=vi.fn(async(url:RequestInfo|URL,options?:RequestInit)=>{
  if(String(url).startsWith('https://app.example.invalid/')){const payload=JSON.parse(String(options?.body));if(payload.action==='native-provider-begin'){classes.push(payload.requestClass);if(!['auth','company_search','company_profile'].includes(payload.requestClass))return Response.json({error:'Company-only parent does not permit this request class'},{status:409});return Response.json({kind:'started',operationId:'attempt',fence:'1'});}return Response.json({ok:true});}
  upstream.push(String(url));if(String(url).startsWith('https://clerk.firmable.com/'))return token();if(String(url)==='https://api.firmable.com/internal/company/f123')return Response.json({id:'f123',name:'Fixture company'});throw Error('A paid People request escaped company-only authority');
 });
 const account=new FirmableAccount({get:async(key:string)=>state.get(key),put:async(key:string,value:unknown)=>{state.set(key,value);}} as never,{...env,APP_ORIGIN:'https://app.example.invalid',SERVICE_SECRET:'synthetic-callback-secret'},fetcher);
 const pending=account.handle({...input,nativeResearch:{jobId:'a1a639c7-169c-4bcd-893a-991470047023',key:'company-only-test'}});const result=await pending;
 expect(classes).toContain('auth');expect(classes.some(value=>['people_search','person_profile','phone_reveal'].includes(value))).toBe(true);expect(upstream.some(url=>url.includes('/internal/people'))).toBe(false);
 if(input.path==='/company'){expect(result.status).toBe(200);expect(result.body.people_summary).toMatchObject({status:'failed'});expect(upstream).toHaveLength(2);}else{expect(result.status).toBe(409);expect(upstream).toHaveLength(1);}

});

it('rejected reconnect retains the exact encrypted original credentials, authentication latch and pacing state',async()=>{
 const replacement={cookie:'replacement-cookie-value-long-enough',sessionId:'sess_replacement',organizationId:env.FIRMABLE_ORGANIZATION_ID};
 const original={cookie:'original-saved-cookie-value-long-enough',sessionId:'sess_original',organizationId:env.FIRMABLE_ORGANIZATION_ID},now=Date.now();
 const f=setup([Response.json({}, {status:403})]),saved={credentials:await seal(original,env.FIRMABLE_CREDENTIAL_KEY),reconnectRequired:true,cooldownUntil:now+60000,nextRequestAt:now+64000,requestSpacingMs:4000};f.state.set('firmable:state',structuredClone(saved));
 expect(await f.account.handle({path:'/reconnect',method:'POST',query:{},body:replacement})).toMatchObject({status:403,body:{category:'upstream_authentication'}});
 expect(f.state.get('firmable:state')).toEqual(saved);expect(f.storage.put).not.toHaveBeenCalled();expect(await unseal(saved.credentials,env.FIRMABLE_CREDENTIAL_KEY)).toEqual(original);
 expect((await f.account.handle({path:'/status',method:'GET',query:{}})).body).toMatchObject({configured:true,reconnectRequired:true,cooldownUntil:saved.cooldownUntil});
 expect(f.fetcher).toHaveBeenCalledOnce();const[url,request]=f.fetcher.mock.calls[0];expect(new URL(String(url)).origin).toBe('https://clerk.firmable.com');expect(new Headers(request?.headers).get('Cookie')).toBe('__client='+replacement.cookie);expect(new URLSearchParams(String(request?.body)).get('organization_id')).toBe(env.FIRMABLE_ORGANIZATION_ID);
});
it('same-organisation reconnect validates and encrypts replacement credentials without clearing cooldown or starting company or People reads',async()=>{
 const replacement={cookie:'replacement-cookie-value-long-enough',sessionId:'sess_replacement',organizationId:env.FIRMABLE_ORGANIZATION_ID},jwt=seed({sid:'sess_replacement',o:{id:env.FIRMABLE_ORGANIZATION_ID},exp:Math.floor(Date.now()/1000)+120});
 const f=setup([Response.json({jwt},{headers:{'Set-Cookie':'__client=rotated-replacement-cookie-value-long-enough; HttpOnly; Secure'}})]),now=Date.now(),saved={credentials:await seal({cookie:env.FIRMABLE_CLIENT_COOKIE,sessionId:env.FIRMABLE_SESSION_ID,organizationId:env.FIRMABLE_ORGANIZATION_ID},env.FIRMABLE_CREDENTIAL_KEY),reconnectRequired:true,cooldownUntil:now+60000,nextRequestAt:now+64000,requestSpacingMs:4000};f.state.set('firmable:state',structuredClone(saved));
 expect(await f.account.handle({path:'/reconnect',method:'POST',query:{},body:{...replacement,organizationId:'org_other'}})).toMatchObject({status:400,body:{category:'unexpected_organization'}});expect(f.state.get('firmable:state')).toEqual(saved);expect(f.fetcher).not.toHaveBeenCalled();
 const sentCookie=replacement.cookie;expect(await f.account.handle({path:'/reconnect',method:'POST',query:{},body:replacement})).toMatchObject({status:200,body:{connected:true}});
 const state=f.state.get('firmable:state')as typeof saved;expect(state).toMatchObject({reconnectRequired:false,cooldownUntil:saved.cooldownUntil,nextRequestAt:saved.nextRequestAt,requestSpacingMs:saved.requestSpacingMs});expect(state.credentials).not.toEqual(saved.credentials);
 expect(await unseal(state.credentials,env.FIRMABLE_CREDENTIAL_KEY)).toEqual({cookie:'rotated-replacement-cookie-value-long-enough',sessionId:'sess_replacement',organizationId:env.FIRMABLE_ORGANIZATION_ID,sessionToken:jwt});expect(JSON.stringify(state)).not.toMatch(/replacement-cookie|sess_replacement|signature/);
 expect((await f.account.handle({path:'/status',method:'GET',query:{}})).body).toMatchObject({configured:true,reconnectRequired:false,cooldownUntil:saved.cooldownUntil});
 expect(f.fetcher).toHaveBeenCalledOnce();const[url,request]=f.fetcher.mock.calls[0];expect(new URL(String(url)).origin).toBe('https://clerk.firmable.com');expect(new URL(String(url)).pathname).toBe('/v1/client/sessions/sess_replacement/tokens');expect(new Headers(request?.headers).get('Cookie')).toBe('__client='+sentCookie);expect(new URLSearchParams(String(request?.body)).get('organization_id')).toBe(env.FIRMABLE_ORGANIZATION_ID);
});
