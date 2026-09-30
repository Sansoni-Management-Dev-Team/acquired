import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { captureResearchDatabaseDiagnostics } from './capture-research-db-diagnostics.mjs';

const flags = (telemetryBatching, progressCoalescing, schedulerCoalescing) => ({ telemetryBatching, progressCoalescing, schedulerCoalescing });
export const canaryStages = [
 { name:'measurements', flags:flags(false,false,false) },
 { name:'telemetry', flags:flags(true,false,false) },
 { name:'progress', flags:flags(true,true,false) },
 { name:'scheduling', flags:flags(true,true,true) },
 { name:'rollback-telemetry', flags:flags(false,true,true) },
 { name:'rollback-progress', flags:flags(true,false,true) },
 { name:'rollback-scheduling', flags:flags(true,true,false) },
];
export function assertCanaryScope(organizationId, userId) {
 assert.ok(/^research-canary-[a-z0-9-]+$/.test(organizationId));
 assert.equal(userId, organizationId);
}
export function canaryJobConfig(source, stage) {
 const url = new URL(source);
 assert.ok(['https://arkindustrial.com.au/','https://www.redarcelectronics.com/au/about-us'].includes(url.href) && !url.username && !url.password && !url.search && !url.hash, 'Canary source must be a bounded public company page');
 return { seeds:[url.href], searchTerms:[url.hostname==='arkindustrial.com.au'?'industrial construction':'electronics manufacturer'], geography:'Australia', approved:true, discover:false, workflow:'business', mode:'automatic', targetBusinesses:1, automaticPageLimit:1, findPeople:false, performanceFlags:{...stage.flags}, budget:{maxPages:1,maxDomains:1,maxMinutes:2,maxModelCalls:1} };
}

export async function runProductionCanaries(environment, outputDirectory) {
 assert.ok(environment.DATABASE_URL && environment.CLOUDFLARE_API_TOKEN, 'Production database and Cloudflare credentials required');
 const directory = resolve(outputDirectory); await mkdir(directory, { recursive:true, mode:0o700 });
 const id=randomUUID(), organizationId=`research-canary-${id}`, userId=organizationId, mandateId=randomUUID();
 assertCanaryScope(organizationId,userId);
 const db = new pg.Client({connectionString:environment.DATABASE_URL,...(environment.DATABASE_SSL_CA?{ssl:{ca:environment.DATABASE_SSL_CA,rejectUnauthorized:true}}:{}),connectionTimeoutMillis:10000,query_timeout:15000});
 const base='https://api.cloudflare.com/client/v4/accounts/53019d98ec6f1d1d93112558076ee677';
 const report={startedAt:new Date().toISOString(),organizationId,stages:[],migrationsApplied:false,note:'Bounded real-production correctness/rollback canaries. One public page and one logical extraction per stage; fallback may make multiple upstream requests. Cache/provider variability makes these unsuitable as an end-to-end performance benchmark.'};
 const jobs=[]; let connected=false, fixtureCreated=false;
 const cloudflare=async (path, method='GET', body)=>{
  const response=await fetch(base+path,{method,headers:{authorization:`Bearer ${environment.CLOUDFLARE_API_TOKEN}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  assert.ok(response.ok && data.success, `Cloudflare canary API failed (${response.status})`); return data.result;
 };
 const save=()=>writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 try {
  await db.connect();connected=true;
  const deployed=await cloudflare('/workers/scripts/acquire-research/deployments');report.workerVersions=deployed.deployments?.[0]?.versions;
  const source='https://www.redarcelectronics.com/au/about-us';report.source=source;
  await db.query('BEGIN');
  try {
   await db.query('INSERT INTO "user" (id,name,email) VALUES ($1,$2,$3)',[userId,'Isolated research performance canary',`${organizationId}@example.invalid`]);
   await db.query('INSERT INTO organization (id,name,slug) VALUES ($1,$2,$1)',[organizationId,'Isolated research performance canary']);
   await db.query('INSERT INTO mandates (id,organization_id,natural_language,filters,provenance,created_by) VALUES ($1,$2,$3,$4,$5,$6)',[mandateId,organizationId,'Electronics manufacturer research canary',JSON.stringify({}),JSON.stringify({source:'Isolated performance canary; no outreach'}),userId]);
   await db.query('COMMIT');fixtureCreated=true;
  } catch(error) {await db.query('ROLLBACK');throw error;}
  await writeFile(resolve(directory,'database-before.json'),JSON.stringify(await captureResearchDatabaseDiagnostics(db),null,2)+'\n',{mode:0o600});
  for(const stage of canaryStages){
   const jobId=randomUUID(),config=canaryJobConfig(source,stage);
   await db.query('INSERT INTO research_jobs (id,organization_id,mandate_id,created_by,config,seeds) VALUES ($1,$2,$3,$4,$5,$6)',[jobId,organizationId,mandateId,userId,JSON.stringify(config),JSON.stringify(config.seeds)]);
   jobs.push(jobId);
   const entry={stage:stage.name,jobId,flags:config.performanceFlags,startedAt:new Date().toISOString()};report.stages.push(entry);await save();
   await cloudflare('/workflows/acquire-research/instances','POST',{instance_id:jobId,params:{jobId}});
   let job,instance;
   const deadline=Date.now()+180000;
   while(Date.now()<deadline){
    job=(await db.query('SELECT status,config,pages,model_calls,revision,created_at,updated_at FROM research_jobs WHERE id=$1 AND organization_id=$2',[jobId,organizationId])).rows[0];
    if(['complete','partial','failed','cancelled'].includes(job.status)){
     instance=await cloudflare(`/workflows/acquire-research/instances/${jobId}`);
     if(['complete','errored','terminated'].includes(instance.status))break;
    }
    await new Promise(r=>setTimeout(r,1000));
   }
   Object.assign(entry,{status:job?.status,workflowStatus:instance?.status,pages:job?.pages,modelCalls:job?.model_calls,revision:job?.revision});await save();
   assert.ok(instance?.status==='complete',`Canary ${stage.name} did not complete successfully`);
   assert.ok(['complete','partial'].includes(job.status),`Canary ${stage.name} failed`);
   assert.ok(job.pages<=1 && job.model_calls<=1,'Canary exceeded its original budget');
   const findings=(await db.query('SELECT source_url,evidence FROM research_findings WHERE job_id=$1 AND organization_id=$2',[jobId,organizationId])).rows;
   assert.ok(findings.length,'Canary did not persist supported evidence');
   const keys=findings.map(f=>createHash('sha256').update(JSON.stringify([f.source_url,f.evidence.kind,f.evidence.name,f.evidence.value,f.evidence.quote])).digest('hex'));
   assert.equal(new Set(keys).size,keys.length,'Canary saved duplicate evidence');
   assert.deepEqual(job.config.performanceFlags,config.performanceFlags,'Run flag snapshot changed');
   for(const previous of report.stages.slice(0,-1)){
    const saved=(await db.query('SELECT config->\'performanceFlags\' AS flags FROM research_jobs WHERE id=$1 AND organization_id=$2',[previous.jobId,organizationId])).rows[0];
    assert.deepEqual(saved.flags,previous.flags,'New stage changed an earlier run snapshot');
   }
   assert.ok(Object.keys(job.config.pipelineTiming||{}).length,'Canary timings were not persisted');
   if(config.performanceFlags.schedulerCoalescing){
    let scheduling;
    for(const deadline=Date.now()+15000;Date.now()<deadline;){
     scheduling=(await db.query('SELECT config->\'scheduling\' AS state FROM research_jobs WHERE id=$1 AND organization_id=$2',[jobId,organizationId])).rows[0]?.state;
     if(scheduling?.generation>0)break;
     await new Promise(r=>setTimeout(r,300));
    }
    assert.ok(scheduling?.generation>0,'Canary did not exercise the durable scheduler');entry.schedulingGeneration=scheduling.generation;
   }
   const pending=(await db.query("SELECT count(*)::int AS n FROM research_jobs WHERE organization_id=$1 AND status NOT IN ('complete','partial','failed','cancelled')",[organizationId])).rows[0].n;
   assert.equal(pending,0,'Canary stranded queued/active work');
   Object.assign(entry,{passed:true,status:job.status,workflowStatus:instance.status,pages:job.pages,modelCalls:job.model_calls,revision:job.revision,evidenceCount:findings.length,evidenceKeys:keys.sort(),fieldKinds:[...new Set(findings.map(f=>f.evidence.kind))].sort(),timingSpans:Object.keys(job.config.pipelineTiming||{}).length,elapsedMs:job.updated_at-job.created_at,pendingJobs:pending});
   await save();console.log(`PASS production ${stage.name}: ${findings.length} supported findings, ${job.pages} page, ${job.model_calls} model call`);
  }
  report.success=true;
 } catch(error){report.success=false;report.error=error instanceof assert.AssertionError?error.message:'Production canary execution failed';}
 finally{
  for(const jobId of jobs){try{await cloudflare(`/workflows/acquire-research/instances/${jobId}/status`,'PATCH',{status:'terminate'});}catch{/* Already completed instances need no termination. */}}
  if(connected && fixtureCreated){
   try{
    assertCanaryScope(organizationId,userId);
    await writeFile(resolve(directory,'database-after.json'),JSON.stringify(await captureResearchDatabaseDiagnostics(db),null,2)+'\n',{mode:0o600});
    await db.query('BEGIN');
    for(const table of ['research_findings','research_jobs','audit_events','mandate_targets','contacts','signals','valuation_observations','coverage_runs','targets','mandates','member']){
     const exists=(await db.query('SELECT to_regclass($1) AS relation',[table])).rows[0].relation;
     if(exists)await db.query(`DELETE FROM ${table} WHERE organization_id=$1`,[organizationId]);
    }
    await db.query('DELETE FROM organization WHERE id=$1',[organizationId]);
    await db.query('DELETE FROM "user" WHERE id=$1',[userId]);
    await db.query('COMMIT');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM organization WHERE id=$1',[organizationId])).rows[0].n,0);report.cleanup='passed';
   }catch(error){await db.query('ROLLBACK').catch(()=>{});report.cleanup='failed';report.success=false;report.cleanupErrorCode=/^[A-Z0-9]{5}$/.test(error.code||'')?error.code:'cleanup_failed';}
  }
  if(connected)await db.end();
  report.finishedAt=new Date().toISOString();await save();
 }
 return report;
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 if(args.length!==2 || args[0]!=='--production'){console.error('Usage: node --env-file=.env scripts/research-production-canary.mjs --production <output-directory>');process.exitCode=1;}
 else {const report=await runProductionCanaries(process.env,args[1]);console.log(JSON.stringify({success:report.success,stages:report.stages.length,cleanup:report.cleanup,report:resolve(args[1],'report.json')}));if(!report.success)process.exitCode=1;}
}
