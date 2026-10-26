import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runtimeOverlay,localRuntimeConfig,sourceSnapshot} from './isolated-research-runtime.mjs';

test('runtime pins a release, uses a writable scratch mount and retains existing workflow state',()=>{
 const overlay=runtimeOverlay({release:'/private/releases/abc',modulesVolume:'aligned-modules'});
 assert.deepEqual(Object.keys(overlay.services),['research']);
 const worker=overlay.services.research;
 assert.equal(worker.network_mode,'service:network');
 assert.ok(worker.command.includes('--no-bundle'));
 assert.ok(!JSON.stringify(worker).includes('/project-acquire:'));
 assert.ok(worker.volumes.includes('/private/releases/abc:/release:ro'));
 assert.ok(worker.volumes.includes('isolated-research-scratch:/runtime'));
 assert.equal(worker.environment.MINIFLARE_CACHE_DIR,'/runtime/miniflare');
 assert.ok(worker.volumes.includes('isolated-research-state:/state'));
 assert.equal(worker.working_dir,'/runtime');
});
test('config retains local workflow identities without production bindings',()=>{
 const config=localRuntimeConfig({name:'acquire-isolated-research',main:'/editable/index.ts',account_id:'production',triggers:{crons:['* * * * *']},ai:{binding:'AI'},workflows:[{name:'acquire-isolated-research',binding:'RESEARCH',class_name:'AcquireResearch'}],vars:{LOCAL_DEVELOPMENT:'true',APP_ORIGIN:'http://127.0.0.1:3000'}});
 assert.equal(config.main,'/release/bundle/index.js');
 assert.equal(config.workflows[0].name,'acquire-isolated-research');
 assert.ok(!config.account_id&&!config.triggers&&!config.ai);
 assert.throws(()=>localRuntimeConfig({vars:{APP_ORIGIN:'https://acquire.mlai.au'}}),/local/);
});
test('snapshot does not follow live source changes or copy private environment',()=>{
 const root=mkdtempSync(join(tmpdir(),'acquire-runtime-source-'));
 try{
  mkdirSync(join(root,'src'),{recursive:true});mkdirSync(join(root,'cloudflare/research'),{recursive:true});mkdirSync(join(root,'communications/packages/core/src'),{recursive:true});
  for(const file of ['src/example.ts','cloudflare/research/index.ts','package.json','pnpm-lock.yaml','tsconfig.json'])writeFileSync(join(root,file),'before');
  writeFileSync(join(root,'.env'),'never-copy-this');
  const destination=join(root,'snapshot');sourceSnapshot(root,destination);
  writeFileSync(join(root,'src/example.ts'),'after');
  assert.equal(readFileSync(join(destination,'src/example.ts'),'utf8'),'before');
  assert.throws(()=>readFileSync(join(destination,'.env')));
 }finally{rmSync(root,{recursive:true,force:true});}
});
