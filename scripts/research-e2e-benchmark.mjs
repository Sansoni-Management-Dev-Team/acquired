import {comparisonFingerprint,evidenceCoverageKeys} from './benchmark-research-pipeline.mjs';
const terminal=new Set(['complete','partial','failed','cancelled']);
/** Real fixture events and application query-attempt logs; no inferred span counts. */
export function captureResearchBenchmarkSample({jobs,findings,fixtureEvents,appLog,metadata,expectedFlags}) {
 if(!jobs.length||jobs.some(job=>!terminal.has(job.status)))throw new Error('Every benchmark job must be terminal');
 if(jobs.some(job=>job.status==='failed'||job.status==='cancelled'))throw new Error('Failed/cancelled workloads cannot serve as a completed performance benchmark');
 if(jobs.some(job=>comparisonFingerprint(job.config?.performanceFlags)!==comparisonFingerprint(expectedFlags)))throw new Error('Saved performance flags differ from the requested benchmark stage');
 const ids=new Set(jobs.map(job=>job.id));
 const events=fixtureEvents.filter(event=>ids.has(event.jobId));
 if(events.some(event=>event.timingFailure||event.dropProgressResponse))throw new Error('Benchmark fault injection must be disabled');
 const queries=[];const seen=new Set();
 for(const line of appLog.split('\n')) {
  const match=/\bresearch-db\s+(\{.*\})\s*$/.exec(line);if(!match)continue;
  let event;try{event=JSON.parse(match[1]);}catch{continue;}
  if(event.event!=='query_finished'||(!ids.has(event.jobId)&&!ids.has(event.runId))||!event.queryId||seen.has(event.queryId))continue;
  seen.add(event.queryId);queries.push(event);
 }
 const telemetry=queries.filter(event=>event.operation==='update'&&event.stage==='telemetry');
 if(!telemetry.length)throw new Error('Missing attributed telemetry database write attempts; do not infer them from spans');
 const scheduling=queries.filter(event=>event.operation==='select'&&event.stage==='coordination'&&event.action==='dispatch');
 const first=Math.min(...jobs.map(job=>new Date(job.created_at||job.createdAt).getTime()));
 const last=Math.max(...jobs.map(job=>new Date(job.updated_at||job.updatedAt).getTime()));
 if(!Number.isFinite(first)||!Number.isFinite(last)||last<=first)throw new Error('Persisted creation/terminal timestamps are required');
 const fieldCoverage={}, fieldKeys=new Map();
 for(const row of findings) {
  const evidence=row.evidence||row;if(!evidence.kind||!evidence.quote)continue;
  const key=evidenceCoverageKeys([row])[0];if(!key)continue;
  const field=evidence.kind;const keys=fieldKeys.get(field)||new Set();keys.add(key);fieldKeys.set(field,keys);
  if(evidence.email){const emails=fieldKeys.get('published_email')||new Set();emails.add(key);fieldKeys.set('published_email',emails);}
 }
 for(const [field,keys] of fieldKeys)fieldCoverage[field]=keys.size;
 const segments={},seenSpans=new Set();
 for(const job of jobs)for(const span of Object.values(job.config?.pipelineTiming||{})) {
  if(!span?.id||seenSpans.has(span.id)||typeof span.elapsedMs!=='number'||span.elapsedMs<0||!Number.isFinite(span.elapsedMs))continue;
  seenSpans.add(span.id);const list=segments[span.segment]||[];list.push(span.elapsedMs);segments[span.segment]=list;
 }
 for(const [name,list] of Object.entries(segments)) {list.sort((a,b)=>a-b);const workMs=list.reduce((sum,value)=>sum+value,0);segments[name]={count:list.length,workMs,meanMs:workMs/list.length,p95Ms:list[Math.ceil(list.length*0.95)-1]};}
 const evidenceKeys=evidenceCoverageKeys(findings);
 const claims=new Map();
 for(const row of findings) {
  const key=evidenceCoverageKeys([row])[0];if(!key||claims.has(key))continue;
  const evidence=row.evidence||row;
  claims.set(key,{key,sourceUrl:row.sourceUrl||row.source_url||evidence.website,kind:evidence.kind,name:evidence.name,value:evidence.value,quote:evidence.quote,...(evidence.email?{publishedEmail:evidence.email}:{})});
 }
 const evidenceClaims=[...claims.values()].sort((a,b)=>a.key.localeCompare(b.key));
 if(!evidenceKeys.length)throw new Error('No validated supported evidence coverage');
 return {version:1,benchmarkRuns:[{runId:jobs[0].id,complete:true,activeJobs:0,pendingDeepJobs:0,metadata,performanceFlags:expectedFlags,
  measurements:{progressCallbackRequests:events.filter(event=>event.phase==='after'&&event.action==='progress').length,telemetryDatabaseWrites:telemetry.length,schedulingScans:scheduling.length,runElapsedMs:last-first},
  measurementSources:{progressCallbackRequests:'observed_request_attempts',telemetryDatabaseWrites:'observed_database_write_attempts',schedulingScans:'observed_scheduling_selects',runElapsedMs:'job_created_to_all_jobs_terminal'},
  evidenceKeys,evidenceClaims,fieldCoverage,segments,jobCount:jobs.length,
  observedTelemetryQueryFingerprints:[...new Set(telemetry.map(event=>event.queryFingerprint).filter(Boolean))],
  note:'Scheduling counts executed selects in the actual dispatch context, including failed attempts. Telemetry writes require explicit telemetry attribution. Compatibility stage is current code with flags disabled, not the historic production baseline.'}]};
}
