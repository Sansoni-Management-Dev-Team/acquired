// Explicit local connection setup only. No migrations, sends or provider-account
// changes run here. The user completes the hosted connection in their browser.
import {readFileSync,writeFileSync,existsSync,mkdirSync,openSync,closeSync,chmodSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {parseEnv} from 'node:util';
import {resolve} from 'node:path';
import pg from 'pg';
import {agentDatabaseConfig,assertAgentDatabaseIdentity} from './agent-mode-local-database.mjs';
import {serializeAgentEnvironment} from './agent-mode-env-file.mjs';

const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'.local-data/agent-mode-orbstack');
if(!process.argv.includes('--connect-only'))throw Error('Explicit --connect-only required');
mkdirSync(directory,{recursive:true,mode:0o700});
const settingsPath=resolve(directory,'communications.private.env'),tunnelPath=resolve(directory,'mailbox-tunnel.json');
const client=new pg.Client({connectionString:agentDatabaseConfig().url});
await client.connect();
try{
 assertAgentDatabaseIdentity((await client.query("SELECT current_database() AS database,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]);
 const ready=await client.query("SELECT to_regclass('communications.auth_states') IS NOT NULL AND to_regclass('communications.setup_notification_inbox') IS NOT NULL AS ready");
 if(!ready.rows[0]?.ready)throw Error('Install reviewed local communications schema before connection setup');
}finally{await client.end();}

let settings=existsSync(settingsPath)?parseEnv(readFileSync(settingsPath,'utf8')):null;
if(!settings){
 // This explicit operator action imports only the existing Unipile API credential
 // and endpoint, never an account/session, sender, shared database or old keys.
 const source=parseEnv(readFileSync(resolve(root,'../project-acquire/.env.local'),'utf8'));
 if(source.UNIPILE_API_VERSION!=='v1'||!source.UNIPILE_API_KEY)throw Error('Private Unipile v1 configuration unavailable');
 const api=new URL(source.UNIPILE_BASE_URL);
 if(api.protocol!=='https:'||api.username||api.password||api.search||api.hash||!['/','/api/v1','/api/v1/'].includes(api.pathname))throw Error('Explicit Unipile endpoint unavailable');
 const key=()=>randomBytes(32).toString('base64');
 settings={
  AGENT_MODE_COMMUNICATIONS_MODE:'connect-only',UNIPILE_API_URL:api.origin,UNIPILE_API_KEY:source.UNIPILE_API_KEY,
  COMMUNICATIONS_APPLICATION_ID:'acquire',COMMUNICATIONS_INTEGRATION_ID:'acquire-agent-mode-local',
  COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE:'acquire-agent-mode-local-unipile-v1',
  COMMUNICATIONS_ACTIVE_KEY_VERSION:'local-v1',COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:'local-v1',encryptionKey:key(),digestKey:key()}]),
  COMMUNICATIONS_IDENTITY_KEY:key(),COMMUNICATIONS_IDENTITY_KEY_VERSION:'local-v1',
  COMMUNICATIONS_SCOPED_AUTH_KEY:key(),COMMUNICATIONS_SETUP_CALLBACK_KEY:key(),COMMUNICATIONS_WEBHOOK_SECRET:randomBytes(32).toString('hex'),
  ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION:'local-v1',ACQUIRE_COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:'local-v1',encryptionKey:key(),digestKey:key()}]),
 };
}

let tunnel;
if(existsSync(tunnelPath)){
 const candidate=JSON.parse(readFileSync(tunnelPath,'utf8'));
 if(Number.isSafeInteger(candidate.pid)&&/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(candidate.origin)){
  const command=spawnSync('ps',['-p',String(candidate.pid),'-o','command='],{encoding:'utf8'});
  if(command.status===0&&command.stdout.includes('cloudflared')&&command.stdout.includes('http://127.0.0.1:5462'))tunnel=candidate;
 }
}
if(!tunnel){
 const logPath=resolve(directory,'mailbox-tunnel.private.log');
 const fd=openSync(logPath,'w',0o600);chmodSync(logPath,0o600);
 const child=spawn('cloudflared',['tunnel','--no-autoupdate','--url','http://127.0.0.1:5462','--protocol','http2'],{cwd:root,detached:true,stdio:['ignore',fd,fd]});
 closeSync(fd);child.unref();
 let failure;child.once('error',error=>{failure=error;});
 for(let attempt=0;attempt<120;attempt++){
  if(failure)throw Error('Local callback tunnel could not start');
  const match=readFileSync(logPath,'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if(match){tunnel={pid:child.pid,origin:match[0],createdAt:new Date().toISOString()};break;}
  if(child.exitCode!==null)throw Error('Local callback tunnel exited; inspect private log');
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(!tunnel){child.kill();throw Error('Callback tunnel startup timed out');}
 writeFileSync(tunnelPath,JSON.stringify(tunnel)+'\n',{mode:0o600});chmodSync(tunnelPath,0o600);
}
settings.AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN=tunnel.origin;
writeFileSync(settingsPath,serializeAgentEnvironment(settings),{mode:0o600});
chmodSync(settingsPath,0o600);
for(const script of ['build-communications-service.mjs','start-agent-mode-orbstack.mjs']){
 const args=[resolve(root,'scripts',script),...(script.startsWith('start-')?['--restart-app']:[])];
 const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});
 if(result.status!==0)throw Error('Local mailbox setup startup failed');
}
const healthy=await fetch(tunnel.origin+'/health',{signal:AbortSignal.timeout(15000)});
if(!healthy.ok)throw Error('Callback tunnel is not ready');
console.log('Local mailbox connection setup ready. Open http://acquire-agent.orb.local/settings. Outbound quotas remain zero.');
