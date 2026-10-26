import { beforeEach, expect, it, vi } from 'vitest';
// Scheduling scan assertions exclude timing persistence, which has separate
// saved-job authority coverage in research-timing-workflow-context.test.ts.
vi.mock('@/db/research-timing-repository', () => ({ saveResearchTimingSpans: async () => undefined }));
const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), cancelRun: vi.fn(), where: vi.fn(), memberships: vi.fn(), worker: vi.fn() }));
vi.mock('@/db/client', () => ({ requireDb: () => ({ select: () => ({ from: () => ({ where: mocks.where }) }) }) }));
vi.mock('@/db/research-repository', () => ({ ResearchRepository: class { get = mocks.get; create = mocks.create; cancelRun = mocks.cancelRun; } }));
vi.mock('@/db/acquisition-repository', () => ({ AcquisitionRepository: class { memberships = mocks.memberships; } }));
vi.mock('./research-service', () => ({ researchWorker: mocks.worker }));
import { dispatchAutomaticEnrichment } from './automatic-enrichment';
const root = { id: 'root', status: 'crawling', mandateId: 'mandate', createdBy: 'user', config: { mode: 'automatic', workflow: 'business', targetBusinesses: 20, companyBudget: { maxCompanies: 20 }, findPeople: true, geography: 'Australia' } };
const target = { id: 'target', domain: 'instruments.example.com', companyName: 'Example Instruments' };
const evidence = [{ jobId: root.id, targetId: target.id, sourceUrl: 'https://instruments.example.com/', evidence: { kind: 'company', website: 'https://instruments.example.com/' } }, { jobId: root.id, targetId: target.id, sourceUrl: 'https://instruments.example.com/', evidence: { kind: 'product', relevance: 'relevant' } }];
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
  expect(configs.map(c => c.executionSlot)).toEqual(["mandate:1", "mandate:2"]);
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
  mocks.where.mockReset().mockResolvedValueOnce([root, ...Array.from({ length: 40 }, (_, i) => ({ id: `active-${i}`, mandateId: 'mandate', status: 'crawling', config: { executionSlot: i + 1 } }))]).mockResolvedValueOnce(evidence);
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

it('another mandate occupying both enrichment slots does not block this mandate', async () => {
  mocks.where.mockReset().mockResolvedValueOnce([root, {id:'other-1',mandateId:'other',status:'crawling',config:{executionSlot:'other:1'}}, {id:'other-2',mandateId:'other',status:'crawling',config:{executionSlot:'other:2'}}]).mockResolvedValueOnce(evidence);
  await dispatchAutomaticEnrichment('org','root');
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.create.mock.calls.map(call => call[3].executionSlot)).toEqual(['mandate:1','mandate:2']);
});

it('starts paired research for eight distinct businesses and holds the ninth', async () => {
  const members = Array.from({ length: 21 }, (_, i) => ({ target: { ...target, id: `target-${i}`, domain: `instruments-${i}.example.com` }, assessment: { stage: 'identified' } }));
  mocks.memberships.mockResolvedValue(members);
  mocks.where.mockReset().mockResolvedValueOnce([root]).mockResolvedValueOnce(members.flatMap(m => evidence.map(f => ({ ...f, targetId: m.target.id, sourceUrl: `https://${m.target.domain}/`, evidence: { ...f.evidence, website: `https://${m.target.domain}/` } }))));
  await dispatchAutomaticEnrichment('org', 'root');
  expect(mocks.create).toHaveBeenCalledTimes(16);
  expect(new Set(mocks.create.mock.calls.map(c => c[3].targetId)).size).toBe(8);
  expect(new Set(mocks.create.mock.calls.map(c => c[3].executionSlot)).size).toBe(16);
});

it('gives every initial pass a short budget and carries existing evidence', async () => {
  await dispatchAutomaticEnrichment('org', 'root');
  const configs = mocks.create.mock.calls.map(call => call[3]);
  expect(configs.every(c => c.enrichmentPhase === 'initial')).toBe(true);
  expect(configs[0].budget).toEqual({ maxPages: 4, maxDomains: 8, maxModelCalls: 5, maxMinutes: 5 });
  expect(configs[0].inheritedFindings).toEqual(evidence.map(f => f.evidence));
  expect(configs[0].enrichmentPendingFields).toEqual(['size', 'revenue']);
});

it('queues a distinct deep continuation within the remaining original budget', async () => {
  mocks.get.mockResolvedValue({ ...root, config: { ...root.config, findPeople: false } });
  const initial = { id: 'initial', mandateId: root.mandateId, status: 'partial', pages: 4, modelCalls: 3,
    config: { researchRunId: root.id, targetId: target.id, purpose: 'firmographics', enrichmentPhase: 'initial',
      runtime: { remaining: ['https://instruments.example.com/about'], visited: ['https://instruments.example.com/'], attempts: [{ url: 'https://instruments.example.com/', status: 'read', reason: 'read' }] },
      targetedSearches: ['completed query'], targetedSearchAttempts: [] } };
  mocks.where.mockReset().mockResolvedValueOnce([root, initial]).mockResolvedValueOnce(evidence);
  await dispatchAutomaticEnrichment('org', 'root');
  const deep = mocks.create.mock.calls.map(call => call[3]).find(c => c.purpose === 'firmographics');
  expect(deep.enrichmentPhase).toBe('deep');
  expect(deep.budget).toEqual({ maxPages: 8, maxDomains: 8, maxModelCalls: 11, maxMinutes: 10 });
  expect(deep.runtime.attempts).toEqual([]);
  expect(deep.runtime.remaining).toEqual(initial.config.runtime.remaining);
  expect(deep.targetedSearches).toEqual(['completed query']);
});

it('fills initial coverage before a different company receives deep research', async () => {
  const second = { ...target, id: 'second', domain: 'second.example.com' };
  const limitedRoot = { ...root, config: { ...root.config, enrichmentConcurrency: 1, findPeople: false } };
  mocks.get.mockResolvedValue(limitedRoot);
  mocks.memberships.mockResolvedValue([{ target, assessment: { stage: 'identified' } }, { target: second, assessment: { stage: 'identified' } }]);
  mocks.where.mockReset().mockResolvedValueOnce([limitedRoot, { id: 'initial', status: 'partial', pages: 4, modelCalls: 5, config: { researchRunId: root.id, targetId: target.id, purpose: 'firmographics', enrichmentPhase: 'initial' } }]).mockResolvedValueOnce([...evidence, ...evidence.map(f => ({ ...f, targetId: second.id, sourceUrl: 'https://second.example.com/' }))]);
  await dispatchAutomaticEnrichment('org', 'root');
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.create.mock.calls[0][3]).toMatchObject({ targetId: second.id, enrichmentPhase: 'initial' });
});

it('reuses fresh prior-run facts for the same organization and target without reusing relevance', async () => {
  const recent = new Date();
  const historical = [
    { ...evidence[0], jobId: 'old-run', observedAt: recent, evidence: { kind: 'headcount', value: '20', factMetadata: { basis: 'reported' } } },
    { ...evidence[0], jobId: 'old-run', observedAt: recent, evidence: { kind: 'revenue', value: '1000000', factMetadata: { basis: 'reported', currency: 'AUD' } } },
  ];
  mocks.where.mockReset().mockResolvedValueOnce([root]).mockResolvedValueOnce([...evidence, ...historical]);
  await dispatchAutomaticEnrichment('org', 'root');
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.create.mock.calls[0][3].purpose).toBe('people');
  expect(mocks.create.mock.calls[0][3].inheritedFindings).toHaveLength(4);
});

it('charges failed initial attempts and credits retained unextracted pages in deep budget', async () => {
  mocks.get.mockResolvedValue({ ...root, config: { ...root.config, findPeople: false } });
  const initial = { id: 'initial', status: 'partial', pages: 2, modelCalls: 2,
    config: { researchRunId: root.id, targetId: target.id, purpose: 'firmographics', enrichmentPhase: 'initial',
      followupExhaustedFields: ['size'], followupSearchCounts: { size: 3 },
      runtime: { remaining: ['https://instruments.example.com/about'], visited: [], bufferedPage: { url: 'https://instruments.example.com/about', page: { url: 'https://instruments.example.com/about', markdown: 'evidence', observedAt: new Date().toISOString() } },
        attempts: [{ status: 'read', url: 'https://instruments.example.com/', reason: 'read' }, { status: 'failed', url: 'https://instruments.example.com/failure', reason: 'failed' }, { status: 'read', url: 'https://instruments.example.com/about', reason: 'Lookahead read retained without extraction' }] } } };
  mocks.where.mockReset().mockResolvedValueOnce([root, initial]).mockResolvedValueOnce(evidence);
  await dispatchAutomaticEnrichment('org', 'root');
  const deep = mocks.create.mock.calls[0][3];
  expect(deep.budget.maxPages).toBe(10);
  expect(deep.followupExhaustedFields).toEqual(['size']);
  expect(deep.followupSearchCounts).toEqual({ size: 3 });
  expect(deep.runtime.bufferedPage).toEqual(initial.config.runtime.bufferedPage);
});

it('waits for an active admission continuation instead of starting competing deep research', async () => {
  mocks.get.mockResolvedValue({ ...root, config: { ...root.config, findPeople: false } });
  const initial = { id: 'initial', status: 'partial', pages: 1, modelCalls: 1, config: { researchRunId: root.id, targetId: target.id, purpose: 'firmographics', enrichmentPhase: 'initial' } };
  const continuation = { ...initial, id: 'continuation', status: 'queued', config: { ...initial.config, autoContinueFrom: initial.id } };
  mocks.where.mockReset().mockResolvedValueOnce([root, initial, continuation]).mockResolvedValueOnce(evidence);
  await dispatchAutomaticEnrichment('org', 'root');
  expect(mocks.create).not.toHaveBeenCalled();
});

it('accounts all terminal admission descendants before scheduling a deep pass', async () => {
  mocks.get.mockResolvedValue({ ...root, config: { ...root.config, findPeople: false } });
  const initial = { id: 'initial', status: 'partial', pages: 1, modelCalls: 1, config: { researchRunId: root.id, targetId: target.id, purpose: 'firmographics', enrichmentPhase: 'initial' } };
  const continuation = { ...initial, id: 'continuation', pages: 2, modelCalls: 3, config: { ...initial.config, autoContinueFrom: initial.id, targetedSearches: ['reused'] } };
  mocks.where.mockReset().mockResolvedValueOnce([root, initial, continuation]).mockResolvedValueOnce(evidence);
  await dispatchAutomaticEnrichment('org', 'root');
  expect(mocks.create.mock.calls[0][3].budget).toMatchObject({ maxPages: 9, maxModelCalls: 10 });
  expect(mocks.create.mock.calls[0][3].targetedSearches).toEqual(['reused']);
});

it('does not fill an active initial pair with deep work while another company awaits initial coverage', async () => {
  const second = { ...target, id: 'second', domain: 'second.example.com' };
  const limitedRoot = { ...root, config: { ...root.config, enrichmentConcurrency: 1 } };
  mocks.get.mockResolvedValue(limitedRoot);
  mocks.memberships.mockResolvedValue([{ target, assessment: { stage: 'identified' } }, { target: second, assessment: { stage: 'identified' } }]);
  const initial = { id: 'initial', mandateId: root.mandateId, status: 'partial', pages: 4, modelCalls: 5, config: { researchRunId: root.id, targetId: target.id, purpose: 'firmographics', enrichmentPhase: 'initial', executionSlot: 'mandate:1' } };
  const activePeople = { ...initial, id: 'active-people', status: 'crawling', config: { ...initial.config, purpose: 'people', executionSlot: 'mandate:2' } };
  mocks.where.mockReset().mockResolvedValueOnce([limitedRoot, initial, activePeople]).mockResolvedValueOnce([...evidence, ...evidence.map(f => ({ ...f, targetId: second.id, sourceUrl: 'https://second.example.com/' }))]);
  await dispatchAutomaticEnrichment('org', 'root');
  expect(mocks.create).not.toHaveBeenCalled();
});

it('lets eligible admission continuation claim the initial phase before deep dispatch', async () => {
  mocks.get.mockResolvedValue({ ...root, config: { ...root.config, findPeople: false } });
  const initial = { id: 'initial', status: 'partial', pages: 0, modelCalls: 0, createdAt: new Date(), message: 'Browser admission deferred',
    config: { researchRunId: root.id, targetId: target.id, purpose: 'firmographics', mode: 'automatic', enrichmentPhase: 'initial',
      budget: { maxPages: 4, maxModelCalls: 5, maxMinutes: 5 },
      runtime: { remaining: ['https://instruments.example.com/'], visited: [], attempts: [{ url: 'https://instruments.example.com/', status: 'pending', reason: 'deferred' }] } } };
  mocks.where.mockReset().mockResolvedValueOnce([root, initial]).mockResolvedValueOnce(evidence);
  await dispatchAutomaticEnrichment('org', 'root');
  expect(mocks.create).not.toHaveBeenCalled();
});
it('uses shared members and findings without repeating scans and avoids repeat queued dispatch', async () => {
  const snapshot = { root, jobs: [root], members: [{ target, assessment: { stage: 'identified' } }], findings: evidence, dispatched: new Set<string>() } as unknown as import('./research-scheduling-snapshot').ResearchSchedulingSnapshot;
  mocks.create.mockImplementation(async (id, mandateId, createdBy, config) => ({ ...root, id, mandateId, createdBy, config, status: 'queued' }));
  await dispatchAutomaticEnrichment('org', 'root', snapshot);
  await dispatchAutomaticEnrichment('org', 'root', snapshot);
  expect(mocks.where).not.toHaveBeenCalled();expect(mocks.memberships).not.toHaveBeenCalled();
  expect(mocks.create).toHaveBeenCalledTimes(2);expect(mocks.worker).toHaveBeenCalledTimes(2);
});
it('logs safe failed child dispatch while preserving queued enrichment for retry', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const snapshot = { root, jobs: [root], members: [{ target, assessment: { stage: 'identified' } }], findings: evidence, dispatched: new Set<string>() } as unknown as import('./research-scheduling-snapshot').ResearchSchedulingSnapshot;
  mocks.create.mockImplementation(async (id, mandateId, createdBy, config) => ({ ...root, id, mandateId, createdBy, config, status: 'queued' }));
  mocks.worker.mockRejectedValueOnce(new Error('private-token')).mockResolvedValue({});
  try {
    await dispatchAutomaticEnrichment('org', 'root', snapshot);
    const entry = JSON.parse(log.mock.calls.find(c => c[0] === 'research-diagnostic')![1]);
    expect(entry).toMatchObject({ event: 'dispatch_deferred', rootId: 'root', jobId: snapshot.jobs[1].id, reason: 'worker_unavailable' });
    expect(JSON.stringify(entry)).not.toContain('private-token');
    await dispatchAutomaticEnrichment('org', 'root', snapshot);
    expect(mocks.create).toHaveBeenCalledTimes(2);expect(mocks.worker).toHaveBeenCalledTimes(3);
  } finally { log.mockRestore(); }
});
