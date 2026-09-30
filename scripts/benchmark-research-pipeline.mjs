import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Inputs are saved responses from authenticated GET /api/mandates/:id/research.
// This command makes no provider requests or database changes.
export function pipelineBenchmark(snapshot) {
  const jobs = [...(snapshot.jobs || []), ...(snapshot.companyJobs || []), ...(snapshot.peopleJobs || [])];
  const runs = Object.entries(snapshot.timings || {}).map(([runId, timing]) => {
    const related = jobs.filter(job => job.id === runId || job.config?.researchRunId === runId || job.config?.parentJobId === runId);
    const relevant = new Set(related.flatMap(job => job.config?.newBusinessIds || []));
    const runResults = (snapshot.results || []).filter(result => related.some(job => job.id === result.jobId));
    const pending = (snapshot.pendingEnrichment || []).filter(task => task.runId === runId).length;
    const activeJobs = related.filter(job => !['complete', 'partial', 'failed', 'cancelled'].includes(job.status)).length;
    const durationMs = timing.measuredWindowMs || 0;
    return { runId, activeJobs, pendingDeepJobs: pending, timeToFirstCompanyMs: timing.timeToFirstCompanyMs ?? null, timeToTargetMs: timing.timeToTargetMs ?? null, measuredWindowMs: durationMs,
      newRelevantCompanies: relevant.size, evidencedDomains: new Set(runResults.flatMap(result => result.businessDomains || [])).size,
      companiesPerMeasuredMinute: durationMs ? relevant.size / (durationMs / 60000) : null,
      pageReads: related.reduce((sum, job) => sum + (job.pages || 0), 0), modelCalls: related.reduce((sum, job) => sum + (job.modelCalls || 0), 0),
      failedJobs: related.filter(job => job.status === 'failed').length, segments: timing.segments, timingSpans: timing.spans || 0, supportedFieldCoverage: timing.coverage || null, targetCompanies: timing.targetCompanies ?? null,
      note: 'Measured window excludes unobserved time. An active or pending run is not a completion benchmark; stage work totals overlap.' };
  });
  return { capturedAt: new Date().toISOString(), runs };
}
export function comparePipelineBenchmarks(before, after) {
  const a = before.runs[0], b = after.runs[0];
  if (!a || !b) return null;
  return { timeToTargetSpeedup: a.timeToTargetMs && b.timeToTargetMs ? a.timeToTargetMs / b.timeToTargetMs : null,
    throughputRatio: a.companiesPerMeasuredMinute && b.companiesPerMeasuredMinute ? b.companiesPerMeasuredMinute / a.companiesPerMeasuredMinute : null,
    comparableCompletion: !a.activeJobs && !a.pendingDeepJobs && !b.activeJobs && !b.pendingDeepJobs,
    note: 'Compare matching mandate scope, target, effort and provider configuration. Ratios are descriptive, not proof of equivalent evidence coverage.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath) { console.error('Usage: node scripts/benchmark-research-pipeline.mjs snapshot.json [comparison.json]'); process.exitCode = 1; }
  else {
    const before = pipelineBenchmark(JSON.parse(await readFile(beforePath, 'utf8')));
    const after = afterPath ? pipelineBenchmark(JSON.parse(await readFile(afterPath, 'utf8'))) : null;
    console.log(JSON.stringify(after ? { before, after, comparison: comparePipelineBenchmarks(before, after) } : before, null, 2));
  }
}
