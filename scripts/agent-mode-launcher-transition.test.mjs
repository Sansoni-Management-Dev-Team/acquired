import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,mkdir,copyFile,writeFile,readFile,chmod,rm,realpath}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{spawnSync}from'node:child_process';
test('controlled launcher frees legacy host ports after stopping the worker and verifying idleness, before creating the new owner',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'agent-launch-transition-')));
 try{
  for(const dir of['scripts','bin','cloudflare/research','ops/agent-mode'])await mkdir(join(root,dir),{recursive:true});
  for(const name of['start-agent-mode-orbstack.mjs','dev-config.mjs','agent-mode-local-database.mjs','agent-mode-communications-env.mjs','agent-mode-env-file.mjs','agent-mode-launcher-services.mjs','agent-mode-restart-guard.mjs','agent-mode-worker-env.mjs','agent-mode-namespace-activation.mjs','agent-mode-research-env.mjs','agent-mode-demo-launcher.mjs','agent-mode-testing-launcher.mjs','agent-mode-demo-communications-env.mjs','agent-mode-demo-activation.mjs'])await copyFile(new URL('./'+name,import.meta.url),join(root,'scripts',name));
  await writeFile(join(root,'next-env.d.ts'),'//fixture\n');await writeFile(join(root,'fixture.env'),'');await writeFile(join(root,'cloudflare/research/wrangler.jsonc'),'{}');
  await writeFile(join(root,'state.json'),JSON.stringify({app:true,worker:true,network:false}));
  await writeFile(join(root,'bin/docker'),`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2),root=process.env.FAKE_ROOT,path=root+'/state.json',s=JSON.parse(fs.readFileSync(path,'utf8'));fs.appendFileSync(root+'/calls.jsonl',JSON.stringify(args)+'\\n');
const save=()=>fs.writeFileSync(path,JSON.stringify(s)),record=service=>({id:({app:'a',network:'b',agent:'c'}[service]).repeat(64),name:({app:'/project-acquire-agent-mode',network:'/project-acquire-agent-network',agent:'/project-acquire-agent-worker'}[service]),networkMode:service==='app'?(s.network?'container:'+'b'.repeat(64):'acquire-agent-mode_default'):'container:'+'a'.repeat(64),running:service==='agent'?s.worker:s[service],paused:false,labels:{'com.docker.compose.project':'acquire-agent-mode','com.docker.compose.service':service,'com.docker.compose.project.config_files':root+'/ops/agent-mode/compose.local.yml'}});
if(args.includes('inspect')){const name=args.at(-1),service=({'project-acquire-agent-mode':'app','project-acquire-agent-network':'network','project-acquire-agent-worker':'agent'}[name]);if(service==='network'&&!s.network){console.error('Error: No such object: '+name);process.exit(1);}console.log(JSON.stringify(record(service)));}
else if(args.includes('stop')){if(args.at(-1)==='project-acquire-agent-worker')s.worker=false;else if(args.at(-1)==='a'.repeat(64))s.app=false;else process.exit(3);save();}
else if(args.includes('exec')&&args.join(' ').includes('agent_operations'))console.log(JSON.stringify({database:'acquire_agent_mode',marker:'acquire-agent-mode-local-only',runningOperations:0,runningRuns:0}));
else if(args.includes('compose')&&args.includes('up')){if(!s.network&&s.app){console.error('bind127.0.0.1:3026:portalreadyallocated');process.exit(1);}s.network=true;s.app=true;if(args.at(-1)==='agent')s.worker=true;save();}
process.exit(0);
`);await chmod(join(root,'bin/docker'),0o700);
  const result=spawnSync(process.execPath,[join(root,'scripts/start-agent-mode-orbstack.mjs'),'--restart-app'],{cwd:root,env:{PATH:join(root,'bin'),HOME:root,FAKE_ROOT:root,AGENT_MODE_LOCAL_ENV:join(root,'fixture.env')},encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,'controlled startup must not collide with the old app ports: '+result.stderr);
  const calls=(await readFile(join(root,'calls.jsonl'),'utf8')).trim().split('\n').map(JSON.parse),workerStop=calls.findIndex(x=>x.includes('stop')&&x.at(-1)==='project-acquire-agent-worker'),idle=calls.findIndex(x=>x.includes('exec')&&x.join(' ').includes('agent_operations')),appStop=calls.findIndex(x=>x.includes('stop')&&x.at(-1)==='a'.repeat(64)),firstUp=calls.findIndex(x=>x.includes('compose')&&x.includes('up'));
  assert.ok(workerStop>=0&&idle>workerStop&&appStop>idle&&firstUp>appStop);assert.deepEqual(JSON.parse(await readFile(join(root,'state.json'),'utf8')),{app:true,worker:true,network:true});
 }finally{await rm(root,{recursive:true,force:true});}
});
