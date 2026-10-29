// Inspect running services; never restart containers or modify a database.
import {readFile,writeFile} from 'node:fs/promises';
import {parseEnv,promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {config} from '../src/config.mjs';
const exec=promisify(execFile);
export function publicSettings(environment){
 const c=config(environment);
 return Object.fromEntries(['RESEARCH_AI_PROVIDER','OPENAI_RESEARCH_MODEL','OPENAI_RESEARCH_FALLBACK_MODEL','RESEARCH_SEARCH_PROVIDER','RESEARCH_READER_PROVIDER','LOCAL_SEARCH_ENGINE','LOCAL_SEARCH_REGION','FIRMABLE_SEARCH_COUNTRY'].map(k=>[k,c[k]??null]));
}
export const containerArchitecture=(container,image)=>container.ImageManifestDescriptor?.platform?.architecture||image.Architecture;
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function command(args,ssh){
 try{return(await exec(ssh?'ssh':'docker',ssh?['-F',ssh,'research-do-test',['docker',...args].map(quote).join(' ')]:args,{maxBuffer:4*1024*1024,timeout:20000})).stdout}
 catch{throw Error(`Could not inspect ${ssh?'DigitalOcean':'local'} runtime; check Docker/SSH connectivity`)}
}
async function inspect(name,ssh,release){
 const project=name==='local'?'acquire-research-service':'acquire-research-do-test';
 const services=['research','reader','search','database','fixture'];
 const containers=JSON.parse(await command(['inspect',...services.map(s=>project+'-'+s+'-1')],ssh));
 const byService=Object.fromEntries(containers.map(c=>[c.Config.Labels['com.docker.compose.service'],c]));
 const env=Object.fromEntries(byService.research.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)]}));
 const images=JSON.parse(await command(['image','inspect',...['research','reader','search'].map(s=>byService[s].Image)],ssh));
 const readerHash=(await command(['exec',project+'-reader-1','sha256sum','/app/server.py'],ssh)).trim().split(/\s+/)[0];
 const database=name==='local'?'acquire_research_local':'acquire_research_do_test';
 const identity=(await command(['exec',project+'-database-1','psql','-XqAt','-U','research','-d',database,'-c',"SELECT current_database()||'|'||marker FROM research_service.identity WHERE singleton=true"],ssh)).trim();
 const expectedIdentity=database+'|'+(name==='local'?'acquire-research-local-only':'acquire-research-do-test-only');
 const runtime={images:Object.fromEntries(['research','reader','search','database','fixture'].map(s=>[s,byService[s].Config.Image])),architectures:Object.fromEntries(['research','reader','search'].map((s,i)=>[s,containerArchitecture(byService[s],images[i])])),readerSourceSha256:readerHash,settings:publicSettings(env)};
 const expectedImages={research:release.RESEARCH_IMAGE,fixture:release.RESEARCH_IMAGE,reader:release.READER_IMAGE,search:release.SEARCH_IMAGE,database:release.DATABASE_IMAGE};
 const checks={images:JSON.stringify(runtime.images)===JSON.stringify(Object.fromEntries(Object.keys(runtime.images).map(k=>[k,expectedImages[k]]))),amd64:Object.values(runtime.architectures).every(a=>a==='amd64'),readerSource:readerHash===release.READER_SOURCE_SHA256,databaseIdentity:identity===expectedIdentity,healthy:containers.every(c=>c.State.Running&&(!c.State.Health||c.State.Health.Status==='healthy')),settings:JSON.stringify(runtime.settings)===JSON.stringify(publicSettings({...env,RESEARCH_AI_PROVIDER:'openai',OPENAI_RESEARCH_MODEL:release.OPENAI_RESEARCH_MODEL,OPENAI_RESEARCH_FALLBACK_MODEL:release.OPENAI_RESEARCH_FALLBACK_MODEL,RESEARCH_SEARCH_PROVIDER:'local',RESEARCH_READER_PROVIDER:'crawl4ai',LOCAL_SEARCH_ENGINE:undefined}))};
 return{name,passed:Object.values(checks).every(Boolean),checks,databaseIdentity:identity,deployment:env.RESEARCH_DEPLOYMENT,callbackMode:env.RESEARCH_DEPLOYMENT==='digitalocean-production'?'acquire-production':byService.fixture.Config.Env.find(v=>v.startsWith('HARNESS_MODE='))?.slice(13)||'test',callbackOrigin:env.RESEARCH_DEPLOYMENT==='digitalocean-production'?byService.fixture.Config.Env.find(v=>v.startsWith('HARNESS_ACQUIRE_ORIGIN='))?.slice(23):env.RESEARCH_APP_ORIGIN,fingerprint:createHash('sha256').update(JSON.stringify(runtime)).digest('hex'),runtime};
}
export async function parity({ssh}={}){
 const release=parseEnv(await readFile(new URL('release.env',import.meta.url),'utf8'));
 const environments=await Promise.all([inspect('local',undefined,release),...(ssh?[inspect('digitalocean-test',ssh,release)]:[])]);
 const matching=environments.length===1||environments[0].fingerprint===environments[1].fingerprint;
 return{at:new Date().toISOString(),passed:matching&&environments.every(e=>e.passed),matching,environments};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),option=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
 try{const result=await parity({ssh:option('--ssh-config')});const output=option('--output');if(output)await writeFile(output,JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1}catch(e){console.error(e.message);process.exitCode=1}
}
