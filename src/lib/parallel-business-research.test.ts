import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), create: vi.fn(), get: vi.fn(), worker: vi.fn(), cancel: vi.fn(), update: vi.fn(), writes: [] as Record<string, unknown>[], guards: [] as unknown[] }));
vi.mock('./research-scheduling-snapshot', () => ({ loadResearchSchedulingSnapshot: mocks.snapshot }));
vi.mock('@/db/research-repository', () => ({ ResearchRepository: class { create = mocks.create; getExecution = mocks.get; cancelRun = mocks.cancel; } }));
vi.mock('./research-service', () => ({ researchWorker: mocks.worker }));
vi.mock('@/db/client', () => ({ requireDb: () => ({ update: mocks.update }) }));
import { dispatchParallelBusinessResearch, parallelBusinessTasks, PARALLEL_RESEARCH_JOBS, registerWebsitePages } from './parallel-business-research';
import type { ResearchSchedulingSnapshot } from './research-scheduling-snapshot';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { ResearchConfig } from '@/domain/research';
function setup() {
  const root = { id: 'root', status: 'partial', mandateId: 'mandate', createdBy: 'user', seeds: ['https://firecentral.com.au/', 'https://www.firecentral.com.au/about', 'https://other.example.com/'], config: { parallelBusinessResearch: true, geography: 'VIC', searchTerms: ['fire protection'], findPeople: true, automaticDeadline: Date.now() + 3600000, automaticPageLimit: 100 } };
  return { root, jobs: [root], members: [{ target: { id: 'fire', domain: 'firecentral.com.au', companyName: 'Fire Central Pty Ltd', state: 'VIC', suburb: 'Carlton' }, assessment: { stage: 'identified' } }], findings: [], dispatched: new Set<string>() } as unknown as ResearchSchedulingSnapshot;
}
beforeEach(() => { vi.resetAllMocks(); mocks.writes.length=0; mocks.guards.length=0; mocks.update.mockReturnValue({set:(fields:Record<string,unknown>)=>{mocks.writes.push(fields);return {where:async(guard:unknown)=>{mocks.guards.push(guard);}};}}); mocks.create.mockImplementation(async (id, mandateId, createdBy, config) => ({ id, mandateId, createdBy, config, seeds: config.seeds, status: 'queued' })); mocks.get.mockResolvedValue({ status: 'partial' }); });
it('fans out imported Fire Central immediately, without relevance findings, and deduplicates www and paths', () => {
  const tasks = parallelBusinessTasks(setup());
  expect(tasks.filter(t => t.config.companyDomain === 'firecentral.com.au')).toHaveLength(6);
  expect(tasks.filter(t => t.config.companyDomain === 'firecentral.com.au').map(t => t.config.researchField || t.config.researchTask)).toEqual(['website', 'abn', 'size', 'revenue', 'people', 'email']);
  expect(tasks.find(t => t.config.researchField === 'abn')!.config).toMatchObject({ companyName: 'Fire Central Pty Ltd', targetId: 'fire', targetedFollowup: true, seeds: [] });
  expect(new Set(tasks.map(t => t.id)).size).toBe(tasks.length);
});
it('gives every unique sitemap page an independent job without recursive scraping', () => {
  const snapshot = setup();
  snapshot.jobs.push({ id: 'website', config: { researchTask: 'website', researchRunId: 'root', companyDomain: 'firecentral.com.au', websitePages: ['https://firecentral.com.au/', 'https://firecentral.com.au/team', 'https://firecentral.com.au/team#staff', 'https://firecentral.com.au/products'] }, seeds: [] } as unknown as ResearchSchedulingSnapshot['jobs'][number]);
  const tasks = parallelBusinessTasks(snapshot);
  expect(tasks.filter(t => t.config.researchTask === 'page')).toHaveLength(2);
  expect(tasks.filter(t => t.config.researchTask === 'page').every(t => !t.config.discover && !t.config.discoveryCandidate && t.config.budget.maxPages === 1)).toBe(true);
  expect(tasks.findIndex(t => t.config.researchTask === 'page')).toBe(12);
});
it('starts independent jobs concurrently, is idempotent on replay and refills only released slots', async () => {
  const snapshot = setup(); mocks.snapshot.mockResolvedValue(snapshot);
  await dispatchParallelBusinessResearch('org', 'root');
  expect(mocks.create).toHaveBeenCalledTimes(12);
  expect(mocks.worker).toHaveBeenCalledTimes(12);
  await dispatchParallelBusinessResearch('org', 'root');
  expect(mocks.create).toHaveBeenCalledTimes(12); expect(mocks.worker).toHaveBeenCalledTimes(12);
});
it('bounds active work, retries failed dispatches, and starts no work after cancellation or expiry', async () => {
  const snapshot = setup(); snapshot.root.seeds = Array.from({ length: 40 }, (_, i) => `https://business${i}.example.com/`);
  mocks.worker.mockRejectedValueOnce(new Error('unavailable'));
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    await dispatchParallelBusinessResearch('org', 'root', snapshot);
    expect(mocks.create).toHaveBeenCalledTimes(PARALLEL_RESEARCH_JOBS);
    expect(snapshot.dispatched.size).toBe(PARALLEL_RESEARCH_JOBS - 1);
    await dispatchParallelBusinessResearch('org', 'root', snapshot);
    expect(snapshot.dispatched.size).toBe(PARALLEL_RESEARCH_JOBS);
    const active = snapshot.jobs.find(j => j.id !== 'root')!; active.status = 'complete';
    await dispatchParallelBusinessResearch('org', 'root', snapshot);
    expect(mocks.create).toHaveBeenCalledTimes(PARALLEL_RESEARCH_JOBS + 1);
    snapshot.root.status = 'cancelled';
    await dispatchParallelBusinessResearch('org', 'root', snapshot);
    expect(mocks.create).toHaveBeenCalledTimes(PARALLEL_RESEARCH_JOBS + 1);
    snapshot.root.status = 'partial'; (snapshot.root.config as ResearchConfig).automaticDeadline = 0;
    await dispatchParallelBusinessResearch('org', 'root', snapshot);
    expect(mocks.create).toHaveBeenCalledTimes(PARALLEL_RESEARCH_JOBS + 1);
  } finally { log.mockRestore(); }
});

it('cleans up children created during a root cancellation race before dispatch',async()=>{
 const snapshot=setup();mocks.get.mockResolvedValue({...snapshot.root,status:'cancelled'});
 await dispatchParallelBusinessResearch('org','root',snapshot);
 expect(mocks.create).toHaveBeenCalled();expect(mocks.cancel).toHaveBeenCalledWith('root');expect(mocks.worker).not.toHaveBeenCalled();
});

it('carries the root business goal and start through website and page tasks so discoveries count against the run', () => {
 const snapshot=setup();snapshot.root.createdAt=new Date('2026-01-01T00:00:00Z');
 Object.assign(snapshot.root.config as ResearchConfig,{targetBusinesses:1,businessTargetStartedAt:'2025-12-31T23:59:00Z',newBusinessIds:['saved']});
 snapshot.jobs.push({id:'website',config:{researchTask:'website',researchRunId:'root',companyDomain:'firecentral.com.au',websitePages:['https://firecentral.com.au/team']},seeds:[]} as unknown as ResearchSchedulingSnapshot['jobs'][number]);
 const tasks=parallelBusinessTasks(snapshot);
 for(const task of tasks.filter(t=>t.config.researchTask!=='field')) expect(task.config).toMatchObject({targetBusinesses:1,businessTargetStartedAt:'2025-12-31T23:59:00Z',newBusinessIds:['saved']});
});
it('after reaching the goal finishes admitted domains and imported businesses without admitting new seed domains',()=>{
 const snapshot=setup();Object.assign(snapshot.root.config as ResearchConfig,{targetBusinesses:1,newBusinessIds:['saved']});
 snapshot.jobs.push({id:'website',config:{researchTask:'website',researchRunId:'root',companyDomain:'other.example.com'},seeds:['https://other.example.com/']} as unknown as ResearchSchedulingSnapshot['jobs'][number]);
 (snapshot.root.seeds as string[]).push('https://new.example.com/');
 expect(new Set(parallelBusinessTasks(snapshot).map(t=>t.config.companyDomain))).toEqual(new Set(['firecentral.com.au','other.example.com']));
});

it('atomically marks exhausted parallel work settled only under its current generation and no active child guard',async()=>{
 const snapshot=setup();snapshot.schedulingLease={owner:'lease-owner',generation:4};
 snapshot.jobs.push(...parallelBusinessTasks(snapshot).map(t=>({id:t.id,status:'complete',config:t.config,seeds:t.config.seeds})) as ResearchSchedulingSnapshot['jobs']);
 mocks.get.mockResolvedValue(snapshot.root);
 await dispatchParallelBusinessResearch('org','root',snapshot);
 expect(mocks.create).not.toHaveBeenCalled();expect(mocks.writes).toHaveLength(1);
 const patch=new PgDialect().sqlToQuery(mocks.writes[0].config as never);
 expect(patch.sql).toContain('parallelResearchPendingTasks');expect(patch.params).toContain(0);expect(patch.params).toContain(true);
 const guard=new PgDialect().sqlToQuery(mocks.guards[0] as never);
 expect(guard.sql).toContain('NOT EXISTS');expect(guard.sql).toContain("->>'generation'");expect(guard.sql).toContain("->>'expiresAt'");expect(guard.sql).toContain("- 'pipelineTiming' - 'scheduling'");expect(guard.params).toContain('lease-owner');expect(guard.params).toContain(4);
});
it('keeps an unscheduled admissible task recoverable after a slot conflict',async()=>{
 const snapshot=setup();mocks.create.mockRejectedValue(new Error('Another research job is active. Wait for it to finish or cancel it.'));mocks.get.mockResolvedValue(snapshot.root);
 await dispatchParallelBusinessResearch('org','root',snapshot);
 const patch=new PgDialect().sqlToQuery(mocks.writes[0].config as never);expect(patch.params).toContain(12);expect(patch.params).toContain(false);
});

function pageSnapshot(domains = 3, pages = 100) {
 const snapshot = setup(); snapshot.members = []; snapshot.root.seeds = Array.from({length:domains},(_,i)=>`https://business${i}.example.com/`);
 Object.assign(snapshot.root.config as ResearchConfig,{automaticPageLimit:6,discoveryPending:false});
 const primary=parallelBusinessTasks(snapshot);
 snapshot.jobs.push(...primary.map(t=>({id:t.id,status:'complete',seeds:t.config.seeds,config:{...t.config,...(t.config.researchTask==='website'?{websitePages:Array.from({length:pages},(_,i)=>`https://${t.config.companyDomain}/articles/${i}`)}:{})}})) as ResearchSchedulingSnapshot['jobs']);
 return snapshot;
}
it('allocates a finite page budget evenly across businesses rather than exhausting the first sitemap',async()=>{
 const snapshot=pageSnapshot(); await dispatchParallelBusinessResearch('org','root',snapshot);
 const domains=mocks.create.mock.calls.map(c=>c[3].companyDomain);
 expect(domains).toEqual(['business0.example.com','business1.example.com','business2.example.com','business0.example.com','business1.example.com','business2.example.com']);
});
it('reserves initial page coverage for businesses whose sitemap arrives later and resumes deterministically',async()=>{
 const snapshot=pageSnapshot(2); Object.assign(snapshot.root.config as ResearchConfig,{automaticPageLimit:300,discoveryPending:true});
 const second=snapshot.jobs.find(j=>(j.config as ResearchConfig).researchTask==='website'&&(j.config as ResearchConfig).companyDomain==='business1.example.com')!;
 second.status='running';(second.config as ResearchConfig).websitePages=[];
 await dispatchParallelBusinessResearch('org','root',snapshot);
 expect(mocks.create.mock.calls.filter(c=>c[3].researchTask==='page')).toHaveLength(3);
 second.status='complete';(second.config as ResearchConfig).websitePages=['https://business1.example.com/about'];
 await dispatchParallelBusinessResearch('org','root',snapshot);
 expect(mocks.create.mock.calls.at(-1)![3].companyDomain).toBe('business1.example.com');
});
it('prioritises core pages before a long article sitemap and preserves excess tasks for later budgets',()=>{
 const snapshot=pageSnapshot(1,150);const website=snapshot.jobs.find(j=>(j.config as ResearchConfig).researchTask==='website')!;
 (website.config as ResearchConfig).websitePages!.push('https://business0.example.com/contact','https://business0.example.com/managing-board','https://business0.example.com/privacy-policy.pdf');
 const pages=parallelBusinessTasks(snapshot).filter(t=>t.config.researchTask==='page');
 expect(pages).toHaveLength(153);
 expect(pages.slice(0,3).map(t=>t.config.seeds[0])).toEqual(['https://business0.example.com/contact','https://business0.example.com/managing-board','https://business0.example.com/privacy-policy.pdf']);
});
it('keeps website and field capacity available while sitemap core pages start',async()=>{
 const snapshot=pageSnapshot(12);snapshot.jobs=snapshot.jobs.filter(j=>j.id==='root'||(j.config as ResearchConfig).researchTask==='website');
 for(const j of snapshot.jobs.filter(j=>(j.config as ResearchConfig).researchTask==='website'))(j.config as ResearchConfig).websitePages=['https://'+(j.config as ResearchConfig).companyDomain+'/contact'];
 Object.assign(snapshot.root.config as ResearchConfig,{automaticPageLimit:300,discoveryPending:true});
 await dispatchParallelBusinessResearch('org','root',snapshot);
 expect(mocks.create.mock.calls.filter(c=>c[3].researchTask==='page')).toHaveLength(8);
 expect(mocks.create.mock.calls.filter(c=>c[3].researchTask==='field')).toHaveLength(24);
});

it('preserves registration order atomically without truncating retained URLs',async()=>{
 const snapshot=pageSnapshot(1,150),website=snapshot.jobs.find(j=>(j.config as ResearchConfig).researchTask==='website')!;
 website.status='running';
 await registerWebsitePages('org',website,['https://business0.example.com/articles/z','https://business0.example.com/contact','https://business0.example.com/contact#staff']);
 const query=new PgDialect().sqlToQuery(mocks.writes[0].config as never);
 expect(query.sql).toContain('WITH ORDINALITY');expect(query.sql).toContain('ORDER BY first_position');expect(query.sql).not.toContain('LIMIT');
 expect(query.params).toContain(JSON.stringify(['https://business0.example.com/contact','https://business0.example.com/articles/z']));
});
it('respects the 100 page execution cap while retaining and reporting unscheduled URLs',async()=>{
 const snapshot=pageSnapshot(1,150);Object.assign(snapshot.root.config as ResearchConfig,{automaticPageLimit:300});
 const pageTasks=parallelBusinessTasks(snapshot).filter(t=>t.config.researchTask==='page');
 snapshot.jobs.push(...pageTasks.slice(0,100).map(t=>({id:t.id,status:'complete',config:t.config,seeds:t.config.seeds})) as ResearchSchedulingSnapshot['jobs']);
 mocks.get.mockResolvedValue(snapshot.root);await dispatchParallelBusinessResearch('org','root',snapshot);
 expect(mocks.create).not.toHaveBeenCalled();expect(mocks.writes[0].message).toContain('50 jobs remain outside the current budget');
});
it('resumes a larger global budget fairly without duplicate page jobs',async()=>{
 const snapshot=pageSnapshot(3,10);await dispatchParallelBusinessResearch('org','root',snapshot);
 for(const j of snapshot.jobs)j.status='complete';Object.assign(snapshot.root.config as ResearchConfig,{automaticPageLimit:9});
 await dispatchParallelBusinessResearch('org','root',snapshot);
 expect(mocks.create.mock.calls.slice(6).map(c=>c[3].companyDomain)).toEqual(['business0.example.com','business1.example.com','business2.example.com']);
 expect(new Set(mocks.create.mock.calls.map(c=>c[0])).size).toBe(9);
});

it('gives all 90 businesses coverage within a 300 page budget across repeated refill callbacks',async()=>{
 const snapshot=pageSnapshot(90,100);Object.assign(snapshot.root.config as ResearchConfig,{automaticPageLimit:300});
 for(let refill=0;refill<11;refill++){
  await dispatchParallelBusinessResearch('org','root',snapshot);
  for(const j of snapshot.jobs)j.status='complete';
 }
 const counts=new Map<string,number>();for(const call of mocks.create.mock.calls)counts.set(call[3].companyDomain,(counts.get(call[3].companyDomain)||0)+1);
 expect(mocks.create).toHaveBeenCalledTimes(300);expect(counts.size).toBe(90);expect(Math.min(...counts.values())).toBe(3);expect(Math.max(...counts.values())).toBe(4);
});

it('reports admissible jobs awaiting scheduling separately from work outside the budget after a slot conflict',async()=>{
 const snapshot=setup();mocks.create.mockRejectedValue(new Error('Another research job is active. Wait for it to finish or cancel it.'));mocks.get.mockResolvedValue(snapshot.root);
 await dispatchParallelBusinessResearch('org','root',snapshot);
 expect(mocks.writes[0].message).toContain('12 jobs await scheduling');
 expect(mocks.writes[0].message).not.toContain('outside the current budget');
});
