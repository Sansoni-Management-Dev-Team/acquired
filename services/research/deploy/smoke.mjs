// Exercise an already-running hosted test deployment through SSH forwards.
// Does not create databases, change Compose services, or connect an Acquire app.
import {readFile,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {report,createRun} from '../dist/mandate-harness.mjs';
const envPath=process.env.RESEARCH_TEST_ENV;
if(!envPath)throw Error('RESEARCH_TEST_ENV must name the private test deployment env file');
const profile=parseEnv(await readFile(envPath,'utf8'));
if(profile.RESEARCH_DEPLOYMENT==='digitalocean-production')throw Error('Production callbacks are active; the file-backed test runner is disabled');
const {RESEARCH_SERVICE_SECRET:secret}=profile;
if(profile.RESEARCH_CALLBACK_MODE&&profile.RESEARCH_CALLBACK_MODE!=='test')throw Error('Use the file-backed test callback profile; the Acquire bridge is active');
if(!secret)throw Error('Test service secret required');
const origin=process.env.RESEARCH_TEST_WORKER_ORIGIN||'http://127.0.0.1:28797';
const callback=process.env.RESEARCH_TEST_CALLBACK_ORIGIN||'http://127.0.0.1:28798';
for(const value of [origin,callback]){const u=new URL(value);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password)throw Error('Use a loopback SSH forward');}
const mandate=JSON.parse(await readFile(process.argv[2]||new URL('../test/mandates/aged-care-software.json',import.meta.url),'utf8'));
createRun(mandate);
const headers={authorization:`Bearer ${secret}`,'content-type':'application/json'};
const get=async(url,options={})=>{const r=await fetch(url,{headers,signal:AbortSignal.timeout(60000),...options});if(!r.ok)throw Error(`Test endpoint returned HTTP ${r.status}`);return r.json()};
const created=await get(callback+'/test/runs',{method:'POST',body:JSON.stringify(mandate)});
console.info(JSON.stringify({jobId:created.id,mandate:mandate.name}));
const path=origin+'/jobs/'+created.id;
for(let i=0;i<2;i++)await get(path,{method:'POST',body:'{}'});
let job,status,last;
while(Date.now()<created.deadline+45000){
 status=(await get(path)).status;
 job=await get(callback+'/test/runs/'+created.id);
 const line=JSON.stringify({workflow:status,research:job.status,pages:job.pages,modelCalls:job.modelCalls,findings:job.findings.length});
 if(line!==last){console.info(line);last=line;}
 if(['complete','errored','terminated'].includes(status))break;
 await new Promise(resolve=>setTimeout(resolve,2000));
}
const result={...report(job,status),deployment:profile.RESEARCH_DEPLOYMENT||'test',duplicateDispatchAccepted:true,inputSha256:createHash('sha256').update(JSON.stringify(mandate)).digest('hex'),release:parseEnv(await readFile(new URL('../runtime/release.env',import.meta.url),'utf8'))};
const destination=process.env.RESEARCH_TEST_REPORT||new URL('../.local/digitalocean/smoke-report.json',import.meta.url);
await writeFile(destination,JSON.stringify(result,null,2)+'\n',{mode:0o600});
console.info(JSON.stringify({passed:result.passed,checks:result.checks}));
if(!result.passed)process.exitCode=1;
