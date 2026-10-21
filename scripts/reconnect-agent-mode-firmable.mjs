import {readFileSync,writeFileSync,renameSync,chmodSync,realpathSync} from 'node:fs';
import {resolve,sep,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
import {spawnSync} from 'node:child_process';
import {assertAgentModeNamespaceActivation} from './agent-mode-namespace-activation.mjs';
import {agentDatabaseConfig,assertAgentDatabaseIdentity} from './agent-mode-local-database.mjs';

/** Accept Cookie exports or the existing private bootstrap format. No account,
 * encryption, communications, database or service settings come from this input. */
export function firmableReconnectCredentials(input,expectedOrganization){
 let value=input;
 if(Array.isArray(input?.cookies)){
  const find=(name,domain)=>input.cookies.find(c=>c.name===name&&c.domain?.replace(/^\./,'')===domain)?.value;
  const context=find('clerk_active_context','app.firmable.com')?.split(':');
  value={cookie:find('__client','clerk.firmable.com'),sessionId:context?.[0],organizationId:context?.[1],sessionToken:find('__session','app.firmable.com')};
 }else if(input?.FIRMABLE_CLIENT_COOKIE!==undefined)value={cookie:input.FIRMABLE_CLIENT_COOKIE,sessionId:input.FIRMABLE_SESSION_ID,organizationId:input.FIRMABLE_ORGANIZATION_ID,sessionToken:input.FIRMABLE_SESSION_TOKEN};
 if(!value||typeof value.cookie!=='string'||value.cookie.length<=20||value.cookie.length>=10000||/[\r\n;,\s]/.test(value.cookie)||!/^sess_[A-Za-z0-9]+$/.test(value.sessionId??'')||!/^org_[A-Za-z0-9]+$/.test(value.organizationId??''))throw Error('Provide the Clerk __client Cookie, app session ID and organization in a private JSON file');
 if(!expectedOrganization||value.organizationId!==expectedOrganization)throw Error('Firmable organization differs from the configured local account');
 if(value.sessionToken!==undefined&&(typeof value.sessionToken!=='string'||value.sessionToken.length>=10000||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.sessionToken)))throw Error('Invalid optional Firmable session token');
 return{cookie:value.cookie,sessionId:value.sessionId,organizationId:value.organizationId,...(value.sessionToken?{sessionToken:value.sessionToken}:{})};
}

// The transport is fixed to the owned container's private loopback service.
// Secrets travel through stdin, not shell interpolation or process arguments.
const wire=`let raw='';for await(const chunk of process.stdin)raw+=chunk;try{const input=JSON.parse(raw);if(!['/reconnect','/status'].includes(input.path))throw Error();const response=await fetch('http://127.0.0.1:8787/firmable'+input.path,{method:input.path==='/reconnect'?'POST':'GET',headers:{Authorization:'Bearer '+input.secret,'Content-Type':'application/json'},...(input.path==='/reconnect'?{body:JSON.stringify(input.credentials)}:{}),redirect:'manual',signal:AbortSignal.timeout(20000)});const body=await response.json().catch(()=>({}));const categories=new Set(['upstream_authentication','reconnect_required','unexpected_organization','invalid_credentials','rate_limited','service_busy','provider_offline','not_configured','invalid_token_response','unexpected_token_context','upstream_unavailable','upstream_error','service_unavailable']);console.log(JSON.stringify({status:response.status,body:{...(body.connected===true?{connected:true}:{}),...(typeof body.configured==='boolean'?{configured:body.configured}:{}),...(typeof body.reconnectRequired==='boolean'?{reconnectRequired:body.reconnectRequired}:{}),...(categories.has(body.category)?{category:body.category}:{})}}));}catch{console.log(JSON.stringify({status:0,body:{category:'outcome_unknown'}}));}`;
export function firmableReconnectInvocation(path,credentials,secret){
 if(!['/reconnect','/status'].includes(path))throw Error('Use reconnect or status only');
 return{args:['--context','orbstack','exec','-i','project-acquire-agent-mode','node','--input-type=module','-e',wire],input:JSON.stringify({path,...(path==='/reconnect'?{credentials}:{}),secret})};
}
export async function reconnectFirmableAccount({credentials,invoke,persist}){
 const result=await invoke('/reconnect',credentials);
 if(result.status===0||(result.status>=500&&!['provider_offline','not_configured'].includes(result.body?.category))||(result.status>=200&&result.status<300&&result.body?.connected!==true))throw Error('Firmable reconnect outcome unknown; no automatic retry or bootstrap replacement');
 if(result.status!==200||result.body?.connected!==true){
  const known=new Set(['upstream_authentication','reconnect_required','unexpected_organization','invalid_credentials','rate_limited','service_busy','provider_offline','not_configured']);
  const category=known.has(result.body?.category)?result.body.category:'service_error';
  throw Error(`Firmable reconnect failed (${Number.isInteger(result.status)?result.status:0}, ${category}); existing connection retained`);
 }
 try{await persist(credentials);}catch{throw Error('Firmable reconnected, but private bootstrap persistence failed; repair the local file without repeating renewal');}
 const status=await invoke('/status');
 return{connected:true,statusVerified:status.status===200&&status.body?.configured===true&&status.body?.reconnectRequired===false};
}

async function main(args){
 if(args.includes('--help')){console.log('node scripts/reconnect-agent-mode-firmable.mjs --credentials .local-data/firmable-D-credentials.json --apply\nUses the marked local agent stack only. One authentication renewal; no research or enrichment.');return;}
 let source='.local-data/firmable-D-credentials.json',apply=false;
 for(let i=0;i<args.length;i++){if(args[i]==='--apply')apply=true;else if(args[i]==='--credentials'&&args[i+1])source=args[++i];else throw Error('Use --credentials <ignored JSON file> and explicit --apply');}
 const root=realpathSync(process.cwd());if(basename(root)!=='project-acquire-agent-mode')throw Error('Run from the isolated project-acquire-agent-mode worktree');
 const privateRoot=realpathSync(resolve(root,'.local-data'))+sep,sourcePath=realpathSync(resolve(root,source));
 if(!sourcePath.startsWith(privateRoot)||!sourcePath.endsWith('.json'))throw Error('Credential input must be an ignored JSON under this worktree .local-data');
 const ignored=spawnSync('git',['check-ignore','--quiet',sourcePath],{cwd:root});if(ignored.status!==0)throw Error('Credential file must be ignored by git');
 const directory=resolve(root,'.local-data/agent-mode-orbstack'),worker=parseEnv(readFileSync(resolve(directory,'worker.env'),'utf8')),app=parseEnv(readFileSync(resolve(directory,'runtime.env'),'utf8'));
 if(app.APP_URL!=='http://acquire-agent.orb.local'||app.LOCAL_DEVELOPMENT!=='true'||app.DATABASE_URL!==agentDatabaseConfig('container').url||app.FIRMABLE_TRANSPORT!=='cloudflare-session'||app.FIRMABLE_SERVICE_URL!=='http://127.0.0.1:8787/firmable'||app.LOCAL_FIRMABLE_MODE||worker.LOCAL_FIRMABLE_MODE)throw Error('Expected active isolated local Firmable service configuration');
 if(!worker.FIRMABLE_SERVICE_SECRET||app.FIRMABLE_SERVICE_SECRET!==worker.FIRMABLE_SERVICE_SECRET||!worker.FIRMABLE_CREDENTIAL_KEY)throw Error('Existing local Firmable service settings differ');
 const credentials=firmableReconnectCredentials(JSON.parse(readFileSync(sourcePath,'utf8')),worker.FIRMABLE_ORGANIZATION_ID);
 const runDocker=argv=>spawnSync('docker',argv,{cwd:root,encoding:'utf8',timeout:10000});
 assertAgentModeNamespaceActivation({composeFile:resolve(root,'ops/agent-mode/compose.local.yml'),runDocker});
 const {default:pg}=await import('pg');const pool=new pg.Pool({connectionString:agentDatabaseConfig('host').url});
 try{assertAgentDatabaseIdentity((await pool.query("SELECT current_database() database,shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()")).rows[0]);}finally{await pool.end();}
 if(!apply){console.log(JSON.stringify({ready:true,target:'acquire-agent-mode-local-only',action:'authenticated reconnect',providerRequests:0,note:'Add --apply to replace the saved local connection'}));return;}
 chmodSync(sourcePath,0o600);
 const receipt=await reconnectFirmableAccount({credentials,invoke:async(path,body)=>{
  const request=firmableReconnectInvocation(path,body,worker.FIRMABLE_SERVICE_SECRET),response=spawnSync('docker',request.args,{cwd:root,encoding:'utf8',input:request.input,timeout:25000,maxBuffer:100000});
  if(response.status!==0)return{status:0,body:{category:'outcome_unknown'}};
  try{return JSON.parse(response.stdout);}catch{return{status:0,body:{category:'outcome_unknown'}};}
 },persist:async value=>{
  const path=resolve(root,'.local-data/firmable-D-credentials.json'),temp=path+'.replacement-'+process.pid;
  const next={FIRMABLE_CLIENT_COOKIE:value.cookie,FIRMABLE_SESSION_ID:value.sessionId,FIRMABLE_ORGANIZATION_ID:value.organizationId,...(value.sessionToken?{FIRMABLE_SESSION_TOKEN:value.sessionToken}:{}),FIRMABLE_CREDENTIAL_KEY:worker.FIRMABLE_CREDENTIAL_KEY,FIRMABLE_SERVICE_SECRET:worker.FIRMABLE_SERVICE_SECRET};
  writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});renameSync(temp,path);
 }});
 writeFileSync(resolve(directory,'evidence/firmable-last-reconnect.private.json'),JSON.stringify({at:new Date().toISOString(),...receipt,target:'acquire-agent-mode-local-only',renewalRequests:1,researchRequests:0,productionChanged:false},null,2),{mode:0o600});
 console.log(JSON.stringify({...receipt,target:'acquire-agent-mode-local-only',researchRequests:0,productionChanged:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv.slice(2)).catch(error=>{console.error(error instanceof SyntaxError?'Invalid private credentials JSON':error.message);process.exitCode=1;});
