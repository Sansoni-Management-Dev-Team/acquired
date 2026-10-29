// Applies only the specifically approved private snapshot package to a fresh,
// isolated mirror cluster. Never runs application migration files.
import {readFile,writeFile,appendFile,mkdir} from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';
import {promisify,parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const root=dirname(fileURLToPath(import.meta.url)),directory=resolve(root,'../.local/mirror');
const manifestBytes=await readFile(resolve(directory,'restore-manifest.json'));
const hash=createHash('sha256').update(manifestBytes).digest('hex');
if(process.argv[2]!==`--approved-manifest-sha256=${hash}`)throw Error('Specific approval of this snapshot manifest is required');
const manifest=JSON.parse(manifestBytes);
if(manifest.target.port!==5442||manifest.target.container!=='acquire-research-app-db'||manifest.target.volume!=='acquire-research-app_database')throw Error('Unexpected restore target');
for(const entry of manifest.files){const data=await readFile(resolve(directory,entry.file));if(createHash('sha256').update(data).digest('hex')!==entry.sha256)throw Error('Reviewed snapshot changed')}
const log=resolve(directory,'restore.log');await writeFile(log,'',{mode:0o600});
const execute=async(command,args,input)=>{
 await new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});const output=[];child.stdout.on('data',chunk=>output.push(chunk));child.stderr.on('data',chunk=>output.push(chunk));child.on('error',reject);child.on('exit',async code=>{await appendFile(log,Buffer.concat(output));code===0?resolve():reject(Error('Restore step failed; inspect the ignored private restore.log'))});child.stdin.end(input);
 });
};
const compose=['compose','--env-file',resolve(directory,'compose.env'),'-f',resolve(root,'compose.yml')];
await execute('docker',[...compose,'up','-d','--wait','database']);
const container=JSON.parse((await promisify(execFile)('docker',['inspect',manifest.target.container])).stdout)[0];
if(container.Config.Labels['com.docker.compose.project']!=='acquire-research-app'||!container.Mounts.some(m=>m.Name===manifest.target.volume))throw Error('Wrong database container or volume');
const env=parseEnv(await readFile(resolve(directory,'compose.env'),'utf8'));
const client=new pg.Client({host:'127.0.0.1',port:5442,database:'acquire_agent_mode',user:'project_acquire',password:env.MIRROR_DATABASE_PASSWORD,connectionTimeoutMillis:5000,statement_timeout:30000});
try{
 await client.connect();
 const identity=(await client.query("SELECT current_database() AS database,(SELECT system_identifier FROM pg_control_system())::text AS system_id")).rows[0];
 if(identity.database!=='acquire_agent_mode'||manifest.sources.some(source=>source.identity.system_id===identity.system_id))throw Error('Refusing a source database identity');
 if(Number((await client.query("SELECT count(*) FROM pg_tables WHERE schemaname='public'")).rows[0].count))throw Error('Target database must be fresh and empty');
 const facts=(await client.query("SELECT 1 FROM pg_database WHERE datname='project_acquire'")).rowCount;if(facts)throw Error('Target facts database must not exist');
 for(const file of ['application-roles.sql','facts-roles.sql'])await execute('docker',['exec','-i',manifest.target.container,'psql','-U','project_acquire','-p','5437','-d','postgres','-v','ON_ERROR_STOP=1'],await readFile(resolve(directory,file)));
 await client.query('CREATE DATABASE project_acquire OWNER project_acquire');
 for(const [name,database]of[['application','acquire_agent_mode'],['facts','project_acquire']]){
  await execute('docker',['cp',resolve(directory,name+'.dump'),manifest.target.container+':/tmp/'+name+'.dump']);
  // Source history may contain old rows loaded with triggers disabled. Create
  // the exact schema first, then import data with the standard restore option
  // that preserves those rows without deleting history or changing constraints.
  await execute('docker',['exec',manifest.target.container,'pg_restore','--exit-on-error','--schema-only','-U','project_acquire','-p','5437','-d',database,'/tmp/'+name+'.dump']);
  await execute('docker',['exec',manifest.target.container,'pg_restore','--exit-on-error','--data-only','--disable-triggers','-U','project_acquire','-p','5437','-d',database,'/tmp/'+name+'.dump']);
 }
 await execute('docker',['exec','-i',manifest.target.container,'psql','-U','project_acquire','-p','5437','-d','postgres','-v','ON_ERROR_STOP=1'],await readFile(resolve(directory,'database-comments.sql')));
 const verified=[];
 for(const source of manifest.sources){
  const db=new pg.Client({host:'127.0.0.1',port:5442,database:source.identity.database,user:'project_acquire',password:env.MIRROR_DATABASE_PASSWORD});
  try{await db.connect();for(const[name,count]of Object.entries(source.tableCounts)){if(!/^[a-z_][a-z_0-9]*$/.test(name))throw Error('Invalid table');const actual=(await db.query(`SELECT count(*)::text AS count FROM public."${name}"`)).rows[0].count;if(actual!==count)throw Error('Restored table count differs from snapshot: '+name)}verified.push({database:source.identity.database,tables:Object.keys(source.tableCounts).length})}finally{await db.end()}
 }
 const marker=(await client.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname='postgres'")).rows[0].marker;
 if(marker!=='acquire-research-app-local-only')throw Error('Mirror marker mismatch');
 await writeFile(resolve(directory,'restore-evidence.json'),JSON.stringify({appliedAt:new Date().toISOString(),manifestSha256:hash,identity,marker,verified,sourceDatabasesChanged:false},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({restored:true,identity,marker,verified}));
}finally{await client.end()}
