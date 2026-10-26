import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const repository=fileURLToPath(new URL('../..',import.meta.url));
function config(cwd,aligned){const files=['local','multichannel','demos','testing',...(aligned?['aligned']:[])];return JSON.parse(execFileSync('docker',['compose',...files.flatMap(x=>['-f',`ops/agent-mode/compose.${x}.yml`]),'config','--no-env-resolution','--format','json'],{cwd,encoding:'utf8',timeout:20000,env:Object.fromEntries(['PATH','HOME','TMPDIR','SYSTEMROOT'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]))}));}
test('aligned overlay isolates only app dependency and cache mounts without changing shared services',()=>{
 const cwd=mkdtempSync(join(tmpdir(),'acquire-compose-aligned-'));
 try{
 const compose=join(cwd,'ops/agent-mode'),privateFiles=join(cwd,'.local-data/agent-mode-orbstack');
 mkdirSync(compose,{recursive:true});mkdirSync(privateFiles,{recursive:true});
 for(const name of ['local','multichannel','demos','testing','aligned'])copyFileSync(join(repository,`ops/agent-mode/compose.${name}.yml`),join(compose,`compose.${name}.yml`));
 // Compose versions differ in whether --no-env-resolution still checks these
 // files exist. Synthetic fixtures keep the test independent of local secrets.
 for(const name of ['runtime.env','communications-service.env','communications-demo-service.env'])writeFileSync(join(privateFiles,name),'# synthetic config-only fixture\n',{mode:0o600});
 const base=config(cwd,false),aligned=config(cwd,true),changed=['app','agent','dependencies'];
 for(const [name,service]of Object.entries(base.services))if(!changed.includes(name))assert.deepEqual(aligned.services[name],service,name);
 for(const name of changed){
  const before=base.services[name],after=aligned.services[name];assert.deepEqual({...after,volumes:before.volumes},before,name);
  for(const mount of before.volumes){const actual=after.volumes.find(x=>x.target===mount.target);assert.ok(actual,mount.target);
   if(mount.target==='/install/node_modules'||mount.target==='/workspace/node_modules')assert.equal(actual.source,'agent-aligned-node-modules');
   else if(mount.target==='/workspace/.next')assert.equal(actual.source,'agent-aligned-next');
   else assert.deepEqual(actual,mount);
  }
  assert.equal(after.volumes.length,before.volumes.length);
 }
 assert.ok(aligned.volumes['agent-aligned-node-modules']);assert.ok(aligned.volumes['agent-aligned-next']);assert.deepEqual(aligned.volumes['agent-postgres'],base.volumes['agent-postgres']);
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
