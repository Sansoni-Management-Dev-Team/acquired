import { z } from 'zod';

export const researchTimingSegments = ['control', 'source_discovery', 'source_persistence', 'discovery_context', 'discovery_planning', 'discovery_callback', 'discovery_search', 'targeted_planning', 'targeted_search', 'page_read', 'site_read', 'cache_lookup', 'extraction', 'persistence', 'provider_admission', 'provider_wait', 'coordination', 'other'] as const;
export const researchTimingSpanSchema = z.object({
  id: z.string().uuid(), step: z.string().min(1).max(160),
  segment: z.enum(researchTimingSegments),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime(),
  elapsedMs: z.number().finite().min(0).max(24 * 60 * 60 * 1000),
  outcome: z.enum(['succeeded', 'failed']),
}).refine(span => Date.parse(span.finishedAt) >= Date.parse(span.startedAt), 'Invalid timing interval');
export type ResearchTimingSpan = z.infer<typeof researchTimingSpanSchema>;
export type ResearchTimingSegment = typeof researchTimingSegments[number];
export const researchTimingBatchSchema = z.object({ spans: z.array(researchTimingSpanSchema).min(1).max(64) });
export const MAX_RESEARCH_TIMING_SPANS = 2048;

export function researchTimingSegment(step: string): ResearchTimingSegment {
  if (step.startsWith('admit-')) return 'provider_admission';
  if (step.startsWith('wait-')) return 'provider_wait';
  if (step.startsWith('control-')) return 'control';
  if (step === 'discovery-sources') return 'source_discovery';
  if (step.startsWith('discovery-persist-')) return 'source_persistence';
  if (step.startsWith('discovery-context-')) return 'discovery_context';
  if (step.startsWith('discovery-plan-')) return 'discovery_planning';
  if (/^discover(?:-|$)/.test(step)) return 'discovery_callback';
  if (step === 'targeted-plan') return 'targeted_planning';
  if (/^(targeted-search-|people-followup)/.test(step)) return 'targeted_search';
  if (/^(cached-read-|cached-site-)/.test(step)) return 'cache_lookup';
  if (step.startsWith('read-site-')) return 'site_read';
  if (/^(read-people-|lookahead-read-|read-fallback-|fallback-read-|submit-|poll-)/.test(step)) return 'page_read';
  if (/^(extract-|company-identity-|headcount-)/.test(step)) return 'extraction';
  if (step.startsWith('progress-')) return 'persistence';
  return 'other';
}

export function summariseResearchTimings(jobs: { id: string; createdAt: string | Date; config: { pipelineTiming?: Record<string, ResearchTimingSpan>; researchMilestones?: { firstCompanyAt?: string; targetReachedAt?: string } } }[]) {
  const segments: Partial<Record<ResearchTimingSegment, { calls: number; failed: number; totalMs: number; maxMs: number; meanMs: number; p95Ms: number }>> = {};
  const samples = new Map<ResearchTimingSegment, number[]>();
  const rawSpans = jobs.flatMap(job => Object.values(job.config.pipelineTiming || {}).flatMap(raw => {
    const parsed = researchTimingSpanSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  }));
  const spans = [...new Map(rawSpans.map(span => [span.id, span])).values()];
  for (const span of spans) {
    const summary = segments[span.segment] ||= { calls: 0, failed: 0, totalMs: 0, maxMs: 0, meanMs: 0, p95Ms: 0 };
    summary.calls++; summary.failed += Number(span.outcome === 'failed');
    summary.totalMs += span.elapsedMs; summary.maxMs = Math.max(summary.maxMs, span.elapsedMs);
    const durations = samples.get(span.segment) || []; durations.push(span.elapsedMs); samples.set(span.segment, durations);
  }
  for (const [segment, durations] of samples) {
    durations.sort((a, b) => a - b);
    segments[segment]!.meanMs = segments[segment]!.totalMs / durations.length;
    segments[segment]!.p95Ms = durations[Math.ceil(durations.length * .95) - 1];
  }
  const startedAt = spans.length ? spans.reduce((min, span) => Math.min(min, Date.parse(span.startedAt)), Infinity) : null;
  const finishedAt = spans.length ? spans.reduce((max, span) => Math.max(max, Date.parse(span.finishedAt)), -Infinity) : null;
  const runStarted = jobs.reduce((min, job) => Math.min(min, new Date(job.createdAt).getTime()), Infinity);
  const milestone = (key: 'firstCompanyAt' | 'targetReachedAt') => {
    const dates = jobs.map(job => Date.parse(job.config.researchMilestones?.[key] || '')).filter(Number.isFinite);
    return dates.length && Number.isFinite(runStarted) ? Math.max(0, Math.min(...dates) - runStarted) : null;
  };
  return { timeToFirstCompanyMs: milestone('firstCompanyAt'), timeToTargetMs: milestone('targetReachedAt'), spans: spans.length, jobs: jobs.length, segments, measuredWindowMs: startedAt === null || finishedAt === null ? 0 : finishedAt - startedAt, cappedJobs: jobs.filter(job => Object.keys(job.config.pipelineTiming || {}).length >= MAX_RESEARCH_TIMING_SPANS).length };
}
