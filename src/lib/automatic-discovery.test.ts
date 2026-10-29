import { beforeEach, expect, it, vi } from 'vitest';
// Scheduling scan assertions exclude timing persistence, which has separate
// saved-job authority coverage in research-timing-workflow-context.test.ts.
vi.mock('@/db/research-timing-repository', () => ({ saveResearchTimingSpans: async () => undefined }));
const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), cancelRun: vi.fn(), cancelDiscoveryCandidates: vi.fn(), where: vi.fn(), worker: vi.fn() }));
vi.mock('@/db/client', () => ({ requireDb: () => ({ select: () => ({ from: () => ({ where: mocks.where }) }) }) }));
vi.mock('@/db/research-repository', () => ({ ResearchRepository: class { get = mocks.get; create = mocks.create; cancelRun = mocks.cancelRun; cancelDiscoveryCandidates = mocks.cancelDiscoveryCandidates; } }));
vi.mock('./research-service', () => ({ researchWorker: mocks.worker }));
import { dispatchDiscoveryCandidates, rankDiscoveryCandidateUrls } from './automatic-discovery';
import { DISCOVERY_CANDIDATE_LIMIT } from '@/domain/automatic-research';
const seeds = Array.from({ length: 25 }, (_, i) => `https://instruments${i}.example.com/`);
const root = { id: 'root', status: 'discovering', mandateId: 'mandate', createdBy: 'user', seeds, config: { parallelDiscovery: true, targetBusinesses: 20, automaticDeadline: Date.now() + 3600000, automaticPageLimit: 100, businessTargetStartedAt: new Date().toISOString(), seeds: [], budget: { maxPages: 10 } } };
beforeEach(() => { vi.resetAllMocks(); mocks.get.mockResolvedValue(root); mocks.where.mockResolvedValue([root]); mocks.create.mockImplementation(async id => ({ id, status: 'queued' })); });
it('fans out eight websites and refills them as completion releases capacity', async () => {
  await dispatchDiscoveryCandidates('org', 'root');
  expect(mocks.create).toHaveBeenCalledTimes(8);
  expect(new Set(mocks.create.mock.calls.map(c => c[3].companyDomain)).size).toBe(8);
  expect(mocks.create.mock.calls.every(c => c[3].discoveryCandidate && !c[3].discover && c[3].budget.maxDomains === 1)).toBe(true);
  expect(mocks.worker).toHaveBeenCalledTimes(8);
});
it('keeps discovery full while enrichment occupies all business slots', async () => {
  const enrichment = Array.from({ length: 16 }, (_, index) => ({
    id: `enrichment-${index}`,
    mandateId: 'mandate',
    status: 'crawling',
    config: { purpose: index % 2 ? 'people' : 'firmographics', companyDomain: `known-${Math.floor(index / 2)}.example.com`, executionSlot: `mandate:${index + 1}` },
  }));
  mocks.where.mockResolvedValue([root, ...enrichment]);
  await dispatchDiscoveryCandidates('org', 'root');
  expect(mocks.create).toHaveBeenCalledTimes(8);
  expect(mocks.create.mock.calls.map(call => call[3].executionSlot)).toEqual(Array.from({ length: 8 }, (_, index) => `mandate:discovery-${index + 1}`));
});
it('can replace sixty exhausted candidates but stops at the expanded run ceiling', async () => {
  const completed = Array.from({ length: 60 }, (_, index) => ({
    id: `completed-${index}`, status: 'complete', pages: 1,
    config: { discoveryCandidate: true, companyDomain: `old-${index}.example.com`, budget: { maxPages: 2 } },
  }));
  mocks.where.mockResolvedValue([root, ...completed]);
  await dispatchDiscoveryCandidates('org', 'root');
  expect(mocks.create).toHaveBeenCalledTimes(8);
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(root);
  mocks.where.mockResolvedValue([root, ...completed, ...Array.from({ length: DISCOVERY_CANDIDATE_LIMIT - 60 }, (_, index) => ({
    id: `more-${index}`, status: 'complete', pages: 1,
    config: { discoveryCandidate: true, companyDomain: `more-${index}.example.com`, budget: { maxPages: 2 } },
  }))]);
  await dispatchDiscoveryCandidates('org', 'root');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('reserves only remaining target capacity and does not repeat researched websites', async () => {
  const limited = { ...root, config: { ...root.config, newBusinessIds: Array.from({ length: 18 }, (_, i) => `target${i}`) } };
  mocks.get.mockResolvedValue(limited);
  mocks.where.mockResolvedValue([limited, { id: 'done', status: 'complete', pages: 1, config: { discoveryCandidate: true, companyDomain: 'instruments0.example.com', budget: { maxPages: 2 } } }, { id: 'active', status: 'crawling', config: { discoveryCandidate: true, companyDomain: 'instruments1.example.com', executionSlot: 'mandate:1', budget: { maxPages: 2 } } }]);
  await dispatchDiscoveryCandidates('org', 'root');
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.create.mock.calls[0][3]).toMatchObject({ companyDomain: 'instruments2.example.com', executionSlot: 'mandate:discovery-1' });
});
it('ranks snippet-supported business websites before generic leads', () => {
  const ranked = rankDiscoveryCandidateUrls([
    'https://generic.example.com/about',
    'https://sensors.example.com/',
  ], { ...root.config, researchScope: 'industrial sensor manufacturing', searchTerms: ['industrial sensors'], discoveryAttempts: [{ query: 'sensors', status: 'succeeded', results: [{ url: 'https://sensors.example.com/', title: 'Sensor manufacturer', snippet: 'Industrial sensor manufacturer and specialist supplier' }] }] } as never);
  expect(ranked[0]).toBe('https://sensors.example.com/');
});
it('does not schedule after cancellation or beyond the page ceiling', async () => {
  mocks.get.mockResolvedValue({ ...root, status: 'cancelled' });
  await dispatchDiscoveryCandidates('org', 'root');
  expect(mocks.create).not.toHaveBeenCalled();
  mocks.get.mockResolvedValue({ ...root, config: { ...root.config, automaticPageLimit: 1 } });
  await dispatchDiscoveryCandidates('org', 'root');
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.create.mock.calls[0][3].budget.maxPages).toBe(1);
});
it('cancels surplus candidate work once the target is reached', async () => {
  const complete = { ...root, config: { ...root.config, newBusinessIds: Array.from({ length: 20 }, (_, i) => `target${i}`) } };
  mocks.get.mockResolvedValue(complete);
  mocks.where.mockResolvedValue([complete]);
  await dispatchDiscoveryCandidates('org', 'root');
  expect(mocks.cancelDiscoveryCandidates).toHaveBeenCalledWith('root');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('uses the shared run snapshot without scanning jobs again or importing another run seeds', async () => {
  const snapshot = { root, jobs: [root, { ...root, id: 'other', seeds: ['https://wrong.example.com/'], config: { researchRunId: 'other-root' } }], dispatched: new Set<string>() } as unknown as import('./research-scheduling-snapshot').ResearchSchedulingSnapshot;
  mocks.create.mockImplementation(async (id, mandateId, createdBy, config) => ({ ...root, id, mandateId, createdBy, config, status: 'queued' }));
  await dispatchDiscoveryCandidates('org', 'root', snapshot);
  expect(mocks.where).not.toHaveBeenCalled();
  expect(mocks.create.mock.calls.some(c => c[3].companyDomain === 'wrong.example.com')).toBe(false);
  expect(snapshot.jobs).toHaveLength(10);
});
it('logs a safe correlated failed start and retries the durable queued candidate', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const limited = { ...root, config: { ...root.config, discoveryConcurrency: 1 } };
  const snapshot = { root: limited, jobs: [limited], dispatched: new Set<string>() } as unknown as import('./research-scheduling-snapshot').ResearchSchedulingSnapshot;
  mocks.create.mockImplementation(async (id, mandateId, createdBy, config) => ({ ...limited, id, mandateId, createdBy, config, status: 'queued' }));
  mocks.worker.mockRejectedValueOnce(new Error('token=secret https://private.example')).mockResolvedValue({});
  try {
    await dispatchDiscoveryCandidates('org', 'root', snapshot);
    const failedId = snapshot.jobs[1].id;
    expect(log).toHaveBeenCalledWith('research-diagnostic', expect.stringContaining('"event":"dispatch_deferred"'));
    const entry = JSON.parse(log.mock.calls.find(c => c[0] === 'research-diagnostic')![1]);
    expect(entry).toMatchObject({ rootId: 'root', jobId: failedId, reason: 'worker_unavailable' });
    expect(JSON.stringify(entry)).not.toContain('secret');
    expect(snapshot.dispatched.has(failedId)).toBe(false);
    await dispatchDiscoveryCandidates('org', 'root', snapshot);
    expect(mocks.create).toHaveBeenCalledTimes(1);expect(mocks.worker).toHaveBeenCalledTimes(2);
    expect(snapshot.dispatched.has(failedId)).toBe(true);
  } finally { log.mockRestore(); }
});
