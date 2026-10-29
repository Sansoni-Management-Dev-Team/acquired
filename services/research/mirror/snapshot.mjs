// Read-only snapshots of the two databases used by acquire-isolated. Nothing is
// restored or migrated here. Dumps and runtime configuration stay ignored/private.
import {execFile,spawn} from 'node:child_process';
import {promisify,parseEnv} from 'node:util';
import {open,mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const directory=resolve(dirname(fileURLToPath(import.meta.url)),'../.local/mirror');
await mkdir(directory,{recursive:true,mode:0o700});
const inspect=async name=>JSON.parse((await promisify(execFile)('docker',['inspect',name])).stdout)[0];
const app=await inspect('acquire-isolated-app');
const env=Object.fromEntries(app.Config.Env.map(text=>{const i=text.indexOf('=');return[text.slice(0,i),text.slice(i+1)]}));
if(env.LOCAL_DEVELOPMENT!=='true'||env.NODE_ENV!=='development')throw Error('Expected the local development isolated app');
const sourceConfig=JSON.parse(await readFile('/Users/callum/Documents/Development/acquire-simulator/.local-data/isolated-workspace/config/configuration.json','utf8'));
const sources=[{name:'application',container:'project-acquire-agent-postgres',url:env.DATABASE_URL,port:'5437',database:'acquire_agent_mode'},{name:'facts',container:'project-acquire-postgres',url:sourceConfig.factsDatabaseUrl,port:'5434',database:'project_acquire'}];
async function capture(container,args,file){
 const handle=await open(resolve(directory,file),'wx',0o600);
 try{await new Promise((resolve,reject)=>{const child=spawn('docker',['exec',container,...args],{stdio:['ignore',handle.fd,'pipe']});let error='';child.stderr.on('data',chunk=>error+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Snapshot command failed (${code}): ${error.slice(0,300)}`)))})}finally{await handle.close()}
}
const manifest={preparedAt:new Date().toISOString(),sourceAppCommit:(await promisify(execFile)('git',['-C','/Users/callum/Documents/Development/project-acquire','rev-parse','HEAD'])).stdout.trim(),target:{host:'127.0.0.1',port:5442,container:'acquire-research-app-db',composeProject:'acquire-research-app',volume:'acquire-research-app_database',databaseMarker:'acquire-research-app-local-only',databases:['acquire_agent_mode','project_acquire']},sources:[],files:[],applied:false};
const roleNames=new Set(['project_acquire']);
for(const source of sources){
 const url=new URL(source.url);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!==source.port||url.pathname!==`/${source.database}`)throw Error('Unexpected source database identity');
 const db=new pg.Client({connectionString:url.href,connectionTimeoutMillis:5000,statement_timeout:30000});
 try{
  await db.connect();await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const identity=(await db.query("SELECT current_database() AS database,current_user AS role,(SELECT system_identifier FROM pg_control_system())::text AS system_id,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()" )).rows[0];
  if(identity.database!==source.database||identity.role!=='project_acquire'||source.name==='application'&&identity.marker!=='acquire-agent-mode-local-only')throw Error('Source database identity mismatch');
  const snapshot=(await db.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
  const tableNames=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row=>row.tablename);
  const counts={};for(const name of tableNames){if(!/^[a-z_][a-z_0-9]*$/.test(name))throw Error('Unexpected table identifier');counts[name]=(await db.query(`SELECT count(*)::text AS count FROM public."${name}"`)).rows[0].count}
  let login;
  if(source.name==='application')login=(await db.query('SELECT u.id,u.email,array_agg(a.provider_id) AS providers,bool_or(a.password IS NOT NULL) AS password_present FROM "user" u LEFT JOIN account a ON a.user_id=u.id WHERE lower(u.email)=lower($1) GROUP BY u.id',['callumpholt@gmail.com'])).rows[0];
  await capture(source.container,['pg_dump','-U','project_acquire','-d',source.database,'--format=custom',`--snapshot=${snapshot}`],`${source.name}.dump`);
  await capture(source.container,['pg_dumpall','-U','project_acquire','--roles-only','--no-role-passwords'],`${source.name}-roles.raw.sql`);
  // Keep all role attributes and grants, omit only roles already created by the
  // other archive or POSTGRES_USER. No source role passwords are exported.
  const raw=await readFile(resolve(directory,`${source.name}-roles.raw.sql`),'utf8');
  const roles=raw.split('\n').filter(line=>{const match=/^CREATE ROLE (?:"([^"]+)"|([^;]+));$/.exec(line);if(!match)return true;const name=match[1]||match[2];if(roleNames.has(name))return false;roleNames.add(name);return true}).join('\n');
  await writeFile(resolve(directory,`${source.name}-roles.sql`),roles,{mode:0o600});
  await db.query('COMMIT');
  manifest.sources.push({name:source.name,container:source.container,identity,tableCounts:counts,...(login?{login}:{})});
 }finally{await db.end()}
}
const comments="COMMENT ON DATABASE acquire_agent_mode IS 'acquire-agent-mode-local-only';\nCOMMENT ON DATABASE project_acquire IS 'acquire-research-facts-local-only';\n";
await writeFile(resolve(directory,'database-comments.sql'),comments,{mode:0o600});
for(const file of ['application.dump','facts.dump','application-roles.sql','facts-roles.sql','database-comments.sql']){const data=await readFile(resolve(directory,file));manifest.files.push({file,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')})}
await writeFile(resolve(directory,'source-app.env'),Object.entries(env).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join('\n')+'\n',{mode:0o600});
await writeFile(resolve(directory,'restore-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({prepared:true,target:manifest.target,sourceTables:manifest.sources.map(source=>({name:source.name,tables:Object.keys(source.tableCounts).length})),files:manifest.files}));
