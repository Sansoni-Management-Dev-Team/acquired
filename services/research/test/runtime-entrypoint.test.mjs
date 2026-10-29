import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,writeFile,readFile,chmod,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{fileURLToPath}from'node:url';import{spawnSync}from'node:child_process';
const script=fileURLToPath(new URL('../runtime/stack.sh',import.meta.url));
for(const pending of [0,2])test(`shared entry point ${pending?'refuses active work':'stops the worker before replacing its network'}`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'research-entrypoint-'));
 try{
  const docker=join(dir,'docker'),log=join(dir,'calls');
  await writeFile(docker,`#!/usr/bin/env bash
printf '%s|%s\\n' "\${OPENAI_RESEARCH_MODEL-unset}" "$*" >> "$CALL_LOG"
case " $* " in *" exec "*) printf '%s\\n' "$PENDING";; esac
`);await chmod(docker,0o700);
  const child=spawnSync('bash',[script,'up','-d'],{encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,CALL_LOG:log,PENDING:String(pending),RESEARCH_RUNTIME_ENV:join(dir,'private.env'),RESEARCH_RUNTIME_OVERRIDE:'',OPENAI_RESEARCH_MODEL:'incidental-shell-override'}});
  const calls=(await readFile(log,'utf8').catch(()=>{throw Error('Entrypoint failed before Docker: '+child.stderr)})).trim().split('\n').map(line=>{const i=line.indexOf('|');return{modelOverride:line.slice(0,i),args:line.slice(i+1)}});
  assert.ok(calls.every(c=>c.modelOverride==='unset'));
  if(pending){assert.equal(child.status,1);assert.match(child.stderr,/Drain dispatch/);assert.ok(calls.every(c=>!c.args.includes(' stop ')&&!c.args.includes(' up ')))}
  else{assert.equal(child.status,0);assert.match(calls.at(-2).args,/ stop research$/);assert.match(calls.at(-1).args,/ up -d$/)}
 }finally{await rm(dir,{recursive:true,force:true})}
});
