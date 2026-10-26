// Real bundled Worker + Wrangler in a DISPOSABLE network-none container. No DB,
// simulator, live providers, existing container restarts or provider credentials.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {localWorkerConfig} from './dev-config.mjs';
import {stageRuntime} from './isolated-research-runtime.mjs';

const root=resolve(import.meta.dirname,'..'),id=randomUUID().slice(0,8),name=`acquire-research-runtime-check-${id}`;
const modules=process.env.ACQUIRE_NODE_MODULES_VOLUME||'acquire-agent-mode_agent-aligned-node-modules';
const base=join(root,'.local-data/isolated-research/runtime-checks');mkdirSync(base,{recursive:true,mode:0o700});
const directory=mkdtempSync(join(base,'check-')),state=`${name}-state`,scratch=`${name}-scratch`,secret='fixture-only-runtime-secret';
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:45000,stdio:['ignore','pipe','pipe']});
const existingNames=docker('ps','--format','{{.Names}}').trim().split('\n').filter(name=>name.startsWith('acquire-isolated-')||name==='acquire-simulator-local');
const existingLifecycles=()=>existingNames.length?docker('inspect',...existingNames,'--format','{{.Name}} {{.Id}} {{.State.StartedAt}}'):'';
const beforeExisting=existingLifecycles();
const config=localWorkerConfig({compatibility_date:'2026-09-08',compatibility_flags:['global_fetch_strictly_public']},'http://127.0.0.1:3000','/release/bundle/index.js','development');
config.name=name;config.workflows[0].name=`${name}-research`;config.workflows[1].name=`${name}-firmable`;
writeFileSync(join(directory,'input.json'),JSON.stringify(config));
const release=stageRuntime({root,configFile:join(directory,'input.json'),directory:join(directory,'releases'),modulesVolume:modules}).release;
writeFileSync(join(directory,'worker.env'),`SERVICE_SECRET=${secret}\nLOCAL_CRAWL4AI_URL=http://127.0.0.1:18084\n`,{mode:0o600});
mkdirSync(join(directory,'editable/src/components'),{recursive:true});mkdirSync(join(directory,'editable/src/domain'),{recursive:true});
writeFileSync(join(directory,'runner.cjs'),`
const http=require('node:http'),{spawn}=require('node:child_process'),fs=require('node:fs');
http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;fs.writeFileSync('/runtime/reader-started','yes');await new Promise(r=>setTimeout(r,9000));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url:JSON.parse(body).url,html:'<main>fixture delayed reader</main>',markdown:'fixture evidence',only_main_content:false}));}).listen(18084,'127.0.0.1');
http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'cancelled',deadline:0,config:{companyBackgroundResearch:true}}));}).listen(3000,'127.0.0.1');
const child=spawn('node',['/workspace/node_modules/wrangler/bin/wrangler.js','dev','--local','--no-bundle','--config','/config/wrangler.json','--ip','127.0.0.1','--port','8787','--inspector-port','0','--persist-to','/state','--show-interactive-dev-session=false'],{stdio:'inherit'});child.on('exit',code=>process.exit(code??1));process.on('SIGTERM',()=>child.kill('SIGTERM'));
`);
const execute=code=>docker('exec',name,'node','-e',code);
async function api(path,method='GET',body){return JSON.parse(execute(`fetch('http://127.0.0.1:8787'+${JSON.stringify(path)},{method:${JSON.stringify(method)},headers:{authorization:'Bearer ${secret}','Content-Type':'application/json'},${body===undefined?'':`body:JSON.stringify(${JSON.stringify(body)}),`}signal:AbortSignal.timeout(20000)}).then(async r=>console.log(JSON.stringify({status:r.status,data:await r.json()})))`));}
async function ready(){for(let round=0;round<100;round++){try{if((await api('/')).status===404)return;}catch{}await pause(300);}throw Error('Disposable Worker did not become ready');}
let started=false;
try{
 docker('run','-d','--name',name,'--network','none','--workdir','/runtime','-e','CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false','-e','CLOUDFLARE_INCLUDE_PROCESS_ENV=false','-e','CLOUDFLARE_CF_FETCH_ENABLED=false','-e','WRANGLER_SEND_METRICS=false','-e','MINIFLARE_CACHE_DIR=/runtime/miniflare','-v',`${release}:/release:ro`,'-v',`${modules}:/workspace/node_modules:ro`,'-v',`${release}/wrangler.json:/config/wrangler.json:ro`,'-v',`${directory}/worker.env:/config/.dev.vars:ro`,'-v',`${directory}/runner.cjs:/runner.cjs:ro`,'-v',`${directory}/editable:/editable:ro`,'-v',`${state}:/state`,'-v',`${scratch}:/runtime`,'node:22.12.0','node','/runner.cjs');started=true;
 await ready();
 execute(`require('fs').mkdirSync('/runtime/miniflare',{recursive:true});require('fs').writeFileSync('/runtime/miniflare/cache-probe','writable');`);
 const before=docker('logs',name);
 // Asynchronous request deliberately spans the editable (unwatched) UI change.
 const requestCode=`fetch('http://127.0.0.1:8787/company-page',{method:'POST',headers:{authorization:'Bearer ${secret}','Content-Type':'application/json'},body:JSON.stringify({url:'https://fixture.example.com/about'})}).then(async r=>require('fs').writeFileSync('/runtime/request-result.json',JSON.stringify({status:r.status,data:await r.json()})));`;
 docker('exec','-d',name,'node','-e',requestCode);
 for(let round=0;round<50;round++){try{execute("require('fs').readFileSync('/runtime/reader-started')");break;}catch{}await pause(200);}
 writeFileSync(join(directory,'editable/src/components/ui-change.tsx'),'export default function ChangedUI(){return null;}');
 writeFileSync(join(directory,'editable/src/domain/research.ts'),'// changed imported-domain source in the editable tree, not the pinned bundle');
 let response;for(let round=0;round<70;round++){try{response=JSON.parse(execute("console.log(require('fs').readFileSync('/runtime/request-result.json','utf8'))"));break;}catch{}await pause(200);}
 assert.equal(response?.status,200);assert.match(response.data.html,/fixture delayed reader/);
 const after=docker('logs',name).slice(before.length);assert.ok(!/Reloading local server|ENOENT|EROFS/.test(after),after);
 const job=randomUUID();assert.equal((await api(`/jobs/${job}`,'POST',{})).status,202);
 let terminal;for(let round=0;round<80;round++){terminal=await api(`/jobs/${job}`);if(terminal.data.status==='complete')break;await pause(250);}
 assert.equal(terminal.data.status,'complete');
 // Only the disposable worker is restarted. Verify its real Workflow state persists.
 docker('restart',name);await ready();
 assert.equal((await api(`/jobs/${job}`)).data.status,'complete');
 assert.equal(execute("console.log(require('fs').readFileSync('/runtime/miniflare/cache-probe','utf8'))").trim(),'writable');
 assert.equal(existingLifecycles(),beforeExisting,'Existing isolated container lifecycles must remain unchanged');
 const report={passed:true,network:'none',release,delayedRealWorkerRequest:response.status,uiAndDomainEditReloadedWorker:false,persistedWorkflowStatus:'complete',cacheWritableAndSurvivedRestart:true,existingContainerLifecyclesUnchanged:true};
 writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{
 if(started){writeFileSync(join(directory,'worker.log'),docker('logs',name));docker('rm','-f',name);}
 for(const volume of [state,scratch])try{docker('volume','rm',volume);}catch{}
}
