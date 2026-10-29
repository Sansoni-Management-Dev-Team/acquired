// Start only a verified, restored mirror. No migrations or database restores.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {parseEnv} from 'node:util';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import pg from 'pg';
const root=dirname(fileURLToPath(import.meta.url)),directory=resolve(root,'../.local/mirror');
const evidence=JSON.parse(await readFile(resolve(directory,'restore-evidence.json'),'utf8'));
const manifest=await readFile(resolve(directory,'restore-manifest.json'));
if(createHash('sha256').update(manifest).digest('hex')!==evidence.manifestSha256)throw Error('Restore evidence does not match the reviewed snapshot');
const pins=JSON.parse(await readFile(resolve(directory,'simulator-pins.json'),'utf8'));
for(const entry of pins.records){
 const bytes=await readFile(resolve(directory,'config',entry.file));
 if(entry.mirrorSystemId!==evidence.identity.system_id||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('Simulator identity pin changed');
}
const environment=parseEnv(await readFile(resolve(directory,'compose.env'),'utf8'));
const client=new pg.Client({host:'127.0.0.1',port:5442,user:'project_acquire',database:'postgres',password:environment.MIRROR_DATABASE_PASSWORD});
try{
 await client.connect();const identity=(await client.query("SELECT system_identifier::text AS system_id,(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='postgres') AS marker FROM pg_control_system()")).rows[0];
 if(identity.system_id!==evidence.identity.system_id||identity.marker!=='acquire-research-app-local-only')throw Error('Mirror database identity mismatch');
}finally{await client.end()}
const run=(command,args)=>new Promise((resolve,reject)=>{const child=spawn(command,args,{stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Mirror startup command failed')))});
const compose=['compose','--env-file',resolve(directory,'compose.env'),'-f',resolve(root,'compose.yml'),'-f',resolve(root,'compose.runtime.yml')];
// Docker cannot create nested volume mount points through the read-only repo.
for(const path of ['.next','node_modules'])await mkdir(resolve(root,'../../..',path),{recursive:true});
await run('docker',[...compose,'up','-d','app','simulator']);
let ready=false;
for(let attempt=0;attempt<120;attempt++){
 try{ready=(await fetch('http://127.0.0.1:3032/sign-in',{signal:AbortSignal.timeout(2000)})).ok}catch{}
 if(ready)break;await new Promise(resolve=>setTimeout(resolve,1000));
}
if(!ready)throw Error('Mirror app is not ready; inspect its container logs');
await run('node',[resolve(root,'../connect-isolated.mjs'),'--mirror']);
// Start background execution only after the clone's app and research bridge exist.
await run('docker',[...compose,'up','-d','reader-alias','native']);
await writeFile(resolve(directory,'startup-evidence.json'),JSON.stringify({startedAt:new Date().toISOString(),site:'https://acquire-research.orb.local',databaseIdentity:evidence.identity.system_id,bridge:'http://host.docker.internal:18798',sourceChanged:false,loginPasswordTested:false,liveResearchTested:false},null,2)+'\n',{mode:0o600});
console.info('Mirror services started. Browser login and an end-to-end research run still need verification.');
