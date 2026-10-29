import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import pg from 'pg';
const manifest=JSON.parse(readFileSync('migrations/manifest.json','utf8'));
const sql=readFileSync(manifest.file,'utf8');
if(process.argv[2] !== `--approved-sha256=${manifest.sha256}`)throw new Error('Explicit approval of the reviewed schema hash is required');
if(createHash('sha256').update(sql).digest('hex')!==manifest.sha256)throw new Error('Reviewed schema hash mismatch');
const env=parseEnv(readFileSync('.env','utf8'));
// The operator cannot accidentally inherit a production DATABASE_URL.
const client=new pg.Client({host:'127.0.0.1',port:5441,database:'acquire_research_local',user:'research',password:env.RESEARCH_DB_PASSWORD,connectionTimeoutMillis:5000});
try{
 await client.connect();
 const identity=(await client.query('SELECT current_database() AS database,current_user AS role')).rows[0];
 if(identity.database!=='acquire_research_local'||identity.role!=='research')throw new Error('Local database identity mismatch');
 await client.query(sql);
 const check=(await client.query('SELECT marker,(SELECT max(version) FROM dbos.dbos_migrations) AS version FROM research_service.identity')).rows[0];
 if(check.marker!==manifest.target.marker||Number(check.version)!==manifest.sdkSchemaVersion)throw new Error('Schema verification failed');
 console.log(JSON.stringify({applied:manifest.sha256,...check}));
}finally{await client.end();}
