import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), create: vi.fn(), get: vi.fn(), worker: vi.fn(), cancel: vi.fn(), update: vi.fn(), writes: [] as Record<string, unknown>[], guards: [] as unknown[] }));
vi.mock('./research-scheduling-snapshot', () => ({ loadResearchSchedulingSnapshot: mocks.snapshot }));
vi.mock('@/db/research-repository', () => ({ ResearchRepository: class { create = mocks.create; getExecution = mocks.get; cancelRun = mocks.cancel; } }));
vi.mock('./research-service', () => ({ researchWorker: mocks.worker }));
vi.mock('@/db/client', () => ({ requireDb: () => ({ update: mocks.update }) }));
import { dispatchBalancedBusinessResearch } from './balanced-business-research';
import type { ResearchSchedulingSnapshot } from './research-scheduling-snapshot';
function setup() {
  const root = { id: 'root', status: 'partial', mandateId: 'mandate', createdBy: 'user', seeds: ['https://firecentral.com.au/', 'https://www.firecentral.com.au/about', 'https://other.example.com/'], config: { parallelBusinessResearch: true, geography: 'VIC', searchTerms: ['fire protection'], findPeople: true, automaticDeadline: Date.now() + 3600000, automaticPageLimit: 100 } };
  return { root, jobs: [root], members: [{ target: { id: 'fire', domain: 'firecentral.com.au', companyName: 'Fire Central Pty Ltd', state: 'VIC', suburb: 'Carlton' }, assessment: { stage: 'identified' } }], findings: [], dispatched: new Set<string>() } as unknown as ResearchSchedulingSnapshot;
}
beforeEach(() => { vi.resetAllMocks(); mocks.writes.length=0; mocks.guards.length=0; mocks.update.mockReturnValue({set:(fields:Record<string,unknown>)=>{mocks.writes.push(fields);return {where:async(guard:unknown)=>{mocks.guards.push(guard);}};}}); mocks.create.mockImplementation(async (id, mandateId, createdBy, config) => ({ id, mandateId, createdBy, config, seeds: config.seeds, status: 'queued' })); mocks.get.mockResolvedValue({ status: 'partial' }); });
it('dispatches every objective in the first refill rather than a website wave',async()=>{
 const snapshot=setup();await dispatchBalancedBusinessResearch('org','root',snapshot);
 const first=mocks.create.mock.calls.slice(0,6).map(c=>c[3].researchField||c[3].researchTask);
 expect(new Set(first)).toEqual(new Set(['website','abn','size','revenue','people','email']));
 const count=mocks.create.mock.calls.length;await dispatchBalancedBusinessResearch('org','root',snapshot);expect(mocks.create).toHaveBeenCalledTimes(count);
});
it('starts later objectives even when ABN jobs are waiting on a slow provider',async()=>{
 const snapshot=setup();snapshot.jobs.push({id:'old-abn',status:'extracting',config:{researchRunId:'root',researchTask:'field',researchField:'abn',companyDomain:'slow.example.com',executionSlot:'mandate:parallel-1'}} as unknown as ResearchSchedulingSnapshot['jobs'][number]);
 await dispatchBalancedBusinessResearch('org','root',snapshot);
 expect(mocks.create.mock.calls.slice(0,4).map(c=>c[3].researchField||c[3].researchTask)).toContain('size');
});
