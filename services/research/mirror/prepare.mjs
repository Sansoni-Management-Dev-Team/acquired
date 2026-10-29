// Copy local runtime configuration only. This script never writes to a database.
import {readFile,writeFile,mkdir,copyFile,chmod,access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify,parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {dirname,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url)),target=resolve(root,'../.local/mirror');
const source='/Users/callum/Documents/Development/acquire-simulator/.local-data/isolated-workspace';
try{await access(resolve(target,'preparation-evidence.json'));throw Error('Mirror is already prepared; refusing to overwrite its runtime configuration')}catch(error){if(error.code!=='ENOENT')throw error}
const run=promisify(execFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const config=resolve(target,'config'),profile=resolve(target,'profile');
await mkdir(config,{recursive:true,mode:0o700});await mkdir(profile,{recursive:true,mode:0o700});
const privateWrite=(file,data)=>writeFile(file,data,{mode:0o600});
const copy=async(from,to)=>{await copyFile(from,to);await chmod(to,0o600)};
const composeEnvironment=parseEnv(await readFile(resolve(target,'compose.env'),'utf8'));
const password=composeEnvironment.MIRROR_DATABASE_PASSWORD;
if(!/^[a-f0-9]{64}$/.test(password||''))throw Error('Expected the privately generated mirror password');
const repository=resolve(root,'../../..');
const sourceApp=JSON.parse((await run('docker',['inspect','acquire-isolated-app'])).stdout)[0];
const modules=sourceApp.Mounts.find(mount=>mount.Destination==='/workspace/node_modules');
if(modules?.Type!=='volume'||modules.RW)throw Error('Expected the source read-only dependency volume');
for(const file of ['package.json','pnpm-lock.yaml']){
 const local=await readFile(resolve(repository,file));
 const {stdout}=await run('docker',['exec','acquire-isolated-app','cat','/workspace/'+file],{maxBuffer:4*1024*1024});
 if(sha(local)!==sha(stdout))throw Error('Align the worktree dependency manifests with the source app first');
}
Object.assign(composeEnvironment,{MIRROR_APP_IMAGE:sourceApp.Image,MIRROR_APP_MODULES:modules.Name});
await privateWrite(resolve(target,'compose.env'),Object.entries(composeEnvironment).map(([key,value])=>`${key}=${value}`).join('\n')+'\n');
const database='postgresql://project_acquire:'+password+'@127.0.0.1:5437/acquire_agent_mode';
const facts='postgresql://project_acquire:'+password+'@127.0.0.1:5434/project_acquire';
const site='https://acquire-research.orb.local',bridge='http://host.docker.internal:18798';
function retarget(value){
 if(Array.isArray(value))return value.map(retarget);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,retarget(v)]));
 if(typeof value!=='string')return value;
 if(value.startsWith('{')){let parsed;try{parsed=JSON.parse(value)}catch{return value}return JSON.stringify(retarget(parsed))}
 if(/^postgres(?:ql)?:/.test(value)){
  const url=new URL(value);
  const knownLocal=(url.hostname==='127.0.0.1'&&url.port==='5437')||(url.hostname==='postgres'&&url.port==='5432');
  if(!knownLocal||url.pathname!=='/acquire_agent_mode')throw Error('Unexpected database in copied environment');
  return database;
 }
 if(/^https:\/\/acquire-(isolated|agent)\.orb\.local(?:\/|$)/.test(value))return value.replace(/^https:\/\/acquire-(?:isolated|agent)\.orb\.local/,site);
 if(value==='http://127.0.0.1:8787'||value==='http://127.0.0.1:8787/firmable')return value.replace('http://127.0.0.1:8787',bridge);
 return value;
}
// snapshot.mjs writes one JSON-quoted value per line. Native parseEnv does
// not decode embedded escaped quotes and would truncate nested JSON settings.
const sourceEnvironment=Object.fromEntries((await readFile(resolve(target,'source-app.env'),'utf8')).trimEnd().split('\n').map(line=>{const index=line.indexOf('=');return[line.slice(0,index),JSON.parse(line.slice(index+1))]}));
const app=retarget(sourceEnvironment);
Object.assign(app,{APP_URL:site,BETTER_AUTH_URL:site,NEXT_PUBLIC_APP_URL:site,DATABASE_URL:database,RESEARCH_WORKER_URL:bridge,FIRMABLE_SERVICE_URL:bridge+'/firmable'});
if(app.NODE_ENV!=='development'||app.LOCAL_DEVELOPMENT!=='true'||app.AGENT_MODE_COMMUNICATIONS_MODE!=='simulator')throw Error('Expected simulated local app');
await privateWrite(resolve(target,'app.env'),Object.entries(app).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n')+'\n');
for(const name of ['environment.json','process-environment.json']){
 const environment=retarget(JSON.parse(await readFile(resolve(source,'config',name),'utf8')));
 await privateWrite(resolve(config,name),JSON.stringify(environment,null,2)+'\n');
}
const configuration=JSON.parse(await readFile(resolve(source,'config/configuration.json'),'utf8'));
for(const key of ['sourceDatabaseUrl','applicationDatabaseUrl','serviceDatabaseUrl'])configuration[key]=database;
configuration.factsDatabaseUrl=facts;
for(const name of ['ca.crt','tls.crt','tls.key','sync-key.bin','model.json','credentials.private.json',basename(configuration.appRuntimeModule)])await copy(resolve(source,'config',name),resolve(config,name));
await privateWrite(resolve(config,'configuration.json'),JSON.stringify(configuration,null,2)+'\n');
// Never overwrite a profile after the mirror has started using it.
try{await access(resolve(profile,'run.json'))}catch(error){if(error.code!=='ENOENT')throw error;for(const name of ['run.json','credentials.json'])await copy(resolve(source,'profile',name),resolve(profile,name))}
for(const name of ['saved-recipient-source.mjs','local-firmable-facts.mjs']){
 const {stdout}=await run('docker',['exec','acquire-isolated-simulator','cat','/app/testing/agent-simulator/'+name],{maxBuffer:4*1024*1024});
 await privateWrite(resolve(config,name),stdout);
}
await copy(resolve(source,'next-env.d.ts'),resolve(target,'next-env.d.ts'));
const commit=(await run('git',['rev-parse','HEAD'],{cwd:resolve(root,'../../..')})).stdout.trim();
await privateWrite(resolve(target,'preparation-evidence.json'),JSON.stringify({preparedAt:new Date().toISOString(),commit,site,appPort:3032,databasePort:5442,simulatorProfileCopied:true,simulatorProfileHash:sha(await readFile(resolve(profile,'run.json'))),databaseWritten:false,sourceChanged:false},null,2)+'\n');
console.log('Mirror runtime files prepared privately. No database was created or changed.');
