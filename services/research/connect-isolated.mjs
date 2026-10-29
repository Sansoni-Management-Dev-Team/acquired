// Prepare/start the bridge. The isolated app keeps its current dispatch settings.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {parseEnv,promisify} from 'node:util';
import {execFile,spawn} from 'node:child_process';
import pg from 'pg';
const cwd=dirname(fileURLToPath(import.meta.url));process.chdir(cwd);
if(process.argv.slice(2).some(argument=>argument!=='--mirror'))throw Error('Only --mirror is supported');
const mirror=process.argv.includes('--mirror');
const appName=mirror?'acquire-research-app':'acquire-isolated-app';
const networkName=mirror?'acquire-research-app-network':'acquire-isolated-network';
const appPort=mirror?'3032':'3027';
const appSite=mirror?'https://acquire-research.orb.local':'https://acquire-isolated.orb.local';
const {stdout}=await promisify(execFile)('docker',['inspect',appName],{cwd});
const [app]=JSON.parse(stdout);
const appEnv=Object.fromEntries(app.Config.Env.map(pair=>{const index=pair.indexOf('=');return[pair.slice(0,index),pair.slice(index+1)]}));
if(appEnv.NODE_ENV!=='development'||appEnv.LOCAL_DEVELOPMENT!=='true'||!appEnv.RESEARCH_SERVICE_SECRET)throw Error('Expected the existing local isolated app and its research secret');
if(appEnv.APP_URL!==appSite)throw Error('Application site mismatch');
const {stdout:networkJson}=await promisify(execFile)('docker',['inspect',networkName],{cwd});
const [network]=JSON.parse(networkJson);
if(app.HostConfig.NetworkMode!==`container:${network.Id}`||!network.NetworkSettings.Ports?.['3000/tcp']?.some(port=>port.HostIp==='127.0.0.1'&&port.HostPort===appPort))throw Error('Isolated app port/network identity changed');
const local=parseEnv(await readFile('.env','utf8'));
const client=new pg.Client({host:'127.0.0.1',port:5441,database:'acquire_research_local',user:'research',password:local.RESEARCH_DB_PASSWORD,connectionTimeoutMillis:5000});
try{
 await client.connect();
 const identity=(await client.query('SELECT current_database() AS database,marker FROM research_service.identity')).rows[0];
 if(identity.database!=='acquire_research_local'||identity.marker!=='acquire-research-local-only')throw Error('Research DB identity mismatch');
 const active=(await client.query("SELECT count(*) AS count FROM dbos.workflow_status WHERE status IN ('ENQUEUED','PENDING','DELAYED')")).rows[0];
 if(Number(active.count))throw Error('Finish or cancel active research workflows before changing callback mode');
}finally{await client.end()}
await writeFile('.isolated.env',`HARNESS_ACQUIRE_SECRET=${JSON.stringify(appEnv.RESEARCH_SERVICE_SECRET)}\nHARNESS_ACQUIRE_FIRMABLE_SECRET=${JSON.stringify(appEnv.FIRMABLE_SERVICE_SECRET||appEnv.RESEARCH_SERVICE_SECRET)}\nHARNESS_ACQUIRE_ORIGIN=http://host.docker.internal:${appPort}\nHARNESS_ACQUIRE_SITE=${appSite}\n`,{mode:0o600});
await mkdir('.local',{recursive:true,mode:0o700});
const run=(cmd,args)=>new Promise((resolve,reject)=>{const child=spawn(cmd,args,{cwd,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`${cmd} exited ${code}`)))});
const profilePath=dirname(fileURLToPath(import.meta.url))+'/.local/mirror/runtime.env';
const profile=parseEnv(await readFile(profilePath,'utf8'));
profile.RESEARCH_CALLBACK_MODE='acquire-isolated';
await writeFile(profilePath,Object.entries(profile).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n',{mode:0o600});
process.env.RESEARCH_RUNTIME_ENV=profilePath;
process.env.RESEARCH_RUNTIME_OVERRIDE=dirname(fileURLToPath(import.meta.url))+'/runtime/compose.local.yml';
await run('bash',['runtime/stack.sh','up','-d','--wait','--wait-timeout','120']);
let ready=false;
for(let attempt=0;attempt<60;attempt++){
 try{ready=(await fetch('http://127.0.0.1:18798/health/ready',{signal:AbortSignal.timeout(1000)})).ok}catch{}
 if(ready)break;await new Promise(resolve=>setTimeout(resolve,500));
}
if(!ready)throw Error('Bridge did not become ready');
const receipt={recordedAt:new Date().toISOString(),mode:'acquire-isolated',ready:true,app:appSite+'/',callbackOrigin:`http://host.docker.internal:${appPort}`,worker:'http://127.0.0.1:18797',bridgeFromApp:'http://host.docker.internal:18798',appResearchWorkerUrl:appEnv.RESEARCH_WORKER_URL,appDispatchChanged:false,maintenanceForwarded:false,firmableCredentialsTransferred:false};
await writeFile(`.local/${mirror?'acquire-mirror':'acquire-isolated'}-bridge.json`,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
console.info(`Bridge ready for ${appSite}. The connection script did not change app settings.`);
