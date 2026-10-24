import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../..',import.meta.url));
function config(aligned){const files=['local','multichannel','demos','testing',...(aligned?['aligned']:[])];return JSON.parse(execFileSync('docker',['compose',...files.flatMap(x=>['-f',`ops/agent-mode/compose.${x}.yml`]),'config','--no-env-resolution','--format','json'],{cwd,encoding:'utf8',timeout:20000}));}
test('aligned overlay isolates only app dependency and cache mounts without changing shared services',()=>{
 const base=config(false),aligned=config(true),changed=['app','agent','dependencies'];
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
});
