import{spawn,spawnSync}from'node:child_process';
import{realpathSync}from'node:fs';
import{resolve,basename}from'node:path';
import{pathToFileURL}from'node:url';
import{agentDatabaseConfig,assertAgentDatabaseIdentity}from'./agent-mode-local-database.mjs';
import{assertAgentModeNamespaceActivation}from'./agent-mode-namespace-activation.mjs';
const fields=new Set(['timestamp','component','module','event','stage','segment','operation','provider','mandateId','jobId','runId','operationId','eventId','threadId','requestId','logicalCallId','attempt','elapsedMs','durationMs','outcome','httpStatus','category','failureOrigin','databaseCode','errorName','rowsReturned','candidates','discovered','sampledRows','uniqueIdentities','saved','processed','pending','retryAfterMs','status']);
/** A local operator projection, not a new telemetry store or authority source. */
export function projectMandateLog(line,scope){
 let record;try{record=JSON.parse(line.slice(line.indexOf('{')));}catch{return null;}
 if(!record||typeof record!=='object'||Array.isArray(record))return null;
 if(record.mandateId&&record.mandateId!==scope.mandateId)return null;
 if(record.mandateId!==scope.mandateId&&!scope.jobIds.has(record.jobId)&&!scope.jobIds.has(record.runId)&&!scope.operationIds.has(record.operationId))return null;
 return Object.fromEntries(Object.entries(record).filter(([key,value])=>fields.has(key)&&(typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean'||typeof value==='string'&&value.length<=160&&!/[\r\n]/.test(value))));
}
async function main(args){
 if(args.includes('--help')){console.log('pnpm agent:logs --mandate <UUID> [--since 15m] [--follow]\nReads only this marked local database and owned container logs. No research/provider requests.');return;}
 let mandateId,since='15m',follow=false;
 for(let i=0;i<args.length;i++){if(args[i]==='--mandate'&&args[i+1])mandateId=args[++i];else if(args[i]==='--since'&&args[i+1])since=args[++i];else if(args[i]==='--follow')follow=true;else throw Error('Use --mandate <UUID>, optional --since <duration> and --follow');}
 if(!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(mandateId??'')||!/^\d{1,4}[smh]$/.test(since))throw Error('Valid mandate UUID and bounded duration required');
 const root=realpathSync(process.cwd());if(basename(root)!=='project-acquire-agent-mode')throw Error('Run from the isolated agent worktree');
 assertAgentModeNamespaceActivation({composeFile:resolve(root,'ops/agent-mode/compose.local.yml'),runDocker:argv=>spawnSync('docker',argv,{cwd:root,encoding:'utf8',timeout:10000})});
 const{default:pg}=await import('pg'),pool=new pg.Pool({connectionString:agentDatabaseConfig('host').url});let rows;
 try{assertAgentDatabaseIdentity((await pool.query("SELECT current_database() database,shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()")).rows[0]);if(!(await pool.query('SELECT 1 FROM mandates WHERE id=$1',[mandateId])).rowCount)throw Error('Mandate not found in the isolated local database');rows=(await pool.query("SELECT id,config->'nativeAgent'->>'operationId' operation_id FROM research_jobs WHERE mandate_id=$1",[mandateId])).rows;}finally{await pool.end();}
 const scope={mandateId,jobIds:new Set(rows.map(row=>row.id)),operationIds:new Set(rows.map(row=>row.operation_id).filter(Boolean))};
 const names=['project-acquire-agent-mode','project-acquire-agent-research','project-acquire-agent-worker'];
 const children=[];const stop=()=>{for(const child of children)child.kill('SIGTERM');};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 await Promise.all(names.map(name=>new Promise((done,reject)=>{
  const child=spawn('docker',['--context','orbstack','logs','--since',since,'--tail','3000',...(follow?['--follow']:[]),name],{cwd:root,stdio:['ignore','pipe','pipe']});children.push(child);
  const buffers=new Map();for(const stream of[child.stdout,child.stderr]){buffers.set(stream,'');stream.setEncoding('utf8');stream.on('data',chunk=>{let value=buffers.get(stream)+chunk;if(value.length>1024*1024)value='';const lines=value.split('\n');buffers.set(stream,lines.pop());for(const line of lines){const record=projectMandateLog(line,scope);if(record)process.stdout.write(JSON.stringify({source:name,...record})+'\n');}});}
  child.on('error',()=>reject(Error('Could not read owned container logs')));child.on('close',code=>code===0||code===null?done():reject(Error('Owned container log stream failed')));
 })));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
