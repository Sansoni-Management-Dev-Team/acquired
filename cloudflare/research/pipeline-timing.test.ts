import { expect, it, vi } from 'vitest';
import { pipelineTiming } from './pipeline-timing';
import type {ResearchTraceContext} from '../../src/domain/research-trace-context';

it('correlates span logs with the current sanitized workflow context without changing persisted spans',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{}),deliver=vi.fn().mockRejectedValue(new Error('private failure'));
 let context:ResearchTraceContext={jobId:'job'};
 try{
  const timing=pipelineTiming('job',deliver,()=>0,()=>context);
  context={jobId:'job',mandateId:'mandate-1',runId:'run-1',operationId:'operation-1'};
  await timing.measure('f-plan',async()=>null);await timing.flush();
  const entries=log.mock.calls.map(([,body])=>JSON.parse(body as string));
  for(const event of ['segment_started','segment_finished','timing_delivery_deferred'])expect(entries.find(item=>item.event===event)).toMatchObject(context);
  expect(deliver.mock.calls[0][0][0]).not.toHaveProperty('mandateId');
 }finally{log.mockRestore();}
});

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

it('piggybacks a bounded batch and removes only explicitly acknowledged sent spans', async () => {
  const deliver = vi.fn();
  const timing = pipelineTiming('job', deliver);
  for (let n = 0; n < 65; n++) await timing.measure(`extract-${n}`, async () => null);
  let firstIds: string[] = [];
  const send = vi.fn(async (event: { revision: number; timingSpans?: { id: string }[] }) => {
    firstIds = event.timingSpans!.map(span => span.id);
    expect(firstIds).toHaveLength(64);
    return { timingAcceptedIds: [firstIds[0], 'not-sent'] };
  });
  await timing.progress({ revision: 1 }, send, true);
  expect(deliver).not.toHaveBeenCalled();
  await timing.progress({ revision: 2 }, async event => {
    expect(event.timingSpans!.map(span => span.id)).not.toContain(firstIds[0]);
    expect(event.timingSpans).toHaveLength(64);
    return { timingAcceptedIds: event.timingSpans!.map(span => span.id) };
  }, true);
  await timing.flush();
  expect(deliver).not.toHaveBeenCalled();
});

it('retains piggyback spans after failed or unacknowledged progress responses', async () => {
  const timing = pipelineTiming('job', vi.fn());
  await timing.measure('extract-1', async () => null);
  let retained: unknown;
  await expect(timing.progress({}, async event => { retained = event.timingSpans; throw new Error('lost response'); }, true)).rejects.toThrow('lost response');
  await timing.progress({}, async event => { expect(event.timingSpans).toEqual(retained); return {}; }, true);
  await timing.progress({}, async event => { expect(event.timingSpans).toEqual(retained); return { timingAcceptedIds: event.timingSpans!.map(span => span.id) }; }, true);
});

it('keeps telemetry-first behaviour for old runs without batching enabled', async () => {
  const order: string[] = [];
  const timing = pipelineTiming('job', async () => { order.push('timing'); });
  await timing.measure('extract-1', async () => null);
  await timing.progress({ revision: 1 }, async event => { expect(event).not.toHaveProperty('timingSpans'); order.push('progress'); return {}; }, false);
  expect(order).toEqual(['timing', 'progress']);
});

it('does not remove a newer span when flush and piggyback acknowledgements overlap', async () => {
  let release!: () => void;
  const delivered: { step: string }[][] = [];
  const timing = pipelineTiming('job', async spans => {
    delivered.push(spans);
    if (delivered.length === 1) await new Promise<void>(resolve => { release = resolve; });
  });
  await timing.measure('extract-1', async () => null);
  const flushing = timing.flush();
  await timing.progress({}, async event => ({ timingAcceptedIds: event.timingSpans!.map(span => span.id) }), true);
  await timing.measure('extract-2', async () => null);
  release(); await flushing;
  expect(delivered.map(batch => batch.map(span => span.step))).toEqual([['extract-1'], ['extract-2']]);
});
