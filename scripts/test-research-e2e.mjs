// Actual local Next.js → workerd Workflow → OrbStack Chromium/PostgreSQL.
// No migrations. All mutable records belong to one disposable synthetic org.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, symlinkSync, cpSync, createWriteStream } from 'node:fs';
import { resolve,relative } from 'node:path';
import { readdirSync,statSync } from 'node:fs';
import os from 'node:os';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { researchE2eConfig,parseResearchE2eArguments,researchBenchmarkStages } from './research-e2e-config.mjs';
import { localWorkerConfig, LOCAL_DATABASE_URL } from './dev-config.mjs';
import {captureResearchBenchmarkSample} from './research-e2e-benchmark.mjs';
import {aggregateRecordedCaptures,comparisonFingerprint} from './benchmark-research-pipeline.mjs';
import { checkLocalResearchSchema } from './local-research-schema.mjs';

const root=process.cwd();
const {live,benchmarkStage}=parseResearchE2eArguments(process.argv.slice(2));
const run=randomUUID(), directory=resolve('.local-data/research-e2e',run);
mkdirSync(directory,{recursive:true,mode:0o700});
const report={mode:benchmarkStage?'benchmark':live?'live':'deterministic',benchmarkStage,startedAt:new Date().toISOString(),checks:[],jobs:[]};
const children=[], active=new Set();
const organizationId=`research-e2e-${run}`;
let userId,cookie,readerStarted=false,connected=false,cleaned=false;
const container=`acquire-research-e2e-${run}`;
const db=new pg.Client({connectionString:LOCAL_DATABASE_URL,connectionTimeoutMillis:10000,query_timeout:15000});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){ return new Promise((yes,no)=>{ const s=createServer();s.once('error',no);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>yes(port));}); }); }
const ports=[];while(ports.length<4){const p=await freePort();if(!ports.includes(p))ports.push(p);}
const [appPort,workerPort,fixturePort,readerPort]=ports;
const secret=randomBytes(32).toString('hex');
let environment={};if(live){try{environment=parseEnv(readFileSync('.env.local','utf8'));}catch{} environment.OPENROUTER_API_KEY ||= process.env.OPENROUTER_API_KEY;}
const config=researchE2eConfig({appPort,workerPort,fixturePort,readerPort,secret,authSecret:randomBytes(32).toString('hex'),live,environment,benchmarkStage});
const app=`http://127.0.0.1:${appPort}`,worker=`http://127.0.0.1:${workerPort}`,fixtures=`http://127.0.0.1:${fixturePort}`;
function passed(name){ report.checks.push(name);console.log(`PASS ${name}`); }
function start(label,command,args,env){
 const log=createWriteStream(resolve(directory,`${label}.log`),{mode:0o600});
 const child=spawn(command,args,{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(log);child.stderr.pipe(log);children.push(child);
 child.on('error',error=>console.error(`${label} startup failed: ${error.code}`));return child;
}
async function ready(url,accept,timeout=90000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){
  if(children.some(c=>c.exitCode!==null))throw new Error(`A local test process exited; inspect ${directory}`);
  try{const response=await fetch(url,{signal:AbortSignal.timeout(2000)});if(accept(response))return;}catch{}
  await pause(300);
 }
 throw new Error(`Local test service did not become ready: ${new URL(url).pathname}`);
}
async function api(path,body,auth='user',base=app,extraHeaders={}){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',origin:app,...(auth==='user'&&cookie?{cookie}:auth==='service'?{authorization:`Bearer ${secret}`}:{}) ,...extraHeaders},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 return {response,status:response.status,data:await response.json().catch(()=>({}))};
}
async function control(body){const r=await api('/__control',body,'none',fixtures);assert.equal(r.status,200);return r.data;}
async function events(){return (await api('/__events',undefined,'none',fixtures)).data;}
async function row(id){return (await db.query('SELECT * FROM research_jobs WHERE id=$1 AND organization_id=$2',[id,organizationId])).rows[0];}
async function terminal(id,timeout=150000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){const r=await row(id);if(r&&['complete','partial','failed','cancelled'].includes(r.status)){active.delete(id);return r;}await pause(300);}
 throw new Error(`Research job ${id} exceeded test timeout`);
}
async function settled(id){
 for(const deadline=Date.now()+90000;Date.now()<deadline;){const r=await api(`/jobs/${id}`,undefined,'service',worker);if(['complete','terminated','errored'].includes(r.data.status))return r.data;await pause(300);}
 throw new Error(`Workflow ${id} did not settle`);
}
const seeds=live?[process.env.RESEARCH_E2E_LIVE_URL||'https://arkindustrial.com.au/']:['https://alpha.instruments.example.com/'];
const researchConfig=(id= randomUUID(),urls=seeds)=>({requestId:id,seeds:urls,searchTerms:[live?'industrial construction':'industrial sensors'],geography:'Australia',approved:true,discover:false,workflow:'business',budget:{maxPages:1,maxDomains:1,maxMinutes:2,maxModelCalls:1}});
function fileTreeFingerprint(paths,base=root) {
 const entries=[];
 const visit=path=>{if(statSync(path).isDirectory())for(const name of readdirSync(path).sort())visit(resolve(path,name));else entries.push([relative(base,path),readFileSync(path).toString('base64')]);};
 for(const path of paths)visit(resolve(base,path));
 return comparisonFingerprint(entries);
}
async function resetBenchmarkRecords() {
 // All of these rows belong solely to this command's synthetic organization.
 await db.query('BEGIN');
 try {
  for(const table of ['research_findings','research_jobs','audit_events','mandate_targets','contacts','signals','targets'])await db.query(`DELETE FROM ${table} WHERE organization_id=$1`,[organizationId]);
  await db.query('COMMIT');
 }catch(error){await db.query('ROLLBACK');throw error;}
 active.clear();
 const reset=await api('/__reset-pages',{},'service',worker);assert.equal(reset.status,200);
 await control({reset:true});
 // Same website/browser cooldown and warm-process policy for every repetition.
 await pause(3500);
}
async function benchmarkTerminal(rootId,timeout=600000) {
 const deadline=Date.now()+timeout;let stableSince;
 while(Date.now()<deadline) {
  const jobs=(await db.query('SELECT * FROM research_jobs WHERE organization_id=$1 ORDER BY created_at,id',[organizationId])).rows;
  const ready=jobs.length&&jobs.some(job=>job.id===rootId)&&jobs.every(job=>['complete','partial','failed','cancelled'].includes(job.status));
  if(ready) {
   stableSince ||= Date.now();
   if(Date.now()-stableSince>=2000){for(const job of jobs){await settled(job.id);active.delete(job.id);}await pause(500);return jobs;}
  }else stableSince=undefined;
  await pause(300);
 }
 throw new Error(`Benchmark run ${rootId} has unfinished jobs after ${timeout}ms`);
}
async function runBenchmark() {
 const samples=[],flags=researchBenchmarkStages[benchmarkStage];
 const workload={seeds:['https://alpha.instruments.example.com/'],searchTerms:['industrial sensors'],geography:'Australia',approved:true,discover:true,workflow:'business',mode:'automatic',targetBusinesses:3,researchEffort:'focused',budget:{maxPages:1,maxDomains:1,maxMinutes:2,maxModelCalls:1}};
 const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const metadata={workloadFingerprint:comparisonFingerprint({...workload,automaticBudgets:'automaticResearchConfig current source',initialState:'empty synthetic org, cleared public fixture pages, fresh private run key',faults:'none',warmup:'one complete unmeasured run; 3500ms cooldown'}),recordingFingerprint:fileTreeFingerprint(['tests/research-e2e/fixture-server.mjs','tests/research-e2e/reader.py','cloudflare/crawl4ai/server.py','cloudflare/crawl4ai/Dockerfile','cloudflare/crawl4ai/requirements.txt'],benchmarkSource),environmentFingerprint:comparisonFingerprint({platform:process.platform,arch:process.arch,node:process.version,cpu:os.cpus()[0]?.model,memory:os.totalmem(),lock:fileTreeFingerprint(['pnpm-lock.yaml']),source:fileTreeFingerprint(['src/domain','src/lib','src/db','src/adapters','src/app/api','cloudflare/research'],benchmarkSource),observer:fileTreeFingerprint(['scripts/test-research-e2e.mjs','scripts/research-e2e-benchmark.mjs','scripts/benchmark-research-pipeline.mjs','scripts/research-e2e-config.mjs'],benchmarkSource),readerImage:execFileSync('docker',['--context','orbstack','image','inspect',readerImageForBenchmark,'--format','{{.Id}}'],{encoding:'utf8'}).trim(),readerConcurrency:2,cooldownMs:3500,cachePolicy:'clear fixture public pages, unique private run keys'}),sourceRevision};
 report.benchmarkLabel='Current compatibility code with cumulative flag stages; not the historical 874-operation production baseline';
 // GET compiles progress polling routes before the measured execution.
 await api(`/api/mandates/${mandateId}/research`);
 for(let sample=-1;sample<3;sample++) {
  await resetBenchmarkRecords();
  const id=randomUUID();await startJob({...workload,requestId:id});
  const jobs=await benchmarkTerminal(id);
  assert.ok(jobs.every(job=>job.status!=='failed'&&job.status!=='cancelled'),'Every benchmark job must finish successfully');
  for(const job of jobs)report.jobs.push(job.id);
  const findings=(await db.query('SELECT source_url,evidence FROM research_findings WHERE organization_id=$1 ORDER BY source_url,evidence_key',[organizationId])).rows;
  const captured=await events();assert.ok(captured.counters.page>0,'A cleared fixture page must actually be read, rather than reused from cache');
  assert.equal(captured.counters.blockedOutbound||0,0);
  const record=captureResearchBenchmarkSample({jobs,findings,fixtureEvents:captured.events,appLog:readFileSync(resolve(directory,'app.log'),'utf8'),metadata,expectedFlags:flags});
  if(sample>=0){writeFileSync(resolve(directory,`benchmark-jobs-${sample+1}.json`),JSON.stringify(jobs.map(job=>({id:job.id,status:job.status,task:job.config?.researchTask,field:job.config?.researchField,domain:job.config?.companyDomain,pages:job.pages,modelCalls:job.model_calls,createdAt:job.created_at,updatedAt:job.updated_at})),null,2),{mode:0o600});samples.push(record);writeFileSync(resolve(directory,`benchmark-sample-${sample+1}.json`),JSON.stringify(record,null,2),{mode:0o600});}
  passed(`${sample<0?'Warm-up':`Benchmark repetition ${sample+1}`} completed ${jobs.length} real Workflow jobs`);
 }
 const aggregate=aggregateRecordedCaptures(samples,benchmarkStage);
 report.benchmark=aggregate;
 writeFileSync(resolve(directory,'benchmark.json'),JSON.stringify(aggregate,null,2),{mode:0o600});
 passed(`Three comparable deterministic repetitions recorded for ${benchmarkStage}`);
}
let readerImageForBenchmark,benchmarkSource=root;
let mandateId;
async function startJob(input=researchConfig()){
 const r=await api(`/api/mandates/${mandateId}/research`,input);assert.equal(r.status,202,JSON.stringify(r.data));active.add(r.data.jobId);report.jobs.push(r.data.jobId);return r.data.jobId;
}
async function cleanup(){
 if(cleaned)return;cleaned=true;
 // Cancel only this run's jobs, then stop local execution before deleting its rows.
 for(const id of active)await api(`/api/research/${id}`,{action:'cancel'}).catch(()=>{});
 for(const child of children){try{process.kill(-child.pid,'SIGTERM');}catch{}}
 await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>{const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}resolve();},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});})));
 if(readerStarted){try{execFileSync('docker',['--context','orbstack','rm','-f',container],{stdio:'ignore',timeout:10000});}catch{report.cleanupError='Unable to stop test reader container';}}
 if(connected){
  try{
   await db.query('BEGIN');
   assert.ok(organizationId.startsWith('research-e2e-'));
   for(const table of ['research_findings','research_jobs','audit_events','mandate_targets','contacts','signals','targets','mandates','member'])await db.query(`DELETE FROM ${table} WHERE organization_id=$1`,[organizationId]);
   await db.query('DELETE FROM organization WHERE id=$1',[organizationId]);
   if(userId)await db.query('DELETE FROM "user" WHERE id=$1',[userId]);
   await db.query('COMMIT');
   assert.equal((await db.query('SELECT count(*)::int AS n FROM organization WHERE id=$1',[organizationId])).rows[0].n,0);
  }catch(error){await db.query('ROLLBACK').catch(()=>{});report.cleanupError=`Fixture cleanup failed (${error.code||error.name}); inspect scoped test organization ${organizationId}`;process.exitCode=1;}
  await db.end();
 }
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{process.exitCode=1;void cleanup();});
try{
 await db.connect();connected=true;await checkLocalResearchSchema(db);
 assert.equal(execFileSync('docker',['context','show'],{encoding:'utf8'}).trim(),'orbstack','Select the OrbStack Docker context first');
 const readerImage=process.env.RESEARCH_E2E_READER_IMAGE||'project-acquire-crawl4ai:latest';readerImageForBenchmark=readerImage;
 if(benchmarkStage) {
  benchmarkSource=resolve(directory,'source');mkdirSync(benchmarkSource);
  for(const path of ['src','cloudflare/research','cloudflare/crawl4ai','tests/research-e2e'])cpSync(resolve(root,path),resolve(benchmarkSource,path),{recursive:true});
  for(const path of ['scripts/test-research-e2e.mjs','scripts/research-e2e-benchmark.mjs','scripts/benchmark-research-pipeline.mjs','scripts/research-e2e-config.mjs']){mkdirSync(resolve(benchmarkSource,'scripts'),{recursive:true});cpSync(resolve(root,path),resolve(benchmarkSource,path));}
  symlinkSync(resolve(root,'node_modules'),resolve(benchmarkSource,'node_modules'));
  writeFileSync(resolve(benchmarkSource,'tsconfig.json'),readFileSync('tsconfig.json'));
 }
 if(!live){
  start('fixtures',process.execPath,[resolve(benchmarkSource,'tests/research-e2e/fixture-server.mjs')],{...config.app,E2E_FIXTURE_PORT:String(fixturePort)});
  await ready(fixtures+'/health',r=>r.ok);
  readerStarted=true;
  execFileSync('docker',['--context','orbstack','run','-d','--rm','--name',container,'--shm-size','1g','-p',`127.0.0.1:${readerPort}:8080`,'--add-host','host.docker.internal:host-gateway','-e',`E2E_FIXTURE_ORIGIN=${config.reader.E2E_FIXTURE_ORIGIN}`,'-e','CRAWL4AI_CONCURRENCY=2','-v',`${benchmarkSource}/cloudflare/crawl4ai/server.py:/app/server.py:ro`,'-v',`${benchmarkSource}/tests/research-e2e/reader.py:/app/e2e_reader.py:ro`,readerImage,'python','/app/e2e_reader.py'],{stdio:'pipe',timeout:30000});
  await ready(`http://127.0.0.1:${readerPort}/health`,r=>r.ok);
 }else await ready('http://127.0.0.1:18083/health',r=>r.ok,5000);
 const workerConfiguration=localWorkerConfig(JSON.parse(readFileSync('cloudflare/research/wrangler.jsonc','utf8')),app,resolve(benchmarkSource,live?'cloudflare/research/index.ts':'cloudflare/research/e2e/worker.ts'),'production');
 workerConfiguration.vars=config.worker;
 writeFileSync(resolve(directory,'wrangler.json'),JSON.stringify(workerConfiguration,null,2),{mode:0o600});
 start('worker','pnpm',['exec','wrangler','dev','--local','--config',resolve(directory,'wrangler.json'),'--ip','127.0.0.1','--port',String(workerPort),'--inspector-port','0','--persist-to',resolve(directory,'state'),'--show-interactive-dev-session=false'],{...config.app,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',CLOUDFLARE_INCLUDE_PROCESS_ENV:'false'});
 await ready(worker+'/',r=>r.status===401);
 const project=resolve(directory,'app');mkdirSync(project);
 for(const path of ['src','public'])cpSync(resolve(path==='src'?benchmarkSource:root,path),resolve(project,path),{recursive:true});
 for(const path of ['node_modules','postcss.config.mjs'])symlinkSync(resolve(root,path),resolve(project,path));
 writeFileSync(resolve(project,'package.json'),readFileSync('package.json'));
 const ts=JSON.parse(readFileSync('tsconfig.json','utf8'));ts.compilerOptions.incremental=false;ts.include=['next-env.d.ts','src/**/*.ts','src/**/*.tsx','.next/types/**/*.ts','.next/dev/types/**/*.ts'];ts.exclude=['node_modules'];
 writeFileSync(resolve(project,'tsconfig.json'),JSON.stringify(ts,null,2));
 writeFileSync(resolve(project,'next.config.mjs'),`export default { poweredByHeader:false, turbopack:{root:${JSON.stringify(root)}} };\n`);
 start('app',process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev',project,'--hostname','127.0.0.1','--port',String(appPort)],config.app);
 await ready(app+'/api/mandates',r=>r.status===401);
 // Compile callback routes before starting the Workflow's bounded callbacks.
 assert.equal((await api('/api/research/internal/'+randomUUID(),undefined,'none')).status,403);
 const signup=await api('/api/auth/sign-up/email',{name:'Research E2E',email:`research-e2e-${run}@example.invalid`,password:`Test-${randomUUID()}!`},'none');
 assert.equal(signup.status,200,JSON.stringify(signup.data));userId=signup.data.user.id;
 cookie=signup.response.headers.getSetCookie().map(v=>v.split(';')[0]).find(v=>v.includes('session_token='));assert.ok(cookie);
 await db.query('INSERT INTO organization (id,name,slug) VALUES ($1,$2,$1)',[organizationId,'Research E2E']);
 await db.query("INSERT INTO member (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')",[randomUUID(),organizationId,userId]);
 await db.query('UPDATE session SET active_organization_id=$1 WHERE user_id=$2',[organizationId,userId]);
 const keys=['subsectors','geography','revenue','revenueCeiling','headcount','ebitda','margin','accreditations','management','ownerDependence','multiple','payback','vendorMotivation','sellerEngagement','property','structure','concentration','timing','dealBreakers'];
 const created=await api('/api/mandates',{name:`Research E2E ${run}`,naturalLanguage:'Industrial sensor manufacturers in Australia',investmentThesis:'',outreachPositioning:'',disclosureApproved:false,criteria:keys.map(key=>({key,value:key==='subsectors'?'industrial sensors':key==='geography'?'Australia':'',importance:'preference',origin:'supplied',state:['subsectors','geography'].includes(key)?'specified':'unrestricted',confirmed:true}))});
 assert.equal(created.status,201,JSON.stringify(created.data));mandateId=created.data.id;
 passed('Synthetic authenticated account and mandate persist through real APIs');
 if(benchmarkStage){await runBenchmark();}else{
 const id=randomUUID();
 if(!live)await control({dropProgressResponseOnceJobId:id});
 const input=researchConfig(id);await startJob(input);
 const duplicate=await api(`/api/mandates/${mandateId}/research`,input);assert.equal(duplicate.status,202);assert.equal(duplicate.data.jobId,id);
 const done=await terminal(id);const workflow=await settled(id);assert.equal(workflow.status,'complete','The evidence-producing Workflow must finish successfully');
 report.workflowStatuses={[id]:workflow.status};
 assert.ok(['complete','partial'].includes(done.status),done.message);
 assert.equal(done.pages,1,done.message);assert.equal(done.model_calls,1,done.message);
 const findings=(await db.query('SELECT evidence_key,source_url,evidence FROM research_findings WHERE job_id=$1',[id])).rows;
 assert.ok(findings.length,'Supported findings must survive the real pipeline');
 assert.equal(new Set(findings.map(f=>f.evidence_key)).size,findings.length);
 assert.ok(Object.keys((await row(id)).config.pipelineTiming||{}).length,'Timing spans must be persisted');
 passed('Real Chromium → Workflow extraction → PostgreSQL saves source-supported evidence within budget');
 if(!live){
  const captured=await events();
  assert.ok(captured.events.some(e=>e.jobId===id&&e.dropProgressResponse),'Lost successful response must actually be injected');
  assert.ok(captured.events.some(e=>e.jobId===id&&e.timingAcceptedIds?.length),'Piggyback timing IDs must be acknowledged');
  passed('Lost progress response retries without duplicating evidence; timing IDs are acknowledged');
  const betaId=randomUUID();
  await control({timingFailureOnceJobId:betaId,openrouterStatusOnce:404});
  await startJob(researchConfig(betaId,['https://beta.instruments.example.com/']));
  const beta=await terminal(betaId);const betaWorkflow=await settled(betaId);assert.equal(betaWorkflow.status,'complete','The telemetry retry Workflow must finish successfully');report.workflowStatuses[betaId]=betaWorkflow.status;
  assert.ok(['complete','partial'].includes(beta.status),beta.message);
  assert.ok(Object.keys((await row(betaId)).config.pipelineTiming||{}).length);
  const betaEvents=(await events()).events;
  assert.ok(betaEvents.some(e=>e.jobId===betaId&&e.timingFailure),'Telemetry failure must actually be injected');
  assert.ok(betaEvents.some(e=>e.jobId===betaId&&e.timingAcceptedIds?.length),'Retried telemetry must eventually be acknowledged');
  passed('Unavailable free route falls back deterministically; failed timing delivery recovers');
  const heartbeatId=randomUUID();
  await db.query("INSERT INTO research_jobs (id,organization_id,mandate_id,created_by,status,config,seeds) VALUES ($1,$2,$3,$4,'queued',$5,$6)",[heartbeatId,organizationId,mandateId,userId,{...input,performanceFlags:{telemetryBatching:true,progressCoalescing:true,schedulerCoalescing:true}},JSON.stringify(seeds)]);report.jobs.push(heartbeatId);
  const spanId=randomUUID(),now=new Date().toISOString();
    const heartbeat={status:'crawling',revision:1,pages:0,modelCalls:0,message:'Test heartbeat',timingSpans:[{id:spanId,step:'test',segment:'control',startedAt:now,finishedAt:now,elapsedMs:0,outcome:'succeeded'}]};
  // Direct callbacks also verify explicit durable acknowledgement and query ceilings.
  const saved=await api(`/api/research/internal/${heartbeatId}`,heartbeat,'service');assert.equal(saved.status,200);assert.ok(saved.data.timingAcceptedIds.includes(spanId));assert.ok(Number(saved.response.headers.get('x-research-db-calls'))<=3);
  report.databaseCalls={heartbeat:Number(saved.response.headers.get('x-research-db-calls'))};
  const replay=await api(`/api/research/internal/${heartbeatId}`,heartbeat,'service');assert.equal(replay.status,200);assert.equal((await row(heartbeatId)).revision,1);assert.ok(Number(replay.response.headers.get('x-research-db-calls'))<=2);
  report.databaseCalls.replay=Number(replay.response.headers.get('x-research-db-calls'));
  const rejected=await api(`/api/research/internal/${heartbeatId}`,{...heartbeat,revision:2,pages:2},'service');assert.equal(rejected.status,409);assert.equal((await row(heartbeatId)).pages,0);
  await db.query("UPDATE research_jobs SET status='cancelled' WHERE id=$1 AND organization_id=$2",[heartbeatId,organizationId]);
  passed('Heartbeat, replay and budget rejection use bounded real database requests');
  const token=randomUUID();
  const reserved=await api('/__reserve',{jobId:id,token,provider:'search'},'service',worker);assert.equal(reserved.status,200,JSON.stringify(reserved.data));assert.ok(reserved.data.granted);
  const search=await api('/search',{query:'industrial sensors Australia'},'service',worker,{'x-research-job-id':id,'x-research-browser-reservation':token});assert.equal(search.status,200,JSON.stringify(search.data));assert.ok(search.data.seeds.includes('https://alpha.instruments.example.com/'));
  passed('Real Worker search parses fixed results from OrbStack Chromium');
  const beforeGamma=(await events()).counters.page;
  const cancelId=randomUUID();await control({blockedSlugs:['gamma']});await startJob(researchConfig(cancelId,['https://gamma.instruments.example.com/']));
  let readingGamma=false;
  for(const deadline=Date.now()+30000;Date.now()<deadline;){if((await events()).counters.page>beforeGamma){readingGamma=true;break;}await pause(200);}
  assert.ok(readingGamma,'Cancellation must occur during an actual in-flight Chromium read');
  const cancelled=await api(`/api/research/${cancelId}`,{action:'cancel'});assert.equal(cancelled.status,200);await control({blockedSlugs:[]});const cancelWorkflow=await settled(cancelId);assert.ok(['complete','terminated'].includes(cancelWorkflow.status),'Cancelled Workflow must stop cleanly');report.workflowStatuses[cancelId]=cancelWorkflow.status;
  assert.equal((await row(cancelId)).status,'cancelled');assert.equal((await db.query('SELECT count(*)::int AS n FROM research_findings WHERE job_id=$1',[cancelId])).rows[0].n,0);
  passed('Cancellation stops the real Workflow without saving later evidence');
  // Exercise the actual parallel scheduler, Workflow page callbacks, source
  // revalidation and target identifier writes in a disposable organization.
  const parallelId=randomUUID();
  const parallelConfig={...input,parallelBusinessResearch:true,mode:'automatic',findPeople:false,automaticDeadline:Date.now()+180000,automaticPageLimit:30,performanceFlags:{telemetryBatching:true,progressCoalescing:true,schedulerCoalescing:true}};
  await db.query("INSERT INTO research_jobs (id,organization_id,mandate_id,created_by,status,config,seeds) VALUES ($1,$2,$3,$4,'queued',$5,$6)",[parallelId,organizationId,mandateId,userId,parallelConfig,JSON.stringify(seeds)]);
  report.jobs.push(parallelId);active.add(parallelId);
  const scheduledParallel=await api(`/api/research/internal/${parallelId}`,{status:'partial',revision:1,pages:0,modelCalls:0,message:'Fixture discovery completed'},'service');
  assert.equal(scheduledParallel.status,200,JSON.stringify(scheduledParallel.data));
  let parallelJobs=[];
  let stableParallel;
  for(const deadline=Date.now()+180000;Date.now()<deadline;){
   parallelJobs=(await db.query("SELECT * FROM research_jobs WHERE organization_id=$1 AND config->>'researchRunId'=$2 ORDER BY created_at",[organizationId,parallelId])).rows;
   if(parallelJobs.length && parallelJobs.every(job=>['complete','partial','failed','cancelled'].includes(job.status))){
    stableParallel ||= Date.now();
    if(Date.now()-stableParallel>=2000)break;
   }else stableParallel=undefined;
   await pause(300);
  }
  assert.ok(parallelJobs.length && parallelJobs.every(job=>['complete','partial','failed','cancelled'].includes(job.status)),'Parallel branches must finish within the test budget');
  for(const job of parallelJobs)await settled(job.id);
  const branches=parallelJobs.filter(job=>job.config.researchRunId===parallelId);
  for(const kind of ['website','field','page'])assert.ok(branches.some(job=>job.config.researchTask===kind),`Missing parallel ${kind} job`);
  for(const field of ['abn','size','revenue'])assert.ok(branches.some(job=>job.config.researchField===field),`Missing parallel ${field} branch`);
  assert.ok(branches.filter(job=>job.config.researchTask==='page').every(job=>job.pages===1),'Sitemap child jobs each read one page');
  const alphaTarget=(await db.query("SELECT id,identifiers,firmographics FROM targets WHERE organization_id=$1 AND domain='alpha.instruments.example.com'",[organizationId])).rows[0];
  report.parallelTarget=alphaTarget;
  report.parallelAbns=(await db.query("SELECT target_id,evidence FROM research_findings WHERE organization_id=$1 AND evidence->>'name'='ABN'",[organizationId])).rows;
  assert.equal(alphaTarget.identifiers.abn,'99000000000','The independent ABN branch must update the target');
  assert.equal(alphaTarget.firmographics.headcount.value,18,'Accepted headcount must be reconciled onto the target');
  assert.equal(alphaTarget.firmographics.headcount.researchState,'observed');
  assert.equal(alphaTarget.firmographics.revenue.value,3000000,'Accepted AUD revenue must be reconciled onto the target');
  assert.equal(alphaTarget.firmographics.revenue.provenance.source,'Public web research');
  assert.equal(alphaTarget.firmographics.establishedYear.value,2001,'Accepted founded year must be reconciled onto the target');
  const savedParallel=(await db.query("SELECT evidence FROM research_findings WHERE organization_id=$1 AND job_id=ANY($2::uuid[])",[organizationId,branches.map(job=>job.id)])).rows;
  for(const kind of ['identifier','headcount','revenue'])assert.ok(savedParallel.some(f=>f.evidence.kind===kind),`Missing persisted parallel ${kind} evidence`);
  assert.equal(new Set(branches.map(job=>job.id)).size,branches.length);
  active.delete(parallelId);report.parallelJobs=branches.map(job=>({id:job.id,task:job.config.researchTask,field:job.config.researchField,status:job.status,pages:job.pages}));
  passed('Independent ABN/headcount/revenue/website jobs and sitemap page jobs persist through real Chromium, Workflows and PostgreSQL');
  const polling=await api(`/api/mandates/${mandateId}/research`);assert.equal(polling.status,200);assert.ok(Number(polling.response.headers.get('x-research-db-calls'))<=8);
  report.databaseCalls.inactivePolling=Number(polling.response.headers.get('x-research-db-calls'));
  assert.ok(!JSON.stringify(polling.data.jobs.map(j=>j.config)).includes('bufferedPage'));
  passed('Inactive polling uses a single review read and excludes execution page payloads');
  const after=await events();assert.equal(after.counters.blockedOutbound||0,0,'No unapproved outbound requests should occur');
 }
 }
 report.success=true;
}catch(error){report.success=false;report.error=error.message;console.error(`FAIL ${error.message}\nLogs: ${directory}`);process.exitCode=1;}
finally{await cleanup();if(report.cleanupError)report.success=false;report.finishedAt=new Date().toISOString();writeFileSync(resolve(directory,'report.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(`Report: ${resolve(directory,'report.json')}`);}
