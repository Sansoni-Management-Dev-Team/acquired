import { expect, it, vi } from 'vitest';
import { pipelineTiming } from './pipeline-timing';

it('retains failed timing delivery and records operation failures without hiding them', async () => {
  let now = 0;
  const deliver = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const timing = pipelineTiming('job', deliver, () => now);
  await expect(timing.measure('extract-1', async () => { now = 20; throw new Error('model failed'); })).rejects.toThrow('model failed');
  await timing.flush(); await timing.flush();
  expect(deliver).toHaveBeenCalledTimes(2);
  expect(deliver.mock.calls[0][0]).toEqual(deliver.mock.calls[1][0]);
  expect(deliver.mock.calls[1][0][0]).toMatchObject({ elapsedMs: 20, outcome: 'failed', segment: 'extraction' });
});
it('coalesces concurrent flushes without deleting newly finished operations', async () => {
  let release!: () => void;
  const deliver = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockResolvedValue(undefined);
  const timing = pipelineTiming('job', deliver);
  await timing.measure('read-people-1', async () => 'page');
  const first = timing.flush(); const second = timing.flush();
  await timing.measure('extract-1', async () => 'evidence');
  release(); await Promise.all([first, second]); await timing.flush();
  expect(deliver).toHaveBeenCalledTimes(2);
  expect(deliver.mock.calls.map(call => call[0].map((s: { step: string }) => s.step))).toEqual([['read-people-1'], ['extract-1']]);
});
