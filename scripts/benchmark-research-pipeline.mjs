import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Inputs are saved responses from authenticated GET /api/mandates/:id/research.
// This command makes no provider requests or database changes.
const validNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
/** Hash supplied scope/budgets/provider/environment descriptions, never print their content. */
export function comparisonFingerprint(value) { return digest(JSON.stringify(canonical(value))); }
/** Stable semantic coverage ignores database UUIDs/timestamps and preserves source/claim identity. */
export function evidenceCoverageKeys(findings) {
  return [...new Set(findings.flatMap(row => {
    const finding = row.evidence || row;
    if (!finding || typeof finding !== 'object' || !finding.kind || !finding.quote || !finding.value) return [];
    const source = row.sourceUrl || row.source_url || finding.website;
    let url;
    try { url = new URL(source); if (url.username || url.password || url.protocol !== 'https:') return []; } catch { return []; }
    url.hash='';
    const normalize = text => String(text || '').replace(/\s+/g,' ').trim().toLowerCase();
    return [comparisonFingerprint({source:url.href,kind:finding.kind,name:normalize(finding.name),value:normalize(finding.value),quote:normalize(finding.quote),email:normalize(finding.email)})];
  }))].sort();
}
export function pipelineBenchmark(snapshot) {
  if (Array.isArray(snapshot.benchmarkRuns)) return { capturedAt:new Date().toISOString(), runs:snapshot.benchmarkRuns, format:'observed-counter-capture-v1' };
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
const fingerprints = ['workloadFingerprint','recordingFingerprint','environmentFingerprint'];
const measurementSources = { progressCallbackRequests:'observed_request_attempts', telemetryDatabaseWrites:'observed_database_write_attempts', schedulingScans:'observed_scheduling_selects', runElapsedMs:'job_created_to_all_jobs_terminal' };
const unavailable = reason => ({status:'unavailable',reason});
const median = values => { const sorted=[...values].sort((a,b)=>a-b); const middle=Math.floor(sorted.length/2); return sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2; };
function stages(before,after) {
  const output={};
  for (const name of new Set([...Object.keys(before?.segments || {}),...Object.keys(after?.segments || {})])) {
    const a=before?.segments?.[name],b=after?.segments?.[name];
    output[name]={};
    for (const metric of ['count','workMs','meanMs','p95Ms']) output[name][`${metric}Delta`]=validNumber(a?.[metric]) && validNumber(b?.[metric]) ? b[metric]-a[metric] : null;
  }
  return output;
}
function coverage(before,after,comparable) {
  if (!comparable) return unavailable('Inputs are not comparable');
  if (!Array.isArray(before?.evidenceKeys) || !Array.isArray(after?.evidenceKeys) || !before.evidenceKeys.length || [...before.evidenceKeys,...after.evidenceKeys].some(key=>typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))) return unavailable('Stable supported-evidence keys are missing or invalid');
  if (!before.fieldCoverage || !after.fieldCoverage || !Object.keys(before.fieldCoverage).length) return unavailable('Supported field coverage is missing');
  const b=new Set(after.evidenceKeys), missing=before.evidenceKeys.filter(key=>!b.has(key));
  const lostFields=[];
  for (const [field,count] of Object.entries(before.fieldCoverage)) {
    if (!validNumber(count) || !validNumber(after.fieldCoverage[field])) return unavailable('Supported field counts are missing or invalid');
    if (after.fieldCoverage[field]<count) lostFields.push(field);
  }
  return {status:missing.length || lostFields.length ? 'fail' : 'pass',beforeEvidence:new Set(before.evidenceKeys).size,afterEvidence:b.size,missingEvidence:missing.length,lostFields};
}
export function comparePipelineBenchmarks(before, after) {
  const a=before.runs?.[0],b=after.runs?.[0],reasons=[];
  if (before.runs?.length!==1 || after.runs?.length!==1) reasons.push('Select exactly one run from each capture');
  const comparableCompletion=Boolean(a && b && a.activeJobs===0 && a.pendingDeepJobs===0 && b.activeJobs===0 && b.pendingDeepJobs===0);
  if (!comparableCompletion || a?.complete!==true || b?.complete!==true) reasons.push('Both captures must explicitly finish all jobs and enrichment');
  for (const key of fingerprints) {
    const x=a?.metadata?.[key],y=b?.metadata?.[key];
    if (typeof x!=='string'||typeof y!=='string'||!/^[a-f0-9]{64}$/.test(x)||!/^[a-f0-9]{64}$/.test(y)) reasons.push(`${key} is missing or invalid`);
    else if(x!==y) reasons.push(`${key} differs`);
  }
  if (!a?.metadata?.sourceRevision || !b?.metadata?.sourceRevision) reasons.push('Source revisions must be recorded');
  const comparable=!reasons.length, evidence=coverage(a,b,comparable);
  const target=(metric,requiredReduction,strict=false)=>{
    if (!comparable) return unavailable(reasons.join('; '));
    const x=a.measurements?.[metric],y=b.measurements?.[metric];
    if (!validNumber(x)||!validNumber(y)||x<=0||a.measurementSources?.[metric]!==measurementSources[metric]||b.measurementSources?.[metric]!==measurementSources[metric]) return unavailable(`Observed ${metric} with its measurement source is required`);
    if (metric==='runElapsedMs') {
      if (!Array.isArray(a.samples)||!Array.isArray(b.samples)||a.samples.length<3||b.samples.length<3||[...a.samples,...b.samples].some(value=>!validNumber(value)||value<=0)) return unavailable('At least three completed duration samples per stage are required');
      if (Math.abs(median(a.samples)-x)>0.001 || Math.abs(median(b.samples)-y)>0.001) return unavailable('Run duration must be the median of its recorded samples');
    }
    if (metric==='runElapsedMs' && evidence.status==='unavailable') return unavailable('Preserved supported evidence coverage cannot be assessed');
    const reduction=(x-y)/x;
    return {status:(strict ? reduction>requiredReduction : reduction+1e-12>=requiredReduction) && (metric!=='runElapsedMs'||evidence.status==='pass') ? 'pass' : 'fail',before:x,after:y,reduction,requiredReduction,strict,...(metric==='runElapsedMs'&&evidence.status!=='pass'?{reason:'Duration improvement requires preserved supported evidence coverage'}:{})};
  };
  const targets={progressCallbacks:target('progressCallbackRequests',0.5),telemetryWrites:target('telemetryDatabaseWrites',0.8),schedulingScans:target('schedulingScans',0,true),elapsedRun:target('runElapsedMs',0.3)};
  const statuses=[...Object.values(targets).map(value=>value.status),evidence.status];
  return {comparableCompletion,comparable,reasons,coverage:evidence,targets,overall:statuses.includes('fail')?'fail':statuses.every(status=>status==='pass')?'pass':'unavailable',stages:stages(a,b),
    timeToTargetSpeedup:comparable && a?.timeToTargetMs && b?.timeToTargetMs ? a.timeToTargetMs/b.timeToTargetMs : null,
    throughputRatio:comparable && a?.companiesPerMeasuredMinute && b?.companiesPerMeasuredMinute ? b.companiesPerMeasuredMinute/a.companiesPerMeasuredMinute : null,
    note:'Work totals overlap. Count attempts including retries. Database writes/scans require observed counters; timing windows are not end-to-end durations. Passing offline replay does not prove a production speedup.'};
}
/** Count executed attempts, including failed queries/retries; never inspect SQL or parameters.
 * Manifests must be audited repository query fingerprints, not inferred from generic persistence spans.
 */
export function observedPipelineCounters(contents,{jobIds,completeLogs=false,queryManifest={}}={}) {
  const scope=new Set(jobIds || []), seen=new Set();
  let progressCallbackRequests=0,telemetryDatabaseWrites=0,schedulingScans=0;
  const telemetry=new Set(queryManifest.telemetryWrites || []),scheduler=new Set(queryManifest.schedulingScans || []);
  for (const line of contents.split('\n')) {
    const match=/\b(research-provider|research-db)\s+(\{.*\})\s*$/.exec(line);
    if(!match) continue;
    let event;try{event=JSON.parse(match[2]);}catch{continue;}
    if(!scope.has(event.jobId) && !scope.has(event.runId)) continue;
    if(match[1]==='research-provider' && event.event==='request_started' && event.provider==='research-worker' && event.operation==='callback_progress') {
      if(!event.requestId || !event.timestamp) continue;
      const key=`request:${event.requestId}:${event.timestamp}`;
      if(seen.has(key))continue;seen.add(key);progressCallbackRequests++;
    }
    if(match[1]==='research-db' && event.event==='query_finished' && event.queryId) {
      const key=`query:${event.queryId}`;if(seen.has(key))continue;seen.add(key);
      if(event.operation==='update' && telemetry.has(event.queryFingerprint))telemetryDatabaseWrites++;
      if(event.operation==='select' && scheduler.has(event.queryFingerprint))schedulingScans++;
    }
  }
  return {progressCallbackRequests:completeLogs && scope.size ? progressCallbackRequests : null,
    telemetryDatabaseWrites:completeLogs && scope.size && telemetry.size ? telemetryDatabaseWrites : null,
    schedulingScans:completeLogs && scope.size && scheduler.size ? schedulingScans : null,
    measurementSources:{...measurementSources},note:'Complete logs and an audited query manifest are required. Attempts include failed operations; repeated copies of the same event are deduplicated.'};
}
/** Aggregate repeat executions, rejecting input/configuration or evidence drift. */
export function aggregateRecordedCaptures(captures,stage) {
  if(!captures.length)throw new Error('At least one capture is required');
  const runs=captures.map(capture=>pipelineBenchmark(capture).runs);
  if(runs.some(list=>list.length!==1))throw new Error('Select exactly one run per repeated capture');
  const records=runs.map(list=>list[0]),first=records[0];
  for(const record of records) {
    if(record.complete!==true||record.activeJobs!==0||record.pendingDeepJobs!==0)throw new Error('Only completed repetitions can be aggregated');
    for(const key of [...fingerprints,'sourceRevision'])if(record.metadata?.[key]!==first.metadata?.[key])throw new Error(`Repetition ${key} differs`);
    if(comparisonFingerprint(record.performanceFlags)!==comparisonFingerprint(first.performanceFlags))throw new Error('Repetition performance flags differ');
    if(comparisonFingerprint([...new Set(record.evidenceKeys || [])].sort())!==comparisonFingerprint([...new Set(first.evidenceKeys || [])].sort())||comparisonFingerprint(record.fieldCoverage)!==comparisonFingerprint(first.fieldCoverage))throw new Error('Repetition supported coverage differs');
  }
  const measurements={};
  for(const metric of Object.keys(measurementSources)) measurements[metric]=records.every(record=>validNumber(record.measurements?.[metric]) && record.measurementSources?.[metric]===measurementSources[metric]) ? median(records.map(record=>record.measurements[metric])) : null;
  const samples=records.map(record=>record.measurements?.runElapsedMs);
  const segments={};
  for(const segment of new Set(records.flatMap(record=>Object.keys(record.segments||{})))) {
    segments[segment]={};
    for(const metric of ['count','workMs','meanMs','p95Ms'])segments[segment][metric]=records.every(record=>validNumber(record.segments?.[segment]?.[metric])) ? median(records.map(record=>record.segments[segment][metric])) : null;
  }
  return {version:1,benchmarkRuns:[{...first,runId:stage,stage,measurements,samples,segments,repetitions:records.length,
    measurementSources:{...measurementSources},durationRangeMs:samples.every(validNumber)?{min:Math.min(...samples),max:Math.max(...samples)}:null,
    note:'Metrics are per-repetition medians. Each recorded provider/workload/environment fingerprint, source revision, flags and supported coverage must match within the stage.'}]};
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
