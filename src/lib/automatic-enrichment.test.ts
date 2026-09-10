import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), cancelRun: vi.fn(), where: vi.fn(), memberships: vi.fn(), worker: vi.fn() }));
vi.mock('@/db/client', () => ({ requireDb: () => ({ select: () => ({ from: () => ({ where: mocks.where }) }) }) }));
vi.mock('@/db/research-repository', () => ({ ResearchRepository: class { get = mocks.get; create = mocks.create; cancelRun = mocks.cancelRun; } }));
vi.mock('@/db/acquisition-repository', () => ({ AcquisitionRepository: class { memberships = mocks.memberships; } }));
vi.mock('./research-service', () => ({ researchWorker: mocks.worker }));
import { dispatchAutomaticEnrichment } from './automatic-enrichment';
const root = { id: 'root', status: 'crawling', mandateId: 'mandate', createdBy: 'user', config: { mode: 'automatic', workflow: 'business', targetBusinesses: 20, companyBudget: { maxCompanies: 20 }, findPeople: true, geography: 'Australia' } };
const target = { id: 'target', domain: 'instruments.example.com', companyName: 'Example Instruments' };
const evidence = [{ targetId: target.id, sourceUrl: 'https://instruments.example.com/', evidence: { kind: 'company', website: 'https://instruments.example.com/' } }, { targetId: target.id, sourceUrl: 'https://instruments.example.com/', evidence: { kind: 'product', relevance: 'relevant' } }];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(root);
  mocks.where.mockResolvedValueOnce([root]).mockResolvedValueOnce(evidence);
  mocks.memberships.mockResolvedValue([{ target, assessment: { stage: 'identified' } }]);
  mocks.create.mockImplementation(async id => ({ id, status: 'queued' }));
});
it('starts company and people enrichment in separate slots while discovery is active', async () => {
  await dispatchAutomaticEnrichment('org', 'root');
  expect(mocks.create).toHaveBeenCalledTimes(2);
  const configs = mocks.create.mock.calls.map(call => call[3]);
  expect(configs.map(c => c.executionSlot)).toEqual([1, 2]);
  expect(configs.map(c => c.purpose)).toEqual(['firmographics', 'people']);
  expect(configs.every(c => c.researchRunId === root.id && c.parentJobId === root.id)).toBe(true);
  expect(mocks.worker).toHaveBeenCalledTimes(2);
});
it('uses both free slots without waiting for the first dispatch to finish', async () => {
  let release!: () => void;
  mocks.worker.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockResolvedValueOnce({});
  const pending = dispatchAutomaticEnrichment('org', 'root');
  await vi.waitFor(() => expect(mocks.worker).toHaveBeenCalledTimes(2));
  release(); await pending;
});
it('does not overfill active slots', async () => {
  mocks.where.mockReset().mockResolvedValueOnce([root, { id: 'a', status: 'crawling', config: { executionSlot: 1 } }, { id: 'b', status: 'crawling', config: { executionSlot: 2 } }]).mockResolvedValueOnce(evidence);
  await dispatchAutomaticEnrichment('org', 'root');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('does not recreate completed enrichment on repeated page callbacks', async () => {
  mocks.where.mockReset().mockResolvedValueOnce([root, ...['firmographics', 'people'].map(purpose => ({ id: purpose, status: 'partial', config: { researchRunId: root.id, targetId: target.id, purpose } }))]).mockResolvedValueOnce(evidence);
  await dispatchAutomaticEnrichment('org', 'root');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('does not schedule after cancellation', async () => {
  mocks.get.mockResolvedValue({ ...root, status: 'cancelled' });
  await dispatchAutomaticEnrichment('org', 'root');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('cleans up jobs created during a cancellation race before dispatch', async () => {
  mocks.get.mockResolvedValueOnce(root).mockResolvedValueOnce({ ...root, status: 'cancelled' });
  await dispatchAutomaticEnrichment('org', 'root');
  expect(mocks.cancelRun).toHaveBeenCalledWith('root');
  expect(mocks.worker).not.toHaveBeenCalled();
});

it('does not spend enrichment effort on directory leads until their own website shows mandate relevance', async () => {
  const discovered = { ...root, config: { ...root.config, newBusinessIds: [target.id] } };
  mocks.get.mockResolvedValue(discovered);
  mocks.where.mockReset().mockResolvedValueOnce([discovered]).mockResolvedValueOnce([]);
  await dispatchAutomaticEnrichment('org', 'root');
  expect(mocks.create).not.toHaveBeenCalled();
  // Company identity alone is not relevance evidence.
  mocks.where.mockReset().mockResolvedValueOnce([discovered]).mockResolvedValueOnce([evidence[0]]);
  await dispatchAutomaticEnrichment('org', 'root');
  expect(mocks.create).not.toHaveBeenCalled();
});
