import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), cancelRun: vi.fn(), where: vi.fn(), worker: vi.fn() }));
vi.mock('@/db/client', () => ({ requireDb: () => ({ select: () => ({ from: () => ({ where: mocks.where }) }) }) }));
vi.mock('@/db/research-repository', () => ({ ResearchRepository: class { get = mocks.get; create = mocks.create; cancelRun = mocks.cancelRun; } }));
vi.mock('./research-service', () => ({ researchWorker: mocks.worker }));
import { dispatchDiscoveryCandidates } from './automatic-discovery';
const seeds = Array.from({ length: 25 }, (_, i) => `https://instruments${i}.example.com/`);
const root = { id: 'root', status: 'discovering', mandateId: 'mandate', createdBy: 'user', seeds, config: { parallelDiscovery: true, targetBusinesses: 20, automaticDeadline: Date.now() + 3600000, automaticPageLimit: 100, businessTargetStartedAt: new Date().toISOString(), seeds: [], budget: { maxPages: 10 } } };
beforeEach(() => { vi.resetAllMocks(); mocks.get.mockResolvedValue(root); mocks.where.mockResolvedValue([root]); mocks.create.mockImplementation(async id => ({ id, status: 'queued' })); });
it('fans out twenty websites without waiting for another discovery slice', async () => {
  await dispatchDiscoveryCandidates('org', 'root');
  expect(mocks.create).toHaveBeenCalledTimes(20);
  expect(new Set(mocks.create.mock.calls.map(c => c[3].companyDomain)).size).toBe(20);
  expect(mocks.create.mock.calls.every(c => c[3].discoveryCandidate && !c[3].discover && c[3].budget.maxDomains === 1)).toBe(true);
  expect(mocks.worker).toHaveBeenCalledTimes(20);
});
it('reserves only remaining target capacity and does not repeat researched websites', async () => {
  const limited = { ...root, config: { ...root.config, newBusinessIds: Array.from({ length: 18 }, (_, i) => `target${i}`) } };
  mocks.get.mockResolvedValue(limited);
  mocks.where.mockResolvedValue([limited, { id: 'done', status: 'complete', pages: 1, config: { discoveryCandidate: true, companyDomain: 'instruments0.example.com', budget: { maxPages: 2 } } }, { id: 'active', status: 'crawling', config: { discoveryCandidate: true, companyDomain: 'instruments1.example.com', executionSlot: 'mandate:1', budget: { maxPages: 2 } } }]);
  await dispatchDiscoveryCandidates('org', 'root');
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.create.mock.calls[0][3]).toMatchObject({ companyDomain: 'instruments2.example.com', executionSlot: 'mandate:3' });
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
