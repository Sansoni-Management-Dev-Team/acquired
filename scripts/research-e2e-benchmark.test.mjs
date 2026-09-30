import {expect,it} from 'vitest';
import {captureResearchBenchmarkSample} from './research-e2e-benchmark.mjs';
const id='job',metadata={workloadFingerprint:'a'.repeat(64),recordingFingerprint:'b'.repeat(64),environmentFingerprint:'c'.repeat(64),sourceRevision:'123abcd'};
const flags={telemetryBatching:false,progressCoalescing:false,schedulerCoalescing:false};
const input={jobs:[{id,status:'complete',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-01T00:00:10Z',config:{performanceFlags:flags}}],findings:[{source_url:'https://alpha.example/',evidence:{kind:'company',name:'Alpha',value:'Alpha',quote:'Alpha manufactures sensors.'}}],fixtureEvents:[{jobId:id,phase:'after',action:'progress',revision:1},{jobId:id,phase:'after',action:'progress',revision:1},{jobId:'other',phase:'after',action:'progress'}],appLog:'research-db {"event":"query_finished","queryId":"t1","jobId":"job","operation":"update","stage":"telemetry"}\nresearch-db {"event":"query_finished","queryId":"s1","jobId":"job","operation":"select","stage":"coordination","action":"dispatch"}\nresearch-db {"event":"query_finished","queryId":"s1","jobId":"job","operation":"select","stage":"coordination","action":"dispatch"}',metadata,expectedFlags:flags};
it('captures actual attempt counts, duration and semantic coverage, excluding unrelated jobs',()=>{
 const record=captureResearchBenchmarkSample(input).benchmarkRuns[0];expect(record.measurements).toEqual({progressCallbackRequests:2,telemetryDatabaseWrites:1,schedulingScans:1,runElapsedMs:10000});expect(record.evidenceKeys).toHaveLength(1);expect(record.fieldCoverage).toEqual({company:1});
});
it('rejects missing telemetry attribution, flag drift, incomplete jobs and enabled faults',()=>{
 expect(()=>captureResearchBenchmarkSample({...input,appLog:''})).toThrow(/telemetry/);
 expect(()=>captureResearchBenchmarkSample({...input,expectedFlags:{...flags,telemetryBatching:true}})).toThrow(/flags/);
 expect(()=>captureResearchBenchmarkSample({...input,jobs:[{...input.jobs[0],status:'queued'}]})).toThrow(/terminal/);
 expect(()=>captureResearchBenchmarkSample({...input,fixtureEvents:[...input.fixtureEvents,{jobId:id,timingFailure:true}]})).toThrow(/fault/);
});

it('keeps a safe claim audit trail for explaining coverage loss without recording arbitrary evidence metadata',()=>{
 const findings=input.findings.map(row=>({...row,evidence:{...row.evidence,private:'secret',apiKey:'credential'}}));
 const record=captureResearchBenchmarkSample({...input,findings}).benchmarkRuns[0];
 expect(record.evidenceClaims).toEqual([{key:record.evidenceKeys[0],sourceUrl:'https://alpha.example/',kind:'company',name:'Alpha',value:'Alpha',quote:'Alpha manufactures sensors.'}]);
 expect(JSON.stringify(record.evidenceClaims)).not.toMatch(/secret|credential|apiKey|private/);
});
