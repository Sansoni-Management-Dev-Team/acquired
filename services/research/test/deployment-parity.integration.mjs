import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const serviceDir=fileURLToPath(new URL('../',import.meta.url));
const readerSource=fileURLToPath(new URL('../../../cloudflare/crawl4ai/server.py',import.meta.url));
import {execFileSync} from 'node:child_process';

test('local and hosted deployments share runtime settings and retain separate existing databases',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'research-parity-'));
 try{
  await writeFile(join(dir,'keys.env'),'OPENAI_API_KEY=synthetic-key\nRESEARCH_FIRMABLE_CREDENTIAL_KEY=synthetic-encryption-key\n');
  await writeFile(join(dir,'callback.env'),'');
  const render=target=>{
   const local=target==='local',name=local?'acquire_research_local':'acquire_research_do_test',project=local?'acquire-research-service':'acquire-research-do-test';
   return JSON.parse(execFileSync('docker',['compose','--env-file','runtime/release.env','-f','deploy/compose.yml','config','--format','json'],{cwd:serviceDir,env:{...process.env,RESEARCH_COMPOSE_PROJECT:project,RESEARCH_DATABASE_NAME:name,RESEARCH_DATABASE_VOLUME:project+'_research-db',RESEARCH_DEPLOYMENT:target,RESEARCH_DB_PASSWORD:'synthetic-password',RESEARCH_SERVICE_SECRET:'s'.repeat(32),RESEARCH_PROVIDER_ENV_FILE:join(dir,'keys.env'),RESEARCH_CALLBACK_ENV_FILE:join(dir,'callback.env'),RESEARCH_CALLBACK_MODE:local?'acquire-isolated':'test',RESEARCH_OUTPUT_DIR:dir,RESEARCH_READER_SOURCE:readerSource},encoding:'utf8'}));
  };
  const local=render('local'),hosted=render('digitalocean-test');
  for(const name of ['research','fixture','reader','search']){
   assert.equal(local.services[name].image,hosted.services[name].image);
   assert.equal(local.services[name].platform,'linux/amd64');
  }
  const settings=s=>Object.fromEntries(Object.entries(s.services.research.environment).filter(([k])=>!['RESEARCH_DATABASE_URL','RESEARCH_DEPLOYMENT'].includes(k)));
  assert.deepEqual(settings(local),settings(hosted));
  assert.equal(local.services.research.environment.LOCAL_SEARCH_ENGINE,undefined);
  assert.equal(local.services.research.environment.RESEARCH_AI_PROVIDER,'openai');
  assert.equal(local.services.research.environment.RESEARCH_SEARCH_PROVIDER,'local');
  assert.equal(local.services.research.environment.RESEARCH_READER_PROVIDER,'crawl4ai');
  assert.equal(local.services.research.environment.OPENAI_RESEARCH_MODEL,'gpt-6-luna');
  assert.equal(local.services.database.environment.POSTGRES_DB,'acquire_research_local');
  assert.equal(hosted.services.database.environment.POSTGRES_DB,'acquire_research_do_test');
  assert.equal(local.volumes['research-db'].name,'acquire-research-service_research-db');
  assert.equal(hosted.volumes['research-db'].name,'acquire-research-do-test_research-db');
  assert.equal(local.volumes['research-db'].external,true);
  assert.equal(hosted.volumes['research-db'].external,true);
  assert.equal(local.services.fixture.environment.HARNESS_MODE,'acquire-isolated');
  assert.equal(hosted.services.fixture.environment.HARNESS_MODE,'test');
  assert.equal(local.services.database.ports,undefined);
 }finally{await rm(dir,{recursive:true,force:true})}
});
