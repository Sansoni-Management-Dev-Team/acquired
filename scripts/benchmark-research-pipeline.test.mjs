import { expect, it } from 'vitest';
import { pipelineBenchmark, comparePipelineBenchmarks } from './benchmark-research-pipeline.mjs';
it('deduplicates companies and labels incomplete captures', () => {
  const data = pipelineBenchmark({ jobs: [{ id: 'root', pages: 2, modelCalls: 1, status: 'complete', config: { newBusinessIds: ['a'] } }, { id: 'child', pages: 3, modelCalls: 2, status: 'crawling', config: { researchRunId: 'root', newBusinessIds: ['a', 'b'] } }], timings: { root: { measuredWindowMs: 60000, spans: 5, segments: {} } }, pendingEnrichment: [{ runId: 'root' }] });
  expect(data.runs[0]).toMatchObject({ newRelevantCompanies: 2, companiesPerMeasuredMinute: 2, activeJobs: 1, pendingDeepJobs: 1, pageReads: 5 });
  expect(comparePipelineBenchmarks(data, data).comparableCompletion).toBe(false);
});

const metadata = { workloadFingerprint:'a'.repeat(64), recordingFingerprint:'b'.repeat(64), environmentFingerprint:'c'.repeat(64), sourceRevision:'123abcd' };
const capture = (changes={}) => ({version:1,benchmarkRuns:[{runId:'fixture',complete:true,activeJobs:0,pendingDeepJobs:0,metadata,performanceFlags:{telemetryBatching:false,progressCoalescing:false,schedulerCoalescing:false},measurements:{progressCallbackRequests:100,telemetryDatabaseWrites:100,schedulingScans:20,runElapsedMs:10000},measurementSources:{progressCallbackRequests:'observed_request_attempts',telemetryDatabaseWrites:'observed_database_write_attempts',schedulingScans:'observed_scheduling_selects',runElapsedMs:'job_created_to_all_jobs_terminal'},evidenceKeys:['d'.repeat(64)],fieldCoverage:{company:1,person:1},samples:[10000,10100,9900],segments:{persistence:{count:100,workMs:5000,meanMs:50,p95Ms:100}},...changes}]});
it('assesses each numerical target and stage deltas using equivalent recorded inputs and coverage',()=>{
 const before=pipelineBenchmark(capture());
 const after=pipelineBenchmark(capture({performanceFlags:{telemetryBatching:true,progressCoalescing:true,schedulerCoalescing:true},measurements:{progressCallbackRequests:50,telemetryDatabaseWrites:20,schedulingScans:5,runElapsedMs:7000},samples:[7000,6900,7100],segments:{persistence:{count:50,workMs:2000,meanMs:40,p95Ms:90}}}));
 const report=comparePipelineBenchmarks(before,after);
 expect(report.comparable).toBe(true);expect(report.coverage.status).toBe('pass');
 expect(report.targets.progressCallbacks).toMatchObject({status:'pass',reduction:0.5});
 expect(report.targets.telemetryWrites).toMatchObject({status:'pass',reduction:0.8});
 expect(report.targets.schedulingScans).toMatchObject({status:'pass',reduction:0.75});
 expect(report.targets.elapsedRun).toMatchObject({status:'pass',reduction:0.3});
 expect(report.stages.persistence).toMatchObject({countDelta:-50,workMsDelta:-3000});
});
it('retains failed targets and reduced evidence coverage instead of claiming a successful speedup',()=>{
 const report=comparePipelineBenchmarks(pipelineBenchmark(capture()),pipelineBenchmark(capture({measurements:{progressCallbackRequests:80,telemetryDatabaseWrites:80,schedulingScans:20,runElapsedMs:9000},samples:[9000,8900,9100],evidenceKeys:[],fieldCoverage:{company:1,person:0}})));
 expect(report.targets.progressCallbacks.status).toBe('fail');expect(report.targets.telemetryWrites.status).toBe('fail');expect(report.targets.schedulingScans.status).toBe('fail');expect(report.targets.elapsedRun.status).toBe('fail');expect(report.coverage.status).toBe('fail');expect(report.overall).toBe('fail');
});
it.each(['workloadFingerprint','recordingFingerprint','environmentFingerprint'])('rejects mismatched %s despite attractive ratios',key=>{
 const report=comparePipelineBenchmarks(pipelineBenchmark(capture()),pipelineBenchmark(capture({metadata:{...metadata,[key]:'e'.repeat(64)}})));
 expect(report.comparable).toBe(false);expect(report.targets.elapsedRun.status).toBe('unavailable');expect(report.reasons.join(' ')).toContain(key);
});
it('marks missing observed counters and wall-clock duration unavailable instead of deriving them from spans',()=>{
 const legacy={jobs:[{id:'root',status:'complete',config:{newBusinessIds:['a']}}],timings:{root:{measuredWindowMs:60000,segments:{persistence:{count:874}},coverage:{company:1}}}};
 const report=comparePipelineBenchmarks(pipelineBenchmark(legacy),pipelineBenchmark(legacy));
 expect(report.targets.progressCallbacks.status).toBe('unavailable');expect(report.targets.telemetryWrites.status).toBe('unavailable');expect(report.targets.elapsedRun.status).toBe('unavailable');
});
it('requires repeat duration samples and unambiguous complete captures',()=>{
 const a=pipelineBenchmark(capture());
 const short=comparePipelineBenchmarks(a,pipelineBenchmark(capture({samples:[7000]})));
 expect(short.targets.elapsedRun.status).toBe('unavailable');
 const incomplete=comparePipelineBenchmarks(a,pipelineBenchmark(capture({complete:false,activeJobs:1})));
 expect(incomplete.comparable).toBe(false);
 const ambiguous=comparePipelineBenchmarks(a,{runs:[...a.runs,...a.runs]});expect(ambiguous.comparable).toBe(false);expect(ambiguous.reasons).toContain('Select exactly one run from each capture');
});
it('never turns absent or invalid measurement values into zero successes',()=>{
 const b=pipelineBenchmark(capture({measurements:{progressCallbackRequests:null,telemetryDatabaseWrites:-1,schedulingScans:'0',runElapsedMs:0},samples:[0,0,0]}));
 const report=comparePipelineBenchmarks(pipelineBenchmark(capture()),b);
 for(const target of Object.values(report.targets))expect(target.status).toBe('unavailable');
});

it('hashes semantic evidence consistently across database IDs/timestamps and rejects unsupported rows', async()=>{
 const {evidenceCoverageKeys,comparisonFingerprint}=await import('./benchmark-research-pipeline.mjs');
 const evidence={kind:'company',name:'Alpha',value:'Alpha',quote:' Alpha  manufactures sensors. ',website:'https://alpha.example/'};
 expect(evidenceCoverageKeys([{id:'one',observedAt:'old',evidence}])).toEqual(evidenceCoverageKeys([{id:'two',observedAt:'new',evidence:{...evidence,quote:'alpha manufactures sensors.'}}]));
 expect(evidenceCoverageKeys([{evidence:{...evidence,quote:''}}])).toEqual([]);
 expect(comparisonFingerprint({budget:{pages:2,calls:3},scope:'sensors'})).toBe(comparisonFingerprint({scope:'sensors',budget:{calls:3,pages:2}}));
});
it('withholds speedup ratios when inputs differ and reports unknown coverage as unavailable',()=>{
 const a=pipelineBenchmark(capture({timeToTargetMs:1000,companiesPerMeasuredMinute:2}));
 const mismatch=comparePipelineBenchmarks(a,pipelineBenchmark(capture({timeToTargetMs:500,companiesPerMeasuredMinute:4,metadata:{...metadata,recordingFingerprint:'e'.repeat(64)}})));
 expect(mismatch.timeToTargetSpeedup).toBeNull();expect(mismatch.throughputRatio).toBeNull();
 const unknown=comparePipelineBenchmarks(a,pipelineBenchmark(capture({evidenceKeys:undefined})));expect(unknown.coverage.status).toBe('unavailable');expect(unknown.targets.elapsedRun.status).toBe('unavailable');
});

it('counts actual request/database attempts from scoped logs and audited query fingerprints, deduplicating copied log lines',async()=>{
 const {observedPipelineCounters}=await import('./benchmark-research-pipeline.mjs');
 const progress={provider:'research-worker',event:'request_started',operation:'callback_progress',jobId:'job',requestId:'request-1',timestamp:'time'};
 const telemetry={event:'query_finished',operation:'update',jobId:'job',queryId:'query-1',queryFingerprint:'abc123',outcome:'failed'};
 const scan={event:'query_finished',operation:'select',jobId:'job',queryId:'query-2',queryFingerprint:'def123',outcome:'succeeded'};
 const logs=`research-provider ${JSON.stringify(progress)}\nresearch-provider ${JSON.stringify(progress)}\nresearch-db ${JSON.stringify(telemetry)}\nresearch-db ${JSON.stringify(scan)}\nresearch-db ${JSON.stringify({...scan,jobId:'other',queryId:'other'})}\n`;
 expect(observedPipelineCounters(logs,{jobIds:['job'],completeLogs:true,queryManifest:{telemetryWrites:['abc123'],schedulingScans:['def123']}})).toMatchObject({progressCallbackRequests:1,telemetryDatabaseWrites:1,schedulingScans:1});
 expect(observedPipelineCounters(logs,{jobIds:['job'],completeLogs:false}).telemetryDatabaseWrites).toBeNull();
 expect(observedPipelineCounters(logs,{jobIds:['job'],completeLogs:true}).schedulingScans).toBeNull();
});
it('aggregates matching recorded repetitions with medians and rejects changed workloads or coverage',async()=>{
 const {aggregateRecordedCaptures}=await import('./benchmark-research-pipeline.mjs');
 const samples=[9000,10000,11000].map(duration=>capture({measurements:{progressCallbackRequests:100,telemetryDatabaseWrites:100,schedulingScans:20,runElapsedMs:duration}}));
 const combined=aggregateRecordedCaptures(samples,'baseline');expect(combined.benchmarkRuns[0].samples).toEqual([9000,10000,11000]);expect(combined.benchmarkRuns[0].measurements.runElapsedMs).toBe(10000);
 expect(()=>aggregateRecordedCaptures([...samples,capture({metadata:{...metadata,recordingFingerprint:'e'.repeat(64)}})],'baseline')).toThrow(/recordingFingerprint/);
 expect(()=>aggregateRecordedCaptures([...samples,capture({evidenceKeys:[]})],'baseline')).toThrow(/coverage/);
});
