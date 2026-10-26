import { beforeEach, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { emptyBrief } from '@/domain/acquisition';
import { POST } from './route';
const f = vi.hoisted(() => ({ session: vi.fn(), enabled: vi.fn(), worker: vi.fn(), repo: vi.fn(), get: vi.fn(), cancel: vi.fn(), cancelRun: vi.fn(), execution: vi.fn(), resume: vi.fn(), tick: vi.fn(), workflow: vi.fn(), db: vi.fn(), selectWhere: vi.fn(), updateWhere: vi.fn(), set: vi.fn(), mandate: vi.fn(), attach: vi.fn(), upsert: vi.fn(), acquisition: vi.fn(), organization: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: f.session } } }));
vi.mock('@/lib/research-service', () => ({ researchEnabled: f.enabled, researchWorker: f.worker }));
vi.mock('@/lib/acquisition-workflow-context', () => ({ withResearchJobWorkflow: f.workflow }));
vi.mock('@/lib/business-research-people', () => ({ dispatchBusinessPeople: f.resume }));
vi.mock('@/lib/company-people-research', () => ({ tickCompanyPeople: f.tick }));
vi.mock('@/db/research-repository', () => ({ ResearchRepository: class { constructor(org: string) { f.repo(org); } get = f.get; cancel = f.cancel; cancelRun = f.cancelRun; getExecution = f.execution; } }));
vi.mock('@/db/acquisition-repository', () => ({ AcquisitionRepository: class { constructor(org: string) { f.acquisition(org); } getMandate = f.mandate; attach = f.attach; } }));
vi.mock('@/db/repositories', () => ({ OrganizationRepository: class { constructor(db: unknown, org: string) { f.organization(db, org); } upsertEnrichedTarget = f.upsert; } }));
vi.mock('@/db/client', () => ({ requireDb: f.db }));
const jobId = '00000000-0000-4000-8000-000000000001', findingId = '00000000-0000-4000-8000-000000000002', targetId = '00000000-0000-4000-8000-000000000003';
const job = () => ({ id: jobId, mandateId: 'mandate-owned', createdBy: 'actor-owned', status: 'queued', config: {} });
const finding = () => ({ id: findingId, sourceUrl: 'https://example.com/about', evidence: { kind: 'company', name: 'Example Manufacturing', value: 'Manufacturer', quote: 'We manufacture industrial components.', website: 'https://example.com' } });
const request = (body: unknown, id = jobId) => POST(new Request('http://localhost/api/research/' + id, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ jobId: id }) });
beforeEach(() => {
  vi.resetAllMocks(); f.session.mockResolvedValue({ user: { id: 'actor-owned' }, session: { activeOrganizationId: 'org-owned' } }); f.enabled.mockReturnValue(true); f.get.mockResolvedValue(job()); f.workflow.mockImplementation((_job, work) => work());
  f.worker.mockResolvedValue({}); f.cancelRun.mockResolvedValue([{ id: jobId }]); f.selectWhere.mockResolvedValue([finding()]); f.updateWhere.mockResolvedValue([]); f.set.mockImplementation(() => ({ where: f.updateWhere }));
  f.db.mockReturnValue({ select: () => ({ from: () => ({ where: f.selectWhere }) }), update: () => ({ set: f.set }) });
  f.mandate.mockResolvedValue({ id: 'mandate-owned', brief: emptyBrief() }); f.upsert.mockResolvedValue({ id: targetId });
});
it.each([null, { session: {} }])('rejects unauthenticated/unscoped requests before repository access (%j)', async session => {
  f.session.mockResolvedValue(session); expect((await request({ action: 'cancel' })).status).toBe(401); expect(f.repo).not.toHaveBeenCalled();
});
it('refuses work when research is unavailable', async () => { f.enabled.mockReturnValue(false); expect((await request({ action: 'cancel' })).status).toBe(503); expect(f.repo).not.toHaveBeenCalled(); });
it('rejects malformed IDs and actions before loading jobs', async () => {
  expect((await request({ action: 'cancel' }, 'bad-id')).status).toBe(400);
  for (const body of [{}, { action: 'delete' }, { action: 'accept', findingId: 'invalid' }]) expect((await request(body)).status).toBe(400);
  expect(f.repo).not.toHaveBeenCalled();
});
it('rejects malformed JSON', async () => { expect((await POST(new Request('http://localhost', { method: 'POST', body: '{' }), { params: Promise.resolve({ jobId }) })).status).toBe(400); });
it.each([null, { ...job(), workflowExecutionId: 'execution-owned', createdBy: 'other-actor' }])('does not expose missing or differently owned workflow jobs (%j)', async record => {
  f.get.mockResolvedValue(record); expect((await request({ action: 'cancel' })).status).toBe(404); expect(f.repo).toHaveBeenCalledWith('org-owned'); expect(f.workflow).not.toHaveBeenCalled(); expect(f.worker).not.toHaveBeenCalled();
});
it('cancels saved work even if worker cancellation fails', async () => {
  f.worker.mockRejectedValue(new Error('offline')); const result = await request({ action: 'cancel' });
  expect(result.status).toBe(200); expect(f.cancel).toHaveBeenCalledWith(jobId); expect(f.worker).toHaveBeenCalledWith(`/jobs/${jobId}`, 'DELETE'); expect(f.workflow).toHaveBeenCalledWith(job(), expect.any(Function));
});
it('cancels an automatic run and its children without losing success to a worker failure', async () => {
  f.get.mockResolvedValue({ ...job(), config: { mode: 'automatic', researchRunId: 'root' } }); f.cancelRun.mockResolvedValue([{ id: jobId }, { id: 'child' }]);
  const root = { id: 'root', config: { includeCompanyPeople: true } }; f.execution.mockResolvedValue(root); f.worker.mockRejectedValue(new Error('offline'));
  expect((await request({ action: 'cancel' })).status).toBe(200); expect(f.execution).toHaveBeenCalledWith('root'); expect(f.tick).toHaveBeenCalledWith(root, true); expect(f.worker).toHaveBeenCalledTimes(2); expect(f.cancel).not.toHaveBeenCalled();
});
it('falls back to the current job as run root and tolerates a missing root', async () => {
  f.get.mockResolvedValue({ ...job(), config: { mode: 'automatic' } }); f.execution.mockResolvedValue(null);
  expect((await request({ action: 'cancel' })).status).toBe(200); expect(f.execution).toHaveBeenCalledWith(jobId); expect(f.tick).not.toHaveBeenCalled();
});
it('re-dispatches only queued work and reports a retryable provider failure', async () => {
  expect((await request({ action: 'retry-dispatch' })).status).toBe(200); expect(f.worker).toHaveBeenCalledWith(`/jobs/${jobId}`, 'POST');
  f.worker.mockRejectedValue(new Error('private backend detail')); const response = await request({ action: 'retry-dispatch' }); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain('private backend');
});
it.each(['running', 'complete', 'cancelled', 'failed'])('does not dispatch a %s job', async status => {
  f.get.mockResolvedValue({ ...job(), status }); expect((await request({ action: 'retry-dispatch' })).status).toBe(409); expect(f.worker).not.toHaveBeenCalled();
});
it('resumes people research within the active organization and handles admission conflicts', async () => {
  expect((await request({ action: 'resume-people' })).status).toBe(200); expect(f.resume).toHaveBeenCalledWith('org-owned', jobId);
  f.resume.mockRejectedValue(new Error('busy')); expect((await request({ action: 'resume-people' })).status).toBe(409);
});
it('requires a finding and rejects missing scoped evidence', async () => {
  expect((await request({ action: 'accept' })).status).toBe(400); expect(f.db).not.toHaveBeenCalled();
  f.selectWhere.mockResolvedValue([]); expect((await request({ action: 'accept', findingId })).status).toBe(404);
  expect(new PgDialect().sqlToQuery(f.selectWhere.mock.calls[0][0]).params).toEqual([findingId, jobId, 'org-owned']);
});
it('returns an already accepted target without adding it again', async () => {
  f.selectWhere.mockResolvedValue([{ ...finding(), targetId }]); expect(await (await request({ action: 'accept', findingId })).json()).toEqual({ ok: true, targetId }); expect(f.upsert).not.toHaveBeenCalled();
});
it.each([{}, { ...finding().evidence, kind: 'person' }, { ...finding().evidence, website: 'http://127.0.0.1/private' }])('rejects unsupported or non-public company evidence (%j)', async evidence => {
  f.selectWhere.mockResolvedValue([{ ...finding(), evidence }]); expect((await request({ action: 'accept', findingId })).status).toBe(409); expect(f.upsert).not.toHaveBeenCalled();
});
it('does not accept evidence for a missing mandate', async () => { f.mandate.mockResolvedValue(null); expect((await request({ action: 'accept', findingId })).status).toBe(404); expect(f.upsert).not.toHaveBeenCalled(); });
it('does not mark evidence accepted when target persistence fails', async () => { f.upsert.mockResolvedValue(null); expect((await request({ action: 'accept', findingId })).status).toBe(409); expect(f.attach).not.toHaveBeenCalled(); expect(f.set).not.toHaveBeenCalled(); });
it('accepts sourced company evidence with the active actor and attaches it to the owned mandate', async () => {
  expect(await (await request({ action: 'accept', findingId })).json()).toEqual({ ok: true, targetId });
  expect(f.acquisition).toHaveBeenCalledWith('org-owned'); expect(f.organization).toHaveBeenCalledWith(f.db(), 'org-owned'); expect(f.upsert).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'actor-owned', mandateId: 'mandate-owned', target: expect.objectContaining({ companyName: 'Example Manufacturing' }) }));
  expect(f.attach).toHaveBeenCalledWith('mandate-owned', targetId); expect(f.set).toHaveBeenCalledWith({ targetId }); expect(new PgDialect().sqlToQuery(f.updateWhere.mock.calls[0][0]).params).toEqual([findingId, 'org-owned']);
});
