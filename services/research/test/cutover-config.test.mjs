import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../deploy/cutover-config.py',import.meta.url));
test('cutover and rollback preserve unrelated raw settings and repeated apply cannot replace the saved rollback',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'research-cutover-'));
 try{
  const before={RESEARCH_WORKER_URL:'https://old.example',RESEARCH_SERVICE_SECRET:'old-secret'},after={RESEARCH_WORKER_URL:'http://10.126.0.10:18797',RESEARCH_SERVICE_SECRET:'new-secret'};
  const original='APP_URL=https://acquire.mlai.au\nRESEARCH_WORKER_URL='+before.RESEARCH_WORKER_URL+'\nOTHER={"raw":"$literal\\nvalue"}\nRESEARCH_SERVICE_SECRET=old-secret\nFIRMABLE_SERVICE_SECRET=separate-secret\n';
  await writeFile(join(dir,'runtime.env'),original);await writeFile(join(dir,'state.json'),JSON.stringify({before,after}));
  const run=action=>execFileSync('python3',[script,action,join(dir,'runtime.env'),join(dir,'state.json')],{stdio:'pipe'});
  run('apply');const changed=await readFile(join(dir,'runtime.env'),'utf8');assert.equal(changed,original.replace(before.RESEARCH_WORKER_URL,after.RESEARCH_WORKER_URL).replace('RESEARCH_SERVICE_SECRET=old-secret','RESEARCH_SERVICE_SECRET=new-secret'));
  assert.equal((await stat(join(dir,'runtime.env'))).mode&0o777,0o600);
  run('apply');run('rollback');assert.equal(await readFile(join(dir,'runtime.env'),'utf8'),original);run('rollback');
  await writeFile(join(dir,'runtime.env'),original.replace('old-secret','unexpected-secret'));assert.throws(()=>run('apply'));assert.match(await readFile(join(dir,'runtime.env'),'utf8'),/unexpected-secret/);
  await writeFile(join(dir,'runtime.env'),original+'RESEARCH_WORKER_URL=https://duplicate.example\n');assert.throws(()=>run('apply'));
 }finally{await rm(dir,{recursive:true,force:true})}
});
