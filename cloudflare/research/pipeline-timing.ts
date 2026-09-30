import { researchTimingSegment, type ResearchTimingSpan } from '../../src/domain/research-timing';

export function pipelineTiming(jobId: string, deliver: (spans: ResearchTimingSpan[]) => Promise<void>, now = Date.now) {
  const pending: ResearchTimingSpan[] = [];
  let delivery: Promise<void> | undefined;
  return {
    async measure<T>(step: string, run: () => Promise<T>): Promise<T> {
      const start = now(); let outcome: ResearchTimingSpan['outcome'] = 'succeeded';
      console.info('research-pipeline', JSON.stringify({ event: 'segment_started', jobId, step, segment: researchTimingSegment(step), timestamp: new Date(start).toISOString() }));
      try {
        const result = await run();
        const value = result && typeof result === 'object' && 'value' in result ? result.value : result;
        if (value && typeof value === 'object' && (('status' in value && value.status === 'failed') || ('failed' in value && value.failed === true) || ('deferred' in value && value.deferred === true))) outcome = 'failed';
        return result;
      }
      catch (error) { outcome = 'failed'; throw error; }
      finally {
        const finish = now();
        const span: ResearchTimingSpan = { id: crypto.randomUUID(), step: step.slice(0, 160), segment: researchTimingSegment(step), startedAt: new Date(start).toISOString(), finishedAt: new Date(finish).toISOString(), elapsedMs: Math.max(0, finish - start), outcome };
        if (pending.length < 2048) pending.push(span);
        console.info('research-pipeline', JSON.stringify({ event: 'segment_finished', jobId, ...span }));
      }
    },
    async flush() {
      if (delivery) return delivery;
      if (!pending.length) return;
      delivery = (async () => {
        // Bound telemetry requests; retain failed batches for the next progress flush.
        for (let round = 0; pending.length && round < 4; round++) {
          const batch = pending.slice(0, 64);
          try { await deliver(batch); pending.splice(0, batch.length); }
          catch { console.info('research-pipeline', JSON.stringify({ event: 'timing_delivery_deferred', jobId, pending: pending.length })); break; }
        }
      })();
      try { await delivery; } finally { delivery = undefined; }
    },
  };
}
