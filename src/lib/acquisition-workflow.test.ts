import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import './acquisition-workflow-research';
import type { Pool } from 'pg';
import { AcquisitionWorkflowError, acquisitionWorkflowEnabled, readAcquisitionWorkflow, resumeAcquisitionWorkflow, startAcquisitionWorkflow } from './acquisition-workflow';
const f = vi.hoisted(() => ({ construct: vi.fn(), start: vi.fn(), read: vi.fn(), ensure: vi.fn() }));
vi.mock('@/db/acquisition-workflow-store', () => ({ AcquisitionWorkflowStore: class { constructor(pool: unknown, actor: unknown) { f.construct(pool, actor); } start = f.start; read = f.read; } }));
vi.mock('./acquisition-workflow-research', () => ({ ensureWorkflowResearch: f.ensure }));
const id = '00000000-0000-4000-8000-000000000001';
const actor = { organizationId: 'org-a', userId: 'user-a' }, pool = {} as Pool;
const input = { requestId: id, preset: 'demo', presentation: 'workspace' };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('ACQUISITION_WORKFLOW_ENABLED', 'true'); });
afterEach(() => vi.unstubAllEnvs());
it('gates starting workflows before persistence', async () => {
  vi.stubEnv('ACQUISITION_WORKFLOW_ENABLED', 'false'); expect(acquisitionWorkflowEnabled()).toBe(false);
  await expect(startAcquisitionWorkflow(pool, actor, input)).rejects.toMatchObject({ status: 404 }); expect(f.start).not.toHaveBeenCalled();
});
it('validates requests before creating a store', async () => {
  await expect(startAcquisitionWorkflow(pool, actor, {})).rejects.toMatchObject({ status: 400 }); await expect(readAcquisitionWorkflow(pool, actor, 'bad-id')).rejects.toMatchObject({ status: 400 }); expect(f.construct).not.toHaveBeenCalled();
});
it('passes the exact actor and validated command to storage', async () => {
  f.start.mockResolvedValue({ id, state: 'accepted' }); expect(await startAcquisitionWorkflow(pool, actor, input)).toEqual({ id, state: 'accepted' }); expect(f.construct).toHaveBeenCalledWith(pool, actor); expect(f.start).toHaveBeenCalledWith(input);
});
it.each([['02000', 409], ['42501', 403], ['23505', 409], ['40001', 409], ['55000', 409], ['22023', 400], ['unknown', 503]])('maps storage failure %s without exposing database details', async (code, status) => {
  f.read.mockRejectedValue({ code, message: 'private-database-detail' });
  try { await readAcquisitionWorkflow(pool, actor, id); throw Error('Expected rejection'); } catch (error) { expect(error).toBeInstanceOf(AcquisitionWorkflowError); expect(error).toMatchObject({ status }); expect((error as Error).message).not.toContain('private-database-detail'); }
});
it('preserves an already classified error', async () => {
  const error = new AcquisitionWorkflowError('Already classified', 409); f.start.mockRejectedValue(error); await expect(startAcquisitionWorkflow(pool, actor, input)).rejects.toBe(error);
});
it.each(['ready', 'complete', 'failed', 'cancelled', 'uncertain', 'outreach'])('does not redispatch a %s workflow', async state => {
  const saved = { id, state }; f.read.mockResolvedValue(saved); expect(await resumeAcquisitionWorkflow(pool, actor, id)).toEqual(saved); expect(f.ensure).not.toHaveBeenCalled();
});
it('returns missing work without dispatching research', async () => { f.read.mockResolvedValue(null); expect(await resumeAcquisitionWorkflow(pool, actor, id)).toBeNull(); expect(f.ensure).not.toHaveBeenCalled(); });
it('coalesces concurrent recovery for the same actor and reads the committed result', async () => {
  let finish!: () => void; const pending = new Promise<void>(done => { finish = done; });
  f.read.mockResolvedValueOnce({ id, state: 'accepted' }).mockResolvedValueOnce({ id, state: 'researching' }); f.ensure.mockReturnValue(pending);
  const first = resumeAcquisitionWorkflow(pool, actor, id), second = resumeAcquisitionWorkflow(pool, actor, id);
  expect(first).toBe(second); await vi.waitFor(() => expect(f.ensure).toHaveBeenCalledOnce()); finish();
  expect(await first).toEqual({ id, state: 'researching' }); expect(f.read).toHaveBeenCalledTimes(2); expect(f.ensure).toHaveBeenCalledWith(pool, actor, { id, state: 'accepted' });
});
it('does not coalesce different actors reading the same workflow ID', async () => {
  let finish!: (value: object) => void;
  f.read.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const first = resumeAcquisitionWorkflow(pool, actor, id), second = resumeAcquisitionWorkflow(pool, { ...actor, userId: 'user-b' }, id);
  expect(first).not.toBe(second); expect(f.read).toHaveBeenCalledTimes(2);
  expect(f.construct).toHaveBeenCalledWith(pool, { ...actor, userId: 'user-b' });
  finish({ id, state: 'ready' }); await Promise.all([first, second]); expect(f.ensure).not.toHaveBeenCalled();
});
it('releases failed recovery so an explicit retry can proceed', async () => {
  f.read.mockRejectedValueOnce({ code: '40001' });
  await expect(resumeAcquisitionWorkflow(pool, actor, id)).rejects.toMatchObject({ status: 409 });
  f.read.mockResolvedValue({ id, state: 'complete' });
  expect(await resumeAcquisitionWorkflow(pool, actor, id)).toEqual({ id, state: 'complete' }); expect(f.read).toHaveBeenCalledTimes(2);
});
