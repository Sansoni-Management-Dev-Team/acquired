// Re-pin private simulator copies to the separately restored mirror cluster.
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import pg from 'pg';
const directory=resolve(dirname(fileURLToPath(import.meta.url)),'../.local/mirror');
const evidence=JSON.parse(await readFile(resolve(directory,'restore-evidence.json'),'utf8'));
const env=parseEnv(await readFile(resolve(directory,'compose.env'),'utf8'));
const client=new pg.Client({host:'127.0.0.1',port:5442,user:'project_acquire',database:'postgres',password:env.MIRROR_DATABASE_PASSWORD});
try{
 await client.connect();
 const actual=(await client.query("SELECT system_identifier::text AS system_id,(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='postgres') AS marker FROM pg_control_system()")).rows[0];
 if(actual.system_id!==evidence.identity.system_id||actual.marker!=='acquire-research-app-local-only')throw Error('Restored mirror identity mismatch');
 const configuration=JSON.parse(await readFile(resolve(directory,'config/configuration.json'),'utf8'));
 const records=[];
 for(const[name,old]of[['saved-recipient-source.mjs','7697400069962248225'],['local-firmable-facts.mjs','7680143844628185121'],[basename(configuration.appRuntimeModule),'7697400069962248225']]){
  const file=resolve(directory,'config',name),before=await readFile(file,'utf8');
  if(before.split(old).length!==2)throw Error('Expected exactly one source identity pin: '+name);
  const after=before.replace(old,actual.system_id),hash=createHash('sha256').update(after).digest('hex');
  await writeFile(file,after,{mode:0o600});records.push({file:name,sourceSystemId:old,mirrorSystemId:actual.system_id,sha256:hash});
  if(name===basename(configuration.appRuntimeModule))configuration.appRuntimeSha256=hash;
 }
 await writeFile(resolve(directory,'config/configuration.json'),JSON.stringify(configuration,null,2)+'\n',{mode:0o600});
 await writeFile(resolve(directory,'simulator-pins.json'),JSON.stringify({recordedAt:new Date().toISOString(),records,identityChecksPreserved:true},null,2)+'\n',{mode:0o600});
 console.log('Private simulator copies pinned to the verified mirror database.');
}finally{await client.end()}
