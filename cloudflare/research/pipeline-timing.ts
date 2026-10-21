import { researchTimingSegment, type ResearchTimingSpan } from '../../src/domain/research-timing';
import {safeResearchTrace,type ResearchTraceContext} from '../../src/domain/research-trace-context';

export function pipelineTiming(jobId: string, deliver: (spans: ResearchTimingSpan[]) => Promise<void>, now = Date.now, context:()=>ResearchTraceContext=()=>({})) {
  const trace=()=>safeResearchTrace({...context(),jobId});
  const pending: ResearchTimingSpan[] = [];
  let delivery: Promise<void> | undefined;
  const timing = {
    async measure<T>(step: string, run: () => Promise<T>): Promise<T> {
      const start = now(); let outcome: ResearchTimingSpan['outcome'] = 'succeeded';
      console.info('research-pipeline', JSON.stringify({ event: 'segment_started', ...trace(), step, segment: researchTimingSegment(step), timestamp: new Date(start).toISOString() }));
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
        console.info('research-pipeline', JSON.stringify({ event: 'segment_finished', ...trace(), ...span }));
      }
    },
    async progress<T extends object, R extends { timingAcceptedIds?: string[] }>(event: T, send: (event: T & { timingSpans?: ResearchTimingSpan[] }) => Promise<R>, batched: boolean): Promise<R> {
      if (!batched) {
        await timing.flush();
        return send(event);
      }
      // Retain spans across lost responses and retries. The application must
      // explicitly acknowledge persisted IDs; HTTP success alone is insufficient.
      const batch = pending.slice(0, 64);
      const response = await send({ ...event, ...(batch.length ? { timingSpans: batch } : {}) });
      const sent = new Set(batch.map(span => span.id));
      const accepted = new Set((response.timingAcceptedIds || []).filter(id => sent.has(id)));
      for (let index = pending.length - 1; index >= 0; index--) if (accepted.has(pending[index].id)) pending.splice(index, 1);
      return response;
    },
    async flush(maxBatches = 4) {
      if (delivery) return delivery;
      if (!pending.length) return;
      delivery = (async () => {
        // Bound telemetry requests; retain failed batches for the next progress flush.
        for (let round = 0; pending.length && round < maxBatches; round++) {
          const batch = pending.slice(0, 64);
          try {
            await deliver(batch);
            const accepted = new Set(batch.map(span => span.id));
            for (let index = pending.length - 1; index >= 0; index--) if (accepted.has(pending[index].id)) pending.splice(index, 1);
          }
          catch { console.info('research-pipeline', JSON.stringify({ event: 'timing_delivery_deferred', ...trace(), pending: pending.length })); break; }
        }
      })();
      try { await delivery; } finally { delivery = undefined; }
    },
  };
  return timing;
}
