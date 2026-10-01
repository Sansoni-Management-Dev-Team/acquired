import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ findings: [] as unknown[], relevant: false, reconcile: vi.fn(async () => {}) }));
vi.mock('./client', () => ({ requireDb: vi.fn() }));
vi.mock('./research-reconciliation', () => ({ reconcileResearchTarget: mocks.reconcile }));
vi.mock('@/domain/business-research', () => ({ ownCompany: () => undefined, relevantBusiness: () => mocks.relevant, validateBusinessFindings: () => mocks.findings }));
import { PgDialect } from 'drizzle-orm/pg-core';
import { ResearchRepository } from './research-repository';
import type { ResearchConfig } from '@/domain/research';
const config = { approved: true, workflow: 'business', discover: false, searchTerms: [], geography: 'Australia', seeds: [], budget: { maxPages: 10, maxModelCalls: 10, maxDomains: 10, maxMinutes: 15 } } as ResearchConfig;
const job = { id: '00000000-0000-4000-8000-000000000001', organizationId: 'org', mandateId: 'mandate', status: 'queued', revision: 0, pages: 0, modelCalls: 0, createdAt: new Date(), updatedAt: new Date(), config, seeds: [], crawlId: null, createdBy: 'actor' };
it('reconciles saved company observations before acknowledging page progress', async () => {
 const f = fixture(); mocks.reconcile.mockClear();
 mocks.findings = [{ kind: 'headcount', name: 'Headcount', value: '50 employees', quote: 'We employ 50 employees.', website: 'https://example.com/' }];
 await new ResearchRepository('org', f.db as never).progress(job.id, { message: 'Reading', status: 'crawling', revision: 1, pages: 1, modelCalls: 0, page: { url: 'https://example.com/', observedAt: new Date().toISOString(), markdown: 'We employ 50 employees.', findings: mocks.findings as never, truncated: false } }, job as never);
 expect(mocks.reconcile).toHaveBeenCalledWith(f.db, 'org', 'existing-target');
 expect(f.values.mock.invocationCallOrder[0]).toBeLessThan(mocks.reconcile.mock.invocationCallOrder[0]);
});
function fixture() {
 const insert = vi.fn(() => ({ values: values, onConflictDoNothing: async () => {} }));
 const values = vi.fn((rows: unknown) => { void rows; return { onConflictDoNothing: async () => {} }; });
 const conditions: unknown[] = [];
 const writes: Record<string, unknown>[] = [];
 const updated = { ...job, message: 'Reading', status: 'crawling', revision: 1, pages: 1, modelCalls: 1 };
 const update = vi.fn(() => ({ set: (fields: Record<string, unknown>) => { writes.push(fields); return ({ where: (condition: unknown) => { conditions.push(condition); return { returning: async () => [updated], then: (yes: (v: unknown) => void) => Promise.resolve([]).then(yes) }; } }); } }));
 const selections: unknown[] = [];
 const select = vi.fn((projection: unknown) => {
  selections.push(projection);
  const q = { from: () => q, innerJoin: () => q, where: () => q, limit: async () => projection && !('config' in (projection as object)) ? [{ id: 'existing-target' }] : [job] }; return q;
 });
 return { db: { select, insert, update }, select, values, conditions, writes, updated };
}
it('batches a page’s findings and returns the updated row without another job read', async () => {
 const f = fixture();
 mocks.findings = [{ kind: 'product', name: 'Pumps', quote: 'We manufacture pumps.' }, { kind: 'capability', name: 'Fabrication', quote: 'We fabricate equipment.' }];
 const repo = new ResearchRepository('org', f.db as never);
 const saved = await repo.progress(job.id, { message: 'Reading', status: 'crawling', revision: 1, pages: 1, modelCalls: 1, page: { url: 'https://example.com/', observedAt: new Date().toISOString(), markdown: 'We manufacture pumps. We fabricate equipment.', findings: mocks.findings as never, truncated: false } });
 expect(f.values).toHaveBeenCalledTimes(1);
 expect(f.values.mock.calls[0][0]).toHaveLength(2);
 expect(saved).toEqual(f.updated);
 expect(f.select).toHaveBeenCalledTimes(2); // Initial job + target lookup, no post-save reread.
 expect(new PgDialect().sqlToQuery(f.conditions[0] as never).sql).toContain('"revision" <');
});
it('uses an authenticated snapshot and ignores duplicate revisions without writing', async () => {
 const f = fixture(); const repo = new ResearchRepository('org', f.db as never);
 const event = { message: 'Reading', status: 'crawling' as const, revision: 0, pages: 0, modelCalls: 0 };
 const saved = await repo.progress(job.id, event, job as never);
 expect(f.select).not.toHaveBeenCalled(); expect(f.db.update).not.toHaveBeenCalled(); expect(saved).toEqual(job);
});
it('rejects a snapshot from another organization or job before writing', async () => {
 const f = fixture(); const repo = new ResearchRepository('org', f.db as never);
 await expect(repo.progress(job.id, { message: 'Reading', status: 'crawling', revision: 1, pages: 1, modelCalls: 1 }, { ...job, organizationId: 'other-org' } as never)).rejects.toThrow();
 expect(f.db.update).not.toHaveBeenCalled();
});

it('merges runtime into the current database config, preserving scheduling and timing metadata', async () => {
 const f = fixture();
 const repo = new ResearchRepository('org', f.db as never);
 await repo.progress(job.id, { message: 'Reading', status: 'crawling', revision: 1, pages: 0, modelCalls: 0, runtime: { attempts: [], seen: [], pending: [] } } as never, job as never);
 const query = new PgDialect().sqlToQuery(f.writes[0].config as never);
 expect(query.sql).toContain('jsonb_set("research_jobs"."config"');
 expect(query.sql).not.toContain('scheduling');
 expect(query.params).toContain(JSON.stringify({ attempts: [], seen: [], pending: [] }));
});
it('rejects over-budget updates before saving findings or changing progress', async () => {
 const f = fixture();
 await expect(new ResearchRepository('org', f.db as never).progress(job.id, { message: 'Reading', status: 'crawling', revision: 1, pages: 11, modelCalls: 0 }, job as never)).rejects.toThrow('Research budget exceeded');
 expect(f.values).not.toHaveBeenCalled();
 expect(f.db.update).not.toHaveBeenCalled();
});
it('retains the progress revision when bulk evidence persistence fails, allowing retry', async () => {
 const f = fixture();
 f.values.mockImplementationOnce((rows: unknown) => { void rows; return { onConflictDoNothing: async () => { throw new Error('insert failed'); } }; });
 mocks.findings = [{ kind: 'product', name: 'Pumps', quote: 'We manufacture pumps.' }];
 await expect(new ResearchRepository('org', f.db as never).progress(job.id, { message: 'Reading', status: 'crawling', revision: 1, pages: 1, modelCalls: 1, page: { url: 'https://example.com/', observedAt: new Date().toISOString(), markdown: 'We manufacture pumps.', findings: mocks.findings as never, truncated: false } }, job as never)).rejects.toThrow('insert failed');
 expect(f.db.update).not.toHaveBeenCalled();
});
it.each(['cancelled','complete','failed','partial'])('ignores progress for a terminal %s snapshot without side effects',async status=>{
 const f=fixture();const terminal={...job,status};
 const saved=await new ResearchRepository('org',f.db as never).progress(job.id,{message:'Late page',status:'crawling',revision:5,pages:1,modelCalls:1},terminal as never);
 expect(saved).toBe(terminal);expect(f.select).not.toHaveBeenCalled();expect(f.db.update).not.toHaveBeenCalled();expect(f.values).not.toHaveBeenCalled();
});
it('never replaces newer revisions or resurrects a concurrently cancelled job',async()=>{
 let current={...job,status:'crawling',message:'Reading'};
 const writes:Record<string,unknown>[]=[];const conditions:unknown[]=[];
 const db={
  select:()=>{const q={from:()=>q,where:()=>q,limit:async()=>[current]};return q;},
  update:()=>({set:(fields:Record<string,unknown>)=>({where:(condition:unknown)=>({returning:async()=>{
   conditions.push(condition);
   if(current.status==='cancelled' || (fields.revision as number)<=current.revision) return [];
   writes.push(fields);current={...current,...fields} as typeof current;return [current];
  }})})}),
 };
 const repo=new ResearchRepository('org',db as never);
 await repo.progress(job.id,{message:'Newer',status:'extracting',revision:2,pages:2,modelCalls:2},job as never);
 await repo.progress(job.id,{message:'Older',status:'crawling',revision:1,pages:1,modelCalls:1},job as never);
 expect(current.revision).toBe(2);expect(current.message).toBe('Newer');expect(writes).toHaveLength(1);
 current={...current,status:'cancelled',message:'Stopped'};
 const saved=await repo.progress(job.id,{message:'Late',status:'crawling',revision:3,pages:3,modelCalls:3},job as never);
 expect(saved?.status).toBe('cancelled');expect(current.message).toBe('Stopped');expect(writes).toHaveLength(1);
 const guard=new PgDialect().sqlToQuery(conditions.at(-1) as never);
 expect(guard.sql).toContain('"revision" <');expect(guard.sql).toContain('"status" not in');expect(guard.params).toContain('cancelled');
});

it('does not acknowledge a qualifying company before its findings are durable', async () => {
 const f=fixture();const repo=new ResearchRepository('org',f.db as never);const count=vi.spyOn(repo,'recordNewBusiness').mockResolvedValue(undefined);
 mocks.relevant=true;mocks.findings=[{kind:'product',name:'Pumps',quote:'We manufacture pumps.'}];
 f.values.mockImplementationOnce(()=>({onConflictDoNothing:async()=>{throw new Error('insert failed');}}));
 try {
  await expect(repo.progress(job.id,{message:'Reading',status:'crawling',revision:1,pages:1,modelCalls:1,page:{url:'https://example.com',observedAt:new Date().toISOString(),markdown:'We manufacture pumps.',findings:mocks.findings as never,truncated:false}},job as never)).rejects.toThrow('insert failed');
  expect(count).not.toHaveBeenCalled();expect(f.db.update).not.toHaveBeenCalled();
 } finally {mocks.relevant=false;}
});

it.each(['website','page'] as const)('credits a parallel %s discovery to the root with an atomic distinct merge and root milestone guard',async researchTask=>{
 const f=fixture();f.db.select=vi.fn(()=>{const q={from:()=>q,where:()=>q,limit:async()=>[{createdAt:new Date('2026-01-02T00:00:00Z')}]};return q;}) as never;
 const child={...job,config:{...config,researchTask,parallelBusinessResearch:true,researchRunId:'root-id',targetBusinesses:1,businessTargetStartedAt:'2026-01-01T00:00:00Z'}};
 await new ResearchRepository('org',f.db as never).recordNewBusiness(job.id,'target-id',child as never);
 const guard=new PgDialect().sqlToQuery(f.conditions[0] as never);
 expect(guard.params).toContain('root-id');expect(guard.params).toContain('org');
 const merge=new PgDialect().sqlToQuery(f.writes[0].config as never);
 expect(merge.sql).toContain('jsonb_agg(DISTINCT value)');expect(merge.sql).toContain('"research_jobs"."config"');
 expect(merge.sql).toContain("->>'targetBusinesses'");expect(merge.params).toContain('["target-id"]');
});

it.each([true, false])('persists targeted capacity recovery flag %s without replacing current config', async targetedSearchDeferred => {
 const f = fixture();
 await new ResearchRepository('org', f.db as never).progress(job.id, { status: 'partial', message: 'Capacity checkpoint', revision: 1, pages: 0, modelCalls: 0, targetedSearchDeferred }, job as never);
 const query = new PgDialect().sqlToQuery(f.writes[0].config as never);
 expect(query.sql).toContain('jsonb_set');
 expect(query.params).toContain('targetedSearchDeferred');
 expect(query.params).toContain(JSON.stringify(targetedSearchDeferred));
});

it.each([true, false])('merges follow-up planner attempt flag %s without replacing current config', async followupPlannerUsed => {
 const f = fixture();
 await new ResearchRepository('org', f.db as never).progress(job.id, { status: 'partial', message: 'Planner checkpoint', revision: 1, pages: 0, modelCalls: 1, followupPlannerUsed }, job as never);
 const query = new PgDialect().sqlToQuery(f.writes[0].config as never);
 expect(query.sql).toContain('jsonb_set');
 expect(query.params).toContain('followupPlannerUsed');
 expect(query.params).toContain(JSON.stringify(followupPlannerUsed));
});
