// Frozen local A/B experiments. Copies existing databases; never runs migrations.
import {spawn,execFileSync} from 'node:child_process';
import {createReadStream,createWriteStream,readFileSync,writeFileSync,mkdirSync,cpSync,symlinkSync,existsSync,readdirSync,statSync} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {parseEnv} from 'node:util';
import {resolve,relative} from 'node:path';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import pg from 'pg';
import {localDevConfig,localWorkerConfig,LOCAL_DATABASE_URL} from './dev-config.mjs';
import {checkLocalResearchSchema} from './local-research-schema.mjs';
import {benchmarkHash,localBenchmarkDatabase,designSnapshot,compareDesigns,observedDesignMetrics,persistedDataCompletion} from './research-design-metrics.mjs';
import {applyBenchmarkWorkload} from './research-design-workload.mjs';
const root=process.cwd(),args=process.argv.slice(2),command=args.shift();
function option(name,fallback){const i=args.indexOf(`--${name}`);return i<0?fallback:args[i+1];}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function save(path,data){writeFileSync(path,JSON.stringify(data,null,2),{mode:0o600});}
function treeHash(base){const entries=[];function visit(path){for(const name of readdirSync(path).sort()){if(name==='node_modules'||name==='.next')continue;const file=resolve(path,name);if(statSync(file).isDirectory())visit(file);else entries.push([relative(base,file),createHash('sha256').update(readFileSync(file)).digest('hex')]);}}visit(base);return benchmarkHash(entries);}
async function dockerStream(argv,input,output){const p=spawn('docker',['--context','orbstack','exec',...(input?['-i']:[]),'project-acquire-postgres',...argv],{stdio:[input?'pipe':'ignore',output?'pipe':'ignore','pipe']});let error='';p.stderr.on('data',b=>{error+=b.toString();});const exited=new Promise((yes,no)=>{p.once('error',no);p.once('exit',code=>code===0?yes():no(Error(`Database copy failed: ${error.slice(0,500)}`)));});await Promise.all([exited,...(input?[pipeline(createReadStream(input),p.stdin)]:[]),...(output?[pipeline(p.stdout,createWriteStream(output,{mode:0o600}))]:[])]);}
async function prepare(){
 const dir=resolve(option('out',`.local-data/research-design/baseline-${Date.now()}`));mkdirSync(dir,{recursive:true,mode:0o700});
 const reuse=option('reuse-baseline');
 let testCase;
 if(reuse){const original=resolve(reuse),manifest=JSON.parse(readFileSync(resolve(original,'manifest.json')));testCase=JSON.parse(readFileSync(resolve(original,'case.json')));if(benchmarkHash(testCase)!==manifest.caseHash||createHash('sha256').update(readFileSync(resolve(original,'baseline.dump'))).digest('hex')!==manifest.baselineHash)throw Error('Original benchmark inputs changed');cpSync(resolve(original,'baseline.dump'),resolve(dir,'baseline.dump'));save(resolve(dir,'case.json'),testCase);}
 else if(option('case')) {
 testCase=JSON.parse(readFileSync(option('case')));save(resolve(dir,'case.json'),testCase);
 await dockerStream(['pg_dump','-U','project_acquire','-d','project_acquire','-Fc','--no-owner','--no-privileges'],null,resolve(dir,'baseline.dump'));
 } else {
 const request=JSON.parse(readFileSync(option('request','.local-data/local-replay-2026-10-03/request.json')));
 const c=new pg.Client({connectionString:LOCAL_DATABASE_URL});await c.connect();await c.query('SET default_transaction_read_only=on');await checkLocalResearchSchema(c);
 const mandate=(await c.query('SELECT natural_language,filters,confirmation,provenance FROM mandates WHERE id=$1',[request.localMandateId])).rows[0];if(!mandate)throw Error('Source mandate missing');await c.end();
 testCase={version:1,name:'specialty-food-packaging-cleaning',productionMandateId:request.productionMandateId,mandate,input:{...request.input,requestId:undefined}};save(resolve(dir,'case.json'),testCase);
 await dockerStream(['pg_dump','-U','project_acquire','-d','project_acquire','-Fc','--no-owner','--no-privileges'],null,resolve(dir,'baseline.dump'));
 }
 if(reuse&&option('case')){testCase=JSON.parse(readFileSync(option('case')));save(resolve(dir,'case.json'),testCase);}
 const source=resolve(dir,'source');mkdirSync(source);for(const path of ['src','cloudflare'])cpSync(resolve(root,path),resolve(source,path),{recursive:true});
 for(const file of ['package.json','tsconfig.json','postcss.config.mjs'])cpSync(resolve(root,file),resolve(source,file));
 if(existsSync('.local-data/manufacturing-search-index.json')){mkdirSync(resolve(source,'.local-data'));cpSync('.local-data/manufacturing-search-index.json',resolve(source,'.local-data/manufacturing-search-index.json'));}
 save(resolve(dir,'manifest.json'),{version:1,supportedDesigns:existsSync(resolve(source,'src/domain/hybrid-company-pipeline.ts'))?['A','B','C','D','E','F']:existsSync(resolve(source,'src/domain/web-firmable-pipeline.ts'))?['A','B','C','D','E']:existsSync(resolve(source,'src/domain/firmable-company-pipeline.ts'))?['A','B','C','D']:existsSync(resolve(source,'src/domain/company-corpus.ts'))?['A','B','C']:['A','B'],createdAt:new Date().toISOString(),caseHash:benchmarkHash(testCase),baselineHash:createHash('sha256').update(readFileSync(resolve(dir,'baseline.dump'))).digest('hex'),sourceHash:treeHash(source),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirtyPatchHash:benchmarkHash(execFileSync('git',['diff'],{encoding:'utf8'})),observerHash:benchmarkHash(['research-design-benchmark.mjs','research-design-metrics.mjs'].map(f=>readFileSync(resolve('scripts',f),'utf8'))),readerImage:execFileSync('docker',['--context','orbstack','image','inspect','project-acquire-crawl4ai:latest','--format','{{.Id}}'],{encoding:'utf8'}).trim(),cachePolicy:'fresh worker state per sample; fresh synthetic organization; baseline database copy with inherited research jobs removed'});
 if(option('company-limit')||option('duration-minutes')){
 const workload=applyBenchmarkWorkload(source,{companies:Number(option('company-limit','20')),minutes:Number(option('duration-minutes','10'))});
 const manifest=JSON.parse(readFileSync(resolve(dir,'manifest.json')));manifest.workload=workload;manifest.sourceHash=treeHash(source);save(resolve(dir,'manifest.json'),manifest);
 }
 console.log(JSON.stringify({event:'baseline_prepared',directory:dir}));
}
async function port(){return new Promise((yes,no)=>{const s=createServer();s.once('error',no);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>yes(p));});});}
async function run(){
 const baseline=resolve(option('baseline',''));if(!existsSync(resolve(baseline,'manifest.json')))throw Error('Use prepare first and pass --baseline');
 const policy=option('policy','production');if(!['production','development'].includes(policy))throw Error('Use --policy production or development');
 const design=option('design');if(!['A','B','C','D','E','F'].includes(design))throw Error('Use --design A, B, C, D, E or F');
 const waitFor=option('wait-for');if(waitFor){console.log(JSON.stringify({event:'waiting_for_baseline_run'}));while(!existsSync(waitFor))await pause(1000);}
 // A user-started run on the shared host must settle before performance sampling.
 const main=new pg.Client({connectionString:LOCAL_DATABASE_URL});await main.connect();await main.query('SET default_transaction_read_only=on');
 const active=(await main.query("SELECT count(*)::int n FROM research_jobs WHERE status NOT IN ('complete','partial','failed','cancelled') AND updated_at>now()-interval '30 minutes'")).rows[0].n;await main.end();if(active)throw Error(`${active} local research jobs remain active; do not run competing performance tests`);
 const testCase=JSON.parse(readFileSync(resolve(baseline,'case.json'))),baseManifest=JSON.parse(readFileSync(resolve(baseline,'manifest.json')));
 if(!(baseManifest.supportedDesigns||['A','B']).includes(design))throw Error('This frozen baseline does not contain the requested design');
 if(treeHash(resolve(baseline,'source'))!==baseManifest.sourceHash)throw Error('Frozen source changed');
 if(benchmarkHash(['research-design-benchmark.mjs','research-design-metrics.mjs'].map(f=>readFileSync(resolve('scripts',f),'utf8')))!==baseManifest.observerHash)throw Error('Benchmark observer changed; prepare a new baseline');
 if(createHash('sha256').update(readFileSync(resolve(baseline,'baseline.dump'))).digest('hex')!==baseManifest.baselineHash||benchmarkHash(testCase)!==baseManifest.caseHash)throw Error('Frozen benchmark inputs changed');
 const id=randomUUID(),directory=resolve(option('out',`.local-data/research-design/${design}-${id}`));mkdirSync(directory,{recursive:true,mode:0o700});
 const databaseName=`project_acquire_bench_${design.toLowerCase()}_${id.replaceAll('-','')}`,connectionString=localBenchmarkDatabase(databaseName);
 execFileSync('docker',['--context','orbstack','exec','project-acquire-postgres','createdb','-U','project_acquire',databaseName],{stdio:'pipe'});
 await dockerStream(['pg_restore','-U','project_acquire','-d',databaseName,'--no-owner','--no-privileges'],resolve(baseline,'baseline.dump'));
 const db=new pg.Client({connectionString,query_timeout:20000});await db.connect();await checkLocalResearchSchema(db);
 await db.query('TRUNCATE research_jobs CASCADE'); // Disposable copy only; clears inherited jobs/leases/evidence.
 const [appPort,workerPort,readerPort]=await Promise.all([port(),port(),port()]);if(new Set([appPort,workerPort,readerPort]).size!==3)throw Error('Port collision');
 const environment={...parseEnv(readFileSync('.env.local','utf8'))},secret=randomBytes(32).toString('hex');
 const config=localDevConfig(environment,secret,appPort,workerPort,policy==='production');config.app.DATABASE_URL=connectionString;config.app.APP_URL=config.origin;config.app.NEXT_PUBLIC_APP_URL=config.origin;config.app.BETTER_AUTH_SECRET=randomBytes(32).toString('hex');config.app.TARGET_DATA_PROVIDER='live';
 config.app.RESEARCH_PIPELINE_DESIGN=design==='F'?'hybrid-firmable-v1':design==='E'?'web-firmable-v1':design==='D'?'firmable-v1':design==='C'?'corpus-v1':design==='B'?'balanced-v1':'A';config.worker.RESEARCH_PIPELINE_DESIGN=config.app.RESEARCH_PIPELINE_DESIGN;
 if(['D','E','F'].includes(design)){
 const cohortPath=option('company-cohort');
 if(cohortPath&&['E','F'].includes(design))throw Error('E requires full web discovery, not a fixed Firmable cohort');
 if(cohortPath){const cohort=JSON.parse(readFileSync(cohortPath));if(!Array.isArray(cohort)||cohort.length<1||cohort.length>100||cohort.some(row=>!/^f\d+$/.test(String(row.id))))throw Error('Invalid company cohort');config.app.LOCAL_RESEARCH_BENCHMARK='true';config.app.FIRMABLE_BENCHMARK_COHORT=JSON.stringify(cohort);save(resolve(directory,'company-cohort.json'),cohort);}
 const credentials=JSON.parse(readFileSync('.local-data/firmable-D-credentials.json'));
 config.worker={...config.worker,...credentials};config.app.FIRMABLE_TRANSPORT='cloudflare-session';config.app.FIRMABLE_SERVICE_URL=`http://127.0.0.1:${workerPort}/firmable`;config.app.FIRMABLE_SERVICE_SECRET=credentials.FIRMABLE_SERVICE_SECRET;
 }
 config.worker.LOCAL_RESEARCH_BENCHMARK='true';config.worker.LOCAL_CRAWL4AI_URL=`http://127.0.0.1:${readerPort}`;
 const source=resolve(directory,'source');cpSync(resolve(baseline,'source'),source,{recursive:true});symlinkSync(resolve(root,'node_modules'),resolve(source,'node_modules'));
 if(existsSync('public'))cpSync('public',resolve(source,'public'),{recursive:true});
 writeFileSync(resolve(source,'next.config.mjs'),`export default {poweredByHeader:false,turbopack:{root:${JSON.stringify(source)}}};\n`);
 const require=createRequire(import.meta.url),esbuild=createRequire(require.resolve('vitest/package.json'))('esbuild');esbuild.buildSync({entryPoints:[resolve(source,'src/domain/research-objectives.ts')],bundle:true,platform:'node',format:'esm',outfile:resolve(directory,'objectives.mjs')});
 const {fieldSatisfied}=await import(resolve(directory,'objectives.mjs'));
 const manifest={...baseManifest,...(option('company-cohort')?{workload:'fixed-company-cohort',caseHash:benchmarkHash({testCase,cohort:JSON.parse(readFileSync(option('company-cohort')))})}:{}),design,policy,databaseName,directory,appOrigin:`http://127.0.0.1:${appPort}`,workerPort,readerPort,node:process.version,capabilities:['D','E'].includes(design)?['company','abn','headcount_band','revenue_band']:['company','abn','size','revenue','people','email'],providerHash:benchmarkHash({...(['D','E','F'].includes(design)?{companyProvider:'Firmable session service'}:{}),readerImage:baseManifest.readerImage,concurrency:5,reader:'Crawl4AI',search:policy==='production'?'DuckDuckGo HTML page 1':'OpenSERP',ai:'current fixed free routes then Mercury',cache:baseManifest.cachePolicy}),startedAt:new Date().toISOString(),startingResearchJobs:0};save(resolve(directory,'manifest.json'),manifest);
 const runtime=resolve(directory,'worker-runtime');mkdirSync(runtime);
 const children=[],container=`acquire-design-${id}`;let submitted=false,interrupted=false;
 const interrupt=()=>{interrupted=true;};process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
 function start(label,cmd,argv,env){const log=createWriteStream(resolve(directory,`${label}.log`),{mode:0o600});const p=spawn(cmd,argv,{cwd:source,env,detached:true,stdio:['ignore','pipe','pipe']});p.benchmarkLabel=label;p.stdout.pipe(log);p.stderr.pipe(log);children.push(p);return p;}
 function checkServices(){const stopped=children.find(p=>p.exitCode!==null||p.signalCode!==null);if(stopped)throw Error(`Benchmark ${stopped.benchmarkLabel} exited (${stopped.signalCode||stopped.exitCode}); sample excluded`);}
 async function ready(url,accept){for(let end=Date.now()+120000;Date.now()<end;){checkServices();try{if(accept(await fetch(url,{signal:AbortSignal.timeout(2000)})))return;}catch{}await pause(300);}throw Error('Service readiness timeout');}
 try{
 execFileSync('docker',['--context','orbstack','run','-d','--rm','--name',container,'--shm-size','1g','-p',`127.0.0.1:${readerPort}:8080`,'-e','CRAWL4AI_CONCURRENCY=5',baseManifest.readerImage],{stdio:'pipe'});await ready(config.worker.LOCAL_CRAWL4AI_URL+'/health',r=>r.ok);
 const wc=localWorkerConfig(JSON.parse(readFileSync(resolve(source,'cloudflare/research/wrangler.jsonc'))),config.origin,resolve(source,'cloudflare/research/index.ts'),policy);wc.tsconfig=resolve(source,'tsconfig.json');wc.vars={...wc.vars,RESEARCH_PIPELINE_DESIGN:config.worker.RESEARCH_PIPELINE_DESIGN,LOCAL_RESEARCH_BENCHMARK:'true'};writeFileSync(resolve(runtime,'.dev.vars'),Object.entries(config.worker).filter(([k])=>!Object.hasOwn(wc.vars,k)).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n'),{mode:0o600});
 // Bundle once: dev must not watch shared dependencies or resolve aliases against the working tree.
 const bundle=resolve(runtime,'worker-bundle.js');esbuild.buildSync({entryPoints:[wc.main],tsconfig:wc.tsconfig,bundle:true,platform:'neutral',conditions:['workerd','worker','browser'],mainFields:['browser','module','main'],format:'esm',target:'es2022',external:['cloudflare:*','node:*'],outfile:bundle});
 wc.main=bundle;wc.base_dir=runtime;wc.find_additional_modules=false;delete wc.tsconfig;save(resolve(runtime,'wrangler.json'),wc);
 start('worker',process.execPath,[resolve(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--no-bundle','--local','--config',resolve(runtime,'wrangler.json'),'--ip','127.0.0.1','--port',String(workerPort),'--inspector-port','0','--persist-to',resolve(directory,'state'),'--show-interactive-dev-session=false'],{...config.app,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false',CLOUDFLARE_INCLUDE_PROCESS_ENV:'false'});
 await ready(`http://127.0.0.1:${workerPort}/`,r=>r.status===401);
 start('app',process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'dev',source,'--webpack','--hostname','127.0.0.1','--port',String(appPort)],config.app);await ready(manifest.appOrigin+'/api/mandates',r=>r.status===401);
 await fetch(manifest.appOrigin+'/api/research/internal/'+randomUUID());
 async function api(path,body,cookie){const response=await fetch(manifest.appOrigin+path,{method:'POST',headers:{'content-type':'application/json',origin:manifest.appOrigin,...(cookie?{cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});const data=await response.json();if(!response.ok)throw Error(`Local API ${path} failed (${response.status}): ${JSON.stringify(data)}`);return{response,data};}
 const signup=await api('/api/auth/sign-up/email',{name:'Architecture benchmark',email:`bench-${id}@example.invalid`,password:randomBytes(24).toString('hex')});const userId=signup.data.user.id,cookie=signup.response.headers.getSetCookie().map(v=>v.split(';')[0]).find(v=>v.includes('session_token='));if(!cookie)throw Error('Local auth cookie missing');
 const org=`design-${id}`;await db.query('INSERT INTO organization(id,name,slug) VALUES($1,$2,$1)',[org,`Design ${design}`]);await db.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,userId]);await db.query('UPDATE session SET active_organization_id=$1 WHERE user_id=$2',[org,userId]);
 const mandateId=randomUUID(),runId=randomUUID(),m=testCase.mandate;await db.query('INSERT INTO mandates(id,organization_id,natural_language,filters,confirmation,provenance,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[mandateId,org,m.natural_language,JSON.stringify(m.filters),m.confirmation,JSON.stringify(m.provenance),userId]);
 manifest.mandateId=mandateId;manifest.runId=runId;save(resolve(directory,'manifest.json'),manifest);
 await api(`/api/mandates/${mandateId}/research`,{...testCase.input,requestId:runId},cookie);submitted=true;console.log(JSON.stringify({event:'benchmark_started',design,directory,url:`${manifest.appOrigin}/mandates/${mandateId}?tab=targets`,runId}));
 const sampleStartedAt=Date.now();const end=sampleStartedAt+(baseManifest.workload?baseManifest.workload.minutes+10:80)*60000;let finishedSamples=0;let finalTargets=[],finalContacts=[],finalPeopleRuns=[];
 for(;Date.now()<end;){
 if(interrupted)throw Error('Benchmark interrupted; sample excluded');
 checkServices();
 if(/Reloading local server|Local server updated/.test(readFileSync(resolve(directory,'worker.log'),'utf8')))throw Error('Worker reloaded during measurement; sample excluded');
 const poll=await fetch(manifest.appOrigin+`/api/mandates/${mandateId}/research`,{headers:{cookie},signal:AbortSignal.timeout(60000)});if(!poll.ok)throw Error(`Research recovery poll failed (${poll.status})`);await poll.arrayBuffer();
 const jobs=(await db.query("SELECT id,status,created_at,updated_at,pages,model_calls,message,config - 'runtime' - 'pipelineTiming' - 'discoveryAttempts' - 'websitePages' - 'inheritedFindings' AS config FROM research_jobs WHERE organization_id=$1 ORDER BY created_at",[org])).rows;
 finalPeopleRuns=(await db.query('SELECT id,status,profiles_found,profiles_saved,profiles_failed,created_at,updated_at,error FROM firmable_sync_runs WHERE organization_id=$1',[org])).rows;
 finalTargets=(await db.query('SELECT t.id,t.company_name,t.domain,t.identifiers,t.firmographics,t.qualification,t.created_at FROM targets t WHERE t.organization_id=$1 AND EXISTS (SELECT 1 FROM mandate_targets mt WHERE mt.organization_id=$1 AND mt.mandate_id=$2 AND mt.target_id=t.id) ORDER BY t.created_at',[org,mandateId])).rows;
 finalContacts=(await db.query('SELECT id,target_id,display_name,role,personal_data,fictionalised,provenance FROM contacts WHERE organization_id=$1',[org])).rows;
 const findings=(await db.query('SELECT job_id,target_id,source_url,evidence FROM research_findings WHERE organization_id=$1',[org])).rows;
 const summary=designSnapshot({jobs,findings,peopleRuns:finalPeopleRuns,fieldSatisfied});summary.dataCompletion=persistedDataCompletion(finalTargets,finalContacts,baseManifest.workload?.companies||20);summary.wallElapsedMs=Date.now()-sampleStartedAt;
 if(baseManifest.workload&&(summary.researchedCompanies>baseManifest.workload.companies||finalTargets.length>baseManifest.workload.companies))throw Error('Benchmark company limit exceeded; sample excluded');
 if(baseManifest.workload&&summary.wallElapsedMs>=baseManifest.workload.minutes*60000&&!existsSync(resolve(directory,'deadline-snapshot.json')))save(resolve(directory,'deadline-snapshot.json'),summary);save(resolve(directory,'latest.json'),summary);writeFileSync(resolve(directory,'snapshots.jsonl'),JSON.stringify(summary)+'\n',{flag:'a',mode:0o600});console.log(JSON.stringify({event:'sample',design,seconds:Math.round(summary.elapsedMs/1000),jobs:summary.jobs,active:summary.active,fields:Object.keys(summary.groups)}));
 if(summary.finished){if(++finishedSamples>=2){const logs=['app.log','worker.log'].map(f=>readFileSync(resolve(directory,f),'utf8')).join('\n');summary.observations=observedDesignMetrics(logs,jobs.map(j=>j.id));save(resolve(directory,'final.json'),{manifest,summary});save(resolve(directory,'jobs.json'),jobs);save(resolve(directory,'findings.json'),findings);save(resolve(directory,'targets.json'),finalTargets);save(resolve(directory,'contacts.json'),finalContacts);save(resolve(directory,'people-runs.json'),finalPeopleRuns);console.log(JSON.stringify({event:'benchmark_finished',design,directory}));break;}}else finishedSamples=0;await pause(15000);
 }
 if(!existsSync(resolve(directory,'final.json')))throw Error('Benchmark did not finish within 80 minutes');
 }catch(error){save(resolve(directory,'failure.json'),{at:new Date().toISOString(),message:error.message,submitted});throw error;}
 finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);for(const p of children)try{process.kill(-p.pid,'SIGTERM');}catch{}try{execFileSync('docker',['--context','orbstack','rm','-f',container],{stdio:'ignore'});}catch{}await db.end();}
}
if(command==='prepare')await prepare();else if(command==='run')await run();else if(command==='compare'){const a=JSON.parse(readFileSync(option('a'))),b=JSON.parse(readFileSync(option('b')));console.log(JSON.stringify(compareDesigns(a,b),null,2));}else throw Error('Usage: research-design-benchmark.mjs prepare [--request FILE] [--out DIR] | run --design A|B|C|D|E|F --baseline DIR [--wait-for FILE] [--out DIR] | compare --a FILE --b FILE');
