import { saveResearchTimingSpans } from '@/db/research-timing-repository';
import type { ResearchTimingSegment, ResearchTimingSpan } from '@/domain/research-timing';

export async function measureResearchSegment<T>(jobId: string, organizationId: string, step: string, segment: ResearchTimingSegment, run: () => Promise<T>, shouldRecord?: (result: T) => boolean): Promise<T> {
  const start = Date.now(); let record = true; let outcome: ResearchTimingSpan['outcome'] = 'succeeded';
  try { const result = await run(); record = shouldRecord ? shouldRecord(result) : true; return result; }
  catch (error) { outcome = 'failed'; throw error; }
  finally {
    if (record) {
      const finish = Date.now();
      const span: ResearchTimingSpan = { id: crypto.randomUUID(), step: step.slice(0, 160), segment, startedAt: new Date(start).toISOString(), finishedAt: new Date(finish).toISOString(), elapsedMs: finish - start, outcome };
      console.info('research-pipeline', JSON.stringify({ event: 'segment_finished', jobId, ...span }));
      await saveResearchTimingSpans(jobId, organizationId, [span]).catch(() => {
        console.info('research-pipeline', JSON.stringify({ event: 'timing_delivery_deferred', jobId, step }));
      });
    }
  }
}
