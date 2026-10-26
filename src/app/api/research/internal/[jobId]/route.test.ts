import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import type { ResearchConfig } from '@/domain/research';
const mocks = vi.hoisted(() => ({ observeInitial:vi.fn(),nativeEnabled:vi.fn(), nativeAllowed:vi.fn(), nativeBegin:vi.fn(),nativeFinish:vi.fn(),nativeComplete:vi.fn(),nativeContinuation:vi.fn(),store:vi.fn(),company:vi.fn(), background:vi.fn(), dispatch:vi.fn(), people:vi.fn(), authorized: vi.fn(), get: vi.fn(), progress: vi.fn(), save: vi.fn(), after: vi.fn(), select: vi.fn(), cooldown: vi.fn() }));
vi.mock('@/lib/agent-runtime',()=>({nativeAgentEnabled:mocks.nativeEnabled,agentStore:mocks.store}));
vi.mock('@/lib/agent-initial-research-observer',()=>({observeInitialResearchProgress:mocks.observeInitial}));
vi.mock('@/lib/firmable-company-research',()=>({firmableCompanyResearch:mocks.company}));
vi.mock('@/lib/company-background-execution',()=>({executeCompanyBackground:mocks.background}));
vi.mock('@/lib/company-background-dispatch',()=>({dispatchCompanyBackground:mocks.dispatch}));
vi.mock('@/lib/company-people-research',()=>({queueCompanyPeople:mocks.people}));
vi.mock('@/lib/research-provider-queue', () => ({ coolDownResearchBrowser: mocks.cooldown, reserveResearchProvider: vi.fn(), releaseResearchProvider: vi.fn() }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/lib/research-service', () => ({ researchEnabled: () => true, researchServiceAuthorized: mocks.authorized }));
vi.mock('@/db/research-timing-repository', () => ({ saveResearchTimingSpans: mocks.save }));
vi.mock('@/db/research-repository', async original => {
  const actual = await original<typeof import('@/db/research-repository')>();
  return { ...actual, ResearchRepository: class { get = mocks.get; getExecution = mocks.get; getControl = mocks.get; progress = mocks.progress; } };
});
vi.mock('@/db/client', () => ({ requireDb: () => ({ select: mocks.select }) }));
import { GET, POST } from './route';
import {FirmableError} from '@/adapters/firmable-client';
const jobId = '00000000-0000-4000-8000-000000000001';
const span = { id: '00000000-0000-4000-8000-000000000010', step: 'extract-1', segment: 'extraction', startedAt: '2026-09-30T00:00:00.000Z', finishedAt: '2026-09-30T00:00:00.001Z', elapsedMs: 1, outcome: 'succeeded' };
const config: ResearchConfig = { seeds: [], searchTerms: ['sensors'], geography: 'Australia', approved: true, discover: false, performanceFlags: { telemetryBatching: true }, budget: { maxPages: 3, maxModelCalls: 3, maxMinutes: 10, maxDomains: 3 } };
it('returns persisted mandate/run/job trace for worker control instead of trusting diagnostic headers', async()=>{
 const request=new Request('http://app/api',{headers:{'x-acquire-mandate-id':'forged-mandate','x-acquire-research-run':'forged-root'}});
 const response=await GET(request,{params:Promise.resolve({jobId})});
 expect((await response.json()).traceContext).toMatchObject({mandateId:job.mandateId,runId:jobId,jobId});
});
let job: { id: string; organizationId: string; mandateId: string; createdAt: Date; updatedAt: Date; status: string; seeds: string[]; config: ResearchConfig; revision: number; crawlId: null; executionUpdatedAt?:Date };
const call = (data: unknown) => POST(new Request('http://app/api', { method: 'POST', body: JSON.stringify(data), headers: { 'x-request-id': 'worker-request-123' } }), { params: Promise.resolve({ jobId }) });
const event = { revision: 1, status: 'crawling', pages: 0, modelCalls: 0, message: 'Heartbeat' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatch.mockResolvedValue(undefined);mocks.observeInitial.mockResolvedValue({messages:0});
  mocks.nativeEnabled.mockReturnValue(false);mocks.nativeAllowed.mockResolvedValue(true);mocks.store.mockReturnValue({nativeResearchExecutionAllowed:mocks.nativeAllowed,beginNativeResearchAttempt:mocks.nativeBegin,finishNativeResearchAttempt:mocks.nativeFinish,finishNativeResearchJob:mocks.nativeComplete,nativeCompanyContinuation:mocks.nativeContinuation});
  job = { id: jobId, organizationId: 'org', mandateId: 'mandate', createdAt: new Date(), updatedAt: new Date(), status: 'queued', seeds: [], config: structuredClone(config), revision: 0, crawlId: null };
  mocks.authorized.mockReturnValue(true);
  mocks.select.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [job] }) }) });
  mocks.get.mockImplementation(async () => job);
  mocks.progress.mockImplementation(async () => ({ ...job, status: event.status, revision: event.revision }));
  mocks.save.mockResolvedValue(undefined);
});
it('preserves a known Firmable cooldown through the authenticated company callback', async () => {
 mocks.company.mockRejectedValueOnce(Object.assign(new FirmableError('/company',429,'Firmable request failed (429)'),{retryAfterMs:60000}));
 const result=await call({action:'d-company',row:{id:'f123'}});
 expect(result.status).toBe(429);expect(result.headers.get('retry-after')).toBe('60');
 expect(await result.json()).toEqual({provider:'firmable',category:'rate_limited',retryAfterMs:60000});
 expect(mocks.after).not.toHaveBeenCalled();expect(mocks.nativeBegin).not.toHaveBeenCalled();
});
it('persists piggyback telemetry once and acknowledges only after the write succeeds', async () => {
  const response = await call({ ...event, timingSpans: [span] });
  expect(await response.json()).toMatchObject({ ok: true, timingAcceptedIds: [span.id] });
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save).toHaveBeenCalledWith(jobId, 'org', [span]);
  expect(mocks.progress).toHaveBeenCalledWith(jobId, expect.objectContaining(event), job);
  expect(mocks.get).not.toHaveBeenCalled();
  expect(response.headers.get('x-request-id')).toBe('worker-request-123');
  expect(response.headers.get('server-timing')).toContain('db;dur=');
});
it('saves useful progress when telemetry fails but does not acknowledge lost spans', async () => {
  mocks.save.mockRejectedValue(new Error('database unavailable for telemetry'));
  const response = await call({ ...event, timingSpans: [span] });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, timingAcceptedIds: [] });
  expect(mocks.progress).toHaveBeenCalledTimes(1);
});
it('does not acknowledge telemetry or save it when progress is rejected', async () => {
  mocks.progress.mockRejectedValue(new Error('write failed'));
  expect((await call({ ...event, timingSpans: [span] })).status).toBe(409);
  expect(mocks.save).not.toHaveBeenCalled();
});
it('rejects invalid or unauthorized timing batches before persistence', async () => {
  expect((await call({ ...event, timingSpans: Array(65).fill(span) })).status).toBe(400);
  mocks.authorized.mockReturnValue(false);
  expect((await call({ ...event, timingSpans: [span] })).status).toBe(403);
  expect(mocks.progress).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});
it('preserves legacy progress without requiring a timing acknowledgement', async () => {
  job.config.performanceFlags = undefined;
  const response = await call(event);
  expect(await response.json()).toMatchObject({ ok: true });
  expect(mocks.save).not.toHaveBeenCalled();
});
it('adds correlated timing headers to authorized and rejected control requests', async () => {
  const request = new Request('http://app/api', { headers: { 'x-request-id': 'worker-request-123' } });
  const response = await GET(request, { params: Promise.resolve({ jobId }) });
  expect(response.headers.get('x-request-id')).toBe('worker-request-123');
  expect(response.headers.get('server-timing')).toContain('app;dur=');
  mocks.authorized.mockReturnValue(false);
  const rejected = await GET(request, { params: Promise.resolve({ jobId }) });
  expect(rejected.status).toBe(403);
  expect(rejected.headers.get('x-request-id')).toBe('worker-request-123');
});

it('batches server-side spans with incoming worker spans but only acknowledges the worker IDs', async () => {
  const { measureResearchSegment } = await import('@/lib/research-segment-timing');
  mocks.progress.mockImplementation(async () => {
    await measureResearchSegment(jobId, 'org', 'db-save', 'persistence', async () => undefined);
    await measureResearchSegment(jobId, 'org', 'validation', 'other', async () => undefined);
    return job;
  });
  const response = await call({ ...event, timingSpans: [span] });
  expect((await response.json()).timingAcceptedIds).toEqual([span.id]);
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0][2]).toHaveLength(3);
});

it('acknowledges a replayed batch after idempotent progress reports an already completed job', async () => {
  job.status = 'complete';
  mocks.progress.mockResolvedValue(job);
  const response = await call({ ...event, timingSpans: [span] });
  expect((await response.json()).timingAcceptedIds).toEqual([span.id]);
  expect(mocks.save).toHaveBeenCalledTimes(1);
});

it('uses a lean config projection for subsequent controls without fetching the full job twice', async () => {
  const { PgDialect } = await import('drizzle-orm/pg-core');
  const response = await GET(new Request('http://app/api?control=1'), { params: Promise.resolve({ jobId }) });
  expect(response.status).toBe(200);
  expect(mocks.select).toHaveBeenCalledTimes(1);
  const selected = mocks.select.mock.calls[0][0];
  const query = new PgDialect().sqlToQuery(selected.config);
  expect(query.sql).toContain('jsonb_build_object');
  expect(query.sql).not.toContain("'runtime'");
  expect(query.sql).not.toContain("'pipelineTiming'");
  expect(mocks.get).not.toHaveBeenCalled();
});
it('acknowledges replayed terminal telemetry without scheduling the run again', async () => {
 job.revision = 1;
 job.status = 'complete';
 const response = await call({ ...event, status: 'complete', timingSpans: [span] });
 expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({ timingAcceptedIds: [span.id] });
 expect(mocks.after).not.toHaveBeenCalled();
});


it('normalizes website cooldowns for the SQL fallback while retaining global capacity cooldowns', async () => {
  expect((await call({ action: 'browser-cooldown', retryAfterMs: 3000, domain: 'www.Example.com' })).status).toBe(200);
  expect(mocks.cooldown).toHaveBeenLastCalledWith(3000, 'example.com');
  expect((await call({ action: 'browser-cooldown', retryAfterMs: 3000 })).status).toBe(200);
  expect(mocks.cooldown).toHaveBeenLastCalledWith(3000, undefined);
});
it.each(['private.example/path', 'user:secret@example.com', 'https://example.com', '', 123, 'example.com:443'])('rejects malformed cooldown domain %s without poisoning the shared queue', async domain => {
  expect((await call({ action: 'browser-cooldown', retryAfterMs: 3000, domain })).status).toBe(400);
  expect(mocks.cooldown).not.toHaveBeenCalled();
});

it('returns saved company result before background dispatch or optional people execution starts',async()=>{
 mocks.company.mockResolvedValue({ok:true,matched:true,targetId:'target',firmableId:'f123',backgroundJobId:'background'});
 mocks.dispatch.mockImplementation(()=>new Promise(()=>{}));
 expect(await(await call({action:'d-company',row:{id:'f123'}})).json()).toMatchObject({ok:true,backgroundJobId:'background'});
 expect(mocks.after).toHaveBeenCalledOnce();expect(mocks.dispatch).not.toHaveBeenCalled();expect(mocks.people).not.toHaveBeenCalled();
});
it('background callbacks execute independently and enqueue the next outbox dispatch only after settlement',async()=>{
 job.config.companyBackgroundResearch={version:1,fields:['company_emails'],sourceRootId:'root',profileCapturedAt:new Date().toISOString(),verifyAbn:false};
 mocks.background.mockResolvedValue({accepted:true,status:'complete'});
 expect(await(await call({action:'company-background-research'})).json()).toMatchObject({accepted:true,status:'complete'});
 expect(mocks.background).toHaveBeenCalledWith(job,false);expect(mocks.dispatch).not.toHaveBeenCalled();expect(mocks.company).not.toHaveBeenCalled();expect(mocks.after).toHaveBeenCalledOnce();
});
it('background control uses execution deadline rather than an expired discovery root deadline',async()=>{
 const future=Date.now()+110000;job.config={...job.config,researchRunId:'root',automaticDeadline:future,companyBackgroundResearch:{version:1,fields:['company_emails'],sourceRootId:'root',profileCapturedAt:new Date().toISOString(),verifyAbn:false}};
 mocks.get.mockResolvedValue({...job,id:'root',status:'complete',config:{automaticDeadline:Date.now()-60000}});
 const response=await GET(new Request('http://app/api'),{params:Promise.resolve({jobId})});expect((await response.json()).deadline).toBe(future);
});

it('blocks native root control and every callback before any provider work',async()=>{
 Object.assign(job.config,{nativeAgent:{version:1,providerAdmission:'required'}});
 for(const query of ['', '?control=1'])expect((await GET(new Request('http://app/api'+query),{params:Promise.resolve({jobId})})).status).toBe(403);
 expect((await call({action:'d-search'})).status).toBe(403);
 expect(mocks.company).not.toHaveBeenCalled();expect(mocks.progress).not.toHaveBeenCalled();expect(mocks.background).not.toHaveBeenCalled();
});
it('lean native marker and native-root child provenance cannot bypass provider admission',async()=>{
 Object.assign(job,{nativeAgentJob:true});
 expect((await GET(new Request('http://app/api?control=1'),{params:Promise.resolve({jobId})})).status).toBe(403);
 Object.assign(job,{nativeAgentJob:false});job.config.researchRunId='e1227845-6013-43ed-a38d-c06b8824661f';
 mocks.get.mockResolvedValue({...job,id:job.config.researchRunId,config:{...job.config,nativeAgent:{version:1}}});
 expect((await call({action:'d-search'})).status).toBe(403);expect(mocks.company).not.toHaveBeenCalled();
});

function nativeJob(){mocks.nativeEnabled.mockReturnValue(true);Object.assign(job,{createdBy:'owned-user'});job.config.researchRunId=job.id;job.config.pipelineDesign='firmable-v1';job.config.nativeAgent={version:1,operationId:'700ea5af-232a-41b4-8f3e-d5e25dc75eab',threadId:'a7cb06d3-2f07-4426-bb94-708cd425177c',responsibilityId:'fc12b514-dfd7-42da-98b7-447591464c33',responsibilityRevision:1,mandateRevision:'123',contextRevision:'a'.repeat(64),providerAdmission:'firmable-company-v1'};}
it('permits only current reviewed native Firmable company callbacks and derives the owner on the server',async()=>{
 nativeJob();mocks.company.mockResolvedValue({records:[],totalCompany:0});
 expect((await GET(new Request('http://app/api'),{params:Promise.resolve({jobId})})).status).toBe(200);
 expect((await call({action:'d-search',from:0})).status).toBe(200);expect(mocks.store).toHaveBeenCalledWith({organizationId:'org',userId:'owned-user'});
 expect((await call({action:'e-search',index:0})).status).toBe(403);expect((await call({action:'company-background-research'})).status).toBe(403);expect((await call({action:'company-people-status'})).status).toBe(403);
 mocks.nativeAllowed.mockResolvedValue(false);expect((await call({action:'d-search',from:0})).status).toBe(403);
});
it('reserves native physical requests but rejects scope overrides and secret-bearing receipt bodies',async()=>{
 nativeJob();mocks.nativeBegin.mockResolvedValue({kind:'started',operationId:'a1a639c7-169c-4bcd-893a-991470047023',fence:'1'});
 expect((await call({action:'native-provider-begin',key:'step:0',requestDigest:'b'.repeat(64)})).status).toBe(200);
 expect((await call({action:'native-provider-begin',key:'step:0',requestDigest:'b'.repeat(64),userId:'forged'})).status).toBe(400);
 const base={action:'native-provider-finish',operationId:'a1a639c7-169c-4bcd-893a-991470047023',fence:'1'},outcome={actualCostMicroUsd:null,costBasis:'unknown',response:{status:200,provider:'firmable',requestDigest:'b'.repeat(64)}};
 expect((await call({...base,outcome:{...outcome,response:{...outcome.response,jwt:'must-not-be-saved'}}})).status).toBe(400);
 mocks.nativeAllowed.mockResolvedValue(false);expect((await call({...base,outcome})).status).toBe(200);expect(mocks.nativeFinish).toHaveBeenCalledWith(job.config.nativeAgent!.threadId,base.operationId,'1',outcome,job.config.nativeAgent!.operationId);
});

it('permits only reviewed hybrid company actions and separately admits search/page requests without AI or people authority',async()=>{
 nativeJob();job.config.pipelineDesign='hybrid-firmable-v1';job.config.nativeAgent!.providerAdmission='hybrid-company-v1';mocks.company.mockResolvedValue({queries:[],records:[]});mocks.nativeBegin.mockResolvedValue({kind:'started',operationId:'a1a639c7-169c-4bcd-893a-991470047023',fence:'1'});
 for(const action of ['e-plan','e-search','e-company','f-finish'])expect((await call({action,index:0})).status).toBe(200);
 for(const provider of ['search','page']){expect((await call({action:'native-provider-begin',provider,key:'hybrid:'+provider,requestDigest:'b'.repeat(64)})).status).toBe(200);expect(mocks.nativeBegin).toHaveBeenLastCalledWith(job.config.nativeAgent!.threadId,'hybrid:'+provider,expect.objectContaining({provider,researchJobId:job.id}));}
 for(const action of ['e-finish','company-background-research','company-people-status','native-people-company'])expect((await call({action})).status).toBe(403);
 expect((await call({action:'native-provider-begin',provider:'ai',key:'forged',requestDigest:'b'.repeat(64)})).status).toBe(400);
 job.config.nativeAgent!.providerAdmission='firmable-company-v1';expect((await call({action:'native-provider-begin',provider:'search',key:'forged',requestDigest:'b'.repeat(64)})).status).toBe(403);
 expect(mocks.background).not.toHaveBeenCalled();expect(mocks.people).not.toHaveBeenCalled();
});
it('exposes only the separately reviewed public-field root and forwards its exact company into physical admission',async()=>{nativeJob();job.config.nativeAgent!.providerAdmission='public-fields-v1';const targetId='00000000-0000-4000-8000-000000000088',nativeFieldsPlan=vi.fn().mockResolvedValue({selected:[{targetId}]});mocks.store.mockReturnValue({nativeResearchExecutionAllowed:mocks.nativeAllowed,nativeFieldsPlan,beginNativeResearchAttempt:mocks.nativeBegin});mocks.nativeBegin.mockResolvedValue({kind:'started',operationId:'a1a639c7-169c-4bcd-893a-991470047023',fence:'1'});expect(await(await call({action:'native-fields-plan'})).json()).toEqual({targetIds:[targetId]});expect((await call({action:'native-fields-company',targetId:'forged'})).status).toBe(400);for(const action of['d-search','e-search','company-background-research','native-people-plan'])expect((await call({action})).status).toBe(403);expect((await call({action:'native-provider-begin',provider:'page',targetId,key:'fields:page',requestDigest:'b'.repeat(64)})).status).toBe(200);expect(mocks.nativeBegin).toHaveBeenCalledWith(job.config.nativeAgent!.threadId,'fields:page',expect.objectContaining({targetId,provider:'page'}));});


it('keeps derived physical request classes on native admission and rejects People for company-only V4',async()=>{
 nativeJob();job.config.pipelineDesign='hybrid-firmable-v1';job.config.nativeAgent!.providerAdmission='hybrid-company-v1';
 job.config.companyDiscoveryPolicy={version:4} as ResearchConfig['companyDiscoveryPolicy'];
 mocks.nativeBegin.mockResolvedValue({kind:'started',operationId:'a1a639c7-169c-4bcd-893a-991470047023',fence:'1'});
 for(const requestClass of ['company_search','company_profile','auth']){
  expect((await call({action:'native-provider-begin',key:'class:'+requestClass,requestClass,requestDigest:'b'.repeat(64)})).status).toBe(200);
  expect(mocks.nativeBegin).toHaveBeenLastCalledWith(job.config.nativeAgent!.threadId,'class:'+requestClass,expect.objectContaining({requestClass}));
 }
 mocks.nativeBegin.mockClear();
 for(const requestClass of [undefined,'people_search','person_profile','phone_reveal','unsupported'])expect((await call({action:'native-provider-begin',key:'forbidden',...(requestClass?{requestClass}:{}),requestDigest:'b'.repeat(64)})).status).toBe(403);
 expect(mocks.nativeBegin).not.toHaveBeenCalled();
});

it('loads continuation candidates only through the current native root and never a normal callback',async()=>{mocks.nativeEnabled.mockReturnValue(true);const threadId='00000000-0000-4000-8000-000000000008',operationId='00000000-0000-4000-8000-000000000009';job.config={...job.config,researchRunId:jobId,nativeAgent:{version:1,contextRevision:'a'.repeat(64),threadId,operationId,responsibilityId:threadId,responsibilityRevision:1,mandateRevision:'1',providerAdmission:'hybrid-company-v1'},companyContinuation:{version:1,sourceRootId:threadId,sourceDigest:'a'.repeat(64),candidateKeys:['firmable:f1']}};const selected={version:1,sourceRootId:threadId,sourceDigest:'a'.repeat(64),candidates:[{candidateKey:'firmable:f1',domain:'company.example',sources:['firmable'],firmableRow:{id:'f1',website:'company.example'}}]};mocks.nativeContinuation.mockResolvedValue(selected);const response=await call({action:'f-continuation-plan'});expect(response.status).toBe(200);expect(await response.json()).toEqual(selected);expect(mocks.nativeContinuation).toHaveBeenCalledExactlyOnceWith(threadId,operationId);expect(mocks.company).not.toHaveBeenCalled();job.config={...config};expect((await call({action:'f-continuation-plan'})).status).toBe(403);});

it('observes persisted company results in chat only after the callback has completed',async()=>{
 mocks.company.mockResolvedValue({ok:true});expect((await call({action:'d-company',row:{id:'f123'}})).status).toBe(200);expect(mocks.observeInitial).not.toHaveBeenCalled();
 await mocks.after.mock.calls[0][0]();expect(mocks.observeInitial).toHaveBeenCalledWith(job);
});
it('observes a new persisted progress transition but never a rejected progress write',async()=>{
 expect((await call(event)).status).toBe(200);for(const [work]of mocks.after.mock.calls)await work();expect(mocks.observeInitial).toHaveBeenCalledOnce();
 mocks.after.mockClear();mocks.observeInitial.mockClear();mocks.progress.mockRejectedValue(Error('write failed'));expect((await call({...event,revision:2})).status).toBe(409);expect(mocks.after).not.toHaveBeenCalled();expect(mocks.observeInitial).not.toHaveBeenCalled();
});
it('returns a structured Firmable reconnect blocker instead of a retryable HTML server error',async()=>{
 mocks.company.mockRejectedValueOnce(new FirmableError('/company',401,'private-cookie-value',undefined,'reconnect_required'));
 const response=await call({action:'e-company',row:{id:'f123'}});expect(response.status).toBe(401);expect(response.headers.get('content-type')).toContain('application/json');expect(await response.json()).toEqual({provider:'firmable',category:'reconnect_required',error:'The Firmable connection needs renewal.'});expect(mocks.after).not.toHaveBeenCalled();
});

it.each([false,true])('returns scoped execution progress for the worker fresh stalled check (lean=%s)',async lean=>{
 job.updatedAt=new Date('2026-10-26T01:51:00Z');job.executionUpdatedAt=new Date('2026-10-26T02:04:30Z');
 const response=await GET(new Request('http://app/api'+(lean?'?control=1':'')),{params:Promise.resolve({jobId})});
 expect(await response.json()).toMatchObject({updatedAt:'2026-10-26T01:51:00.000Z',executionUpdatedAt:'2026-10-26T02:04:30.000Z'});
 expect(mocks.select.mock.calls[0][0]).toHaveProperty('executionUpdatedAt');
});
