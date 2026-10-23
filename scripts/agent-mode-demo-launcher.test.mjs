import test from 'node:test';
import assert from 'node:assert/strict';
import {agentModeDemoLaunch} from './agent-mode-demo-launcher.mjs';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,chmod,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {serializeAgentEnvironment} from './agent-mode-env-file.mjs';

const key=n=>Buffer.alloc(32,n).toString('base64');
function fixture(){
 const shared={COMMUNICATIONS_ACTIVE_KEY_VERSION:'s1',COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:'s1',encryptionKey:key(1),digestKey:key(2)}]),COMMUNICATIONS_IDENTITY_KEY:key(3),COMMUNICATIONS_IDENTITY_KEY_VERSION:'i1',ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION:'a1',ACQUIRE_COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:'a1',encryptionKey:key(6),digestKey:key(7)}])};
 const application={...shared,NODE_ENV:'development',DATABASE_URL:'postgresql://project_acquire:agent-local-only@postgres:5432/acquire_agent_mode',COMMUNICATIONS_RUNTIME_ENABLED:'true',COMMUNICATIONS_SERVICE_URL:'https://127.0.0.1:5791',UNIPILE_API_URL:'https://127.0.0.1:5790',COMMUNICATIONS_SCOPED_AUTH_KEY:key(15),COMMUNICATIONS_SETUP_CALLBACK_KEY:key(14),COMMUNICATIONS_WEBHOOK_SECRET:'primary-private-webhook',AGENT_NATIVE_EXECUTION_ENABLED:'true',RESEARCH_PIPELINE_DESIGN:'F',RESEARCH_SERVICE_SECRET:'synthetic-research-secret'};
 const settings={...shared,AGENT_MODE_COMMUNICATIONS_MODE:'simulator',AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN:'https://127.0.0.1:5891',UNIPILE_API_URL:'https://127.0.0.1:5890',UNIPILE_API_KEY:'synthetic-demo-api-key',COMMUNICATIONS_APPLICATION_ID:'acquire',COMMUNICATIONS_INTEGRATION_ID:'sim-agent-real-research-demos',COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE:'sim-agent-real-research-demos-v1',COMMUNICATIONS_SCOPED_AUTH_KEY:key(5),COMMUNICATIONS_SETUP_CALLBACK_KEY:key(4),COMMUNICATIONS_WEBHOOK_SECRET:'demo-private-webhook'};
 return {application,settings};
}
test('explicit activation adds a durable lane and preserves primary provider, keys, research and worker settings',()=>{
 const f=fixture(),before=structuredClone(f),r=agentModeDemoLaunch({...f,activate:true,previous:{}});
 assert.equal(r.enabled,true);
 for(const [k,v] of Object.entries(f.application))assert.equal(r.application[k],v,k);
 assert.equal(r.application.AGENT_MODE_ENABLE_DEMOS,'true');
 assert.equal(r.service.COMMUNICATIONS_PORT,'5463');
 assert.deepEqual(JSON.parse(r.application.AGENT_DEMO_COMMUNICATIONS_ENV_JSON),r.service);
 assert.deepEqual(f,before);
});
test('ordinary restart preserves an already activated lane and its unchanged control authority',()=>{
 const f=fixture(),active=agentModeDemoLaunch({...f,activate:true,previous:{}});
 const previous={...active.application,AGENT_DEMO_CONTACTS_ENABLED:'true',AGENT_DEMO_CONTROL_URL:'https://127.0.0.1:5890',AGENT_DEMO_CONTROL_ADMIN_KEY:'synthetic-exclusive-admin'};
 const r=agentModeDemoLaunch({...f,previous,activate:false});
 assert.equal(r.enabled,true);
 for(const k of ['AGENT_DEMO_CONTACTS_ENABLED','AGENT_DEMO_CONTROL_URL','AGENT_DEMO_CONTROL_ADMIN_KEY'])assert.equal(r.application[k],previous[k]);
 assert.deepEqual(r.service,active.service);
});
test('unactivated normal startup does not implicitly enable or inspect optional demo settings',()=>{
 const f=fixture(),r=agentModeDemoLaunch({application:f.application,previous:{},settings:{UNIPILE_API_URL:'https://foreign.invalid'},activate:false});
 assert.equal(r.enabled,false);assert.deepEqual(r.application,f.application);assert.equal(r.service,null);
});
test('saved lane configuration cannot silently rotate, disappear or use a mismatched durable keyring',()=>{
 const f=fixture(),active=agentModeDemoLaunch({...f,activate:true,previous:{}});
 assert.throws(()=>agentModeDemoLaunch({...f,settings:null,previous:active.application}));
 assert.throws(()=>agentModeDemoLaunch({...f,settings:{...f.settings,UNIPILE_API_KEY:'different-key'},previous:active.application}));
 assert.throws(()=>agentModeDemoLaunch({...f,application:{...f.application,COMMUNICATIONS_IDENTITY_KEY:key(31)},previous:active.application}));
});
test('actual additive launcher preserves mounted research and primary files; an active journal prevents configuration writes',async()=>{
 for(const busy of [false,true]){
  const root=await realpath(await mkdtemp(join(tmpdir(),'agent-demo-launch-')));
  try{
   const privateDir=join(root,'.local-data/agent-mode-orbstack');
   for(const dir of ['scripts','bin','cloudflare/research','ops/agent-mode','.local-data/communications/service-build','.local-data/agent-mode-orbstack'])await mkdir(join(root,dir),{recursive:true});
   for(const name of ['start-agent-mode-orbstack.mjs','dev-config.mjs','agent-mode-local-database.mjs','agent-mode-communications-env.mjs','agent-mode-env-file.mjs','agent-mode-launcher-services.mjs','agent-mode-restart-guard.mjs','agent-mode-worker-env.mjs','agent-mode-namespace-activation.mjs','agent-mode-research-env.mjs','agent-mode-demo-launcher.mjs','agent-mode-testing-launcher.mjs','agent-mode-demo-communications-env.mjs','agent-mode-demo-activation.mjs'])await copyFile(new URL('./'+name,import.meta.url),join(root,'scripts',name));
   const f=fixture(),runtime=serializeAgentEnvironment(f.application);
   await writeFile(join(root,'next-env.d.ts'),'//fixture\n');
   await writeFile(join(root,'fixture.env'),'');
   await writeFile(join(root,'.local-data/communications/service-build/service.cjs'),'// fixture build\n');
   await writeFile(join(privateDir,'runtime.env'),runtime);
   await writeFile(join(privateDir,'communications.simulator-demos.private.env'),serializeAgentEnvironment(f.settings));
   for(const [name,content] of Object.entries({'communications-profile':'multichannel\n','worker.env':'research-settings-unchanged\n','wrangler.json':'{"persistedWorkflow":"retain"}\n','communications-service.env':'primary-service-unchanged\n'}))await writeFile(join(privateDir,name),content);
   await writeFile(join(root,'state.json'),JSON.stringify({worker:true,demo:false}));
   await writeFile(join(root,'bin/docker'),`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2),root=process.env.FAKE_ROOT,path=root+'/state.json',s=JSON.parse(fs.readFileSync(path,'utf8'));fs.appendFileSync(root+'/calls.jsonl',JSON.stringify(args)+'\\n');
const names={'project-acquire-agent-mode':'app','project-acquire-agent-network':'network','project-acquire-agent-worker':'agent','project-acquire-agent-demo-network':'demo-network'},id=service=>({'network':'a','app':'b','agent':'c','demo-network':'d'}[service]).repeat(64),save=()=>fs.writeFileSync(path,JSON.stringify(s));
if(args.includes('inspect')){const name=args.find(x=>x.startsWith('project-acquire-agent-')),service=names[name];if(!service||service==='demo-network'&&!s.demo){console.error('Error: No such object: '+name);process.exit(1);}console.log(JSON.stringify({id:id(service),name:'/'+name,networkMode:['network','demo-network'].includes(service)?'default':'container:'+id('network'),running:service==='agent'?s.worker:true,paused:false,labels:{'com.docker.compose.project':'acquire-agent-mode','com.docker.compose.service':service,'com.docker.compose.project.config_files':root+'/ops/agent-mode/compose.local.yml'}}));}
else if(args.includes('stop')){s.worker=false;save();}
else if(args.includes('start')){s.worker=true;save();}
else if(args.includes('readlink'))console.log('net:[100]');
else if(args.includes('exec')&&args.join(' ').includes('operation_journal'))console.log(JSON.stringify({database:'acquire_agent_mode',marker:'acquire-agent-mode-local-only',runningOperations:0,runningRuns:0,runningJournals:Number(process.env.BUSY)}));
else if(args.includes('up')&&args.at(-1)==='demo-network'){s.demo=true;save();}
process.exit(0);
`);
   await chmod(join(root,'bin/docker'),0o700);
   const result=spawnSync(process.execPath,[join(root,'scripts/start-agent-mode-orbstack.mjs'),'--activate-demos'],{cwd:root,env:{PATH:join(root,'bin'),HOME:root,FAKE_ROOT:root,BUSY:busy?'1':'0',AGENT_MODE_LOCAL_ENV:join(root,'fixture.env')},encoding:'utf8',timeout:15000});
   assert.equal(result.status,busy?1:0,result.stderr);
   const calls=(await readFile(join(root,'calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse),up=calls.filter(c=>c.includes('up'));
   assert.ok(up.every(c=>c.includes('--no-deps')&&!c.includes('research')&&!c.includes('network')&&!c.includes('communications')));
   assert.equal(up.length,busy?0:3);
   assert.deepEqual(JSON.parse(await readFile(join(root,'state.json'),'utf8')),{worker:!busy,demo:!busy});
   if(busy)assert.equal(await readFile(join(privateDir,'runtime.env'),'utf8'),runtime);
   else assert.equal((await readFile(join(privateDir,'runtime.env'),'utf8')).includes("AGENT_MODE_ENABLE_DEMOS='true'"),true);
   for(const [name,content] of Object.entries({'communications-profile':'multichannel\n','worker.env':'research-settings-unchanged\n','wrangler.json':'{"persistedWorkflow":"retain"}\n','communications-service.env':'primary-service-unchanged\n'}))assert.equal(await readFile(join(privateDir,name),'utf8'),content,name);
  }finally{await rm(root,{recursive:true,force:true});}
 }
});
