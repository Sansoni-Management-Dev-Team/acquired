import {test} from 'node:test';
import assert from 'node:assert/strict';
import {appEnvironment} from './aws-dev-environment.mjs';
const secret={ACQUIRE_DATABASE_USERNAME:'user',ACQUIRE_DATABASE_PASSWORD:'a@:#password',ACQUIRE_DATABASE_HOST:'private.rds.amazonaws.com',ACQUIRE_BETTER_AUTH_SECRET:'auth-private',RESEARCH_SERVICE_SECRET:'research-private-'.padEnd(40,'x')};
test('UAT remains research-disabled until a private endpoint is configured',()=>{
 const text=appEnvironment(secret);
 assert.ok(text.includes('RESEARCH_ENABLED=false\n'));assert.ok(!text.includes('RESEARCH_WORKER_URL='));
 const result=appEnvironment(secret,{researchEnabled:'true',researchUrl:'http://research.acquire.internal:8787'});
 assert.ok(result.includes('RESEARCH_ENABLED=true\n'));
 const db=new URL(result.split('\n').find(line=>line.startsWith('DATABASE_URL=')).slice(13));
 assert.equal(decodeURIComponent(db.password),secret.ACQUIRE_DATABASE_PASSWORD);
 for(const url of ['https://acquire-research.workers.dev','https://acquire.mlai.au','http://10.126.0.10:18797','http://research.acquire.internal:8787/path'])assert.throws(()=>appEnvironment(secret,{researchEnabled:'true',researchUrl:url}));
 assert.throws(()=>appEnvironment({...secret,RESEARCH_SERVICE_SECRET:''},{researchEnabled:'true',researchUrl:'http://research.acquire.internal:8787'}));
});
test('environment serialization rejects line injection without exposing credential values',()=>{
 const value='sensitive\nINJECTED=true';
 assert.throws(()=>appEnvironment({...secret,OPENAI_API_KEY:value}),error=>!error.message.includes('sensitive')&&/OPENAI_API_KEY/.test(error.message));
});
test('database selection defaults to acquire and honors the configured import database',()=>{
 const database=values=>new URL(appEnvironment(values).split('\n').find(line=>line.startsWith('DATABASE_URL=')).slice(13));
 assert.equal(database(secret).pathname,'/acquire');
 const configured=database({...secret,ACQUIRE_DATABASE_NAME:'acquire_supabase_import_20261030'});
 assert.equal(configured.pathname,'/acquire_supabase_import_20261030');
 assert.equal(configured.hostname,secret.ACQUIRE_DATABASE_HOST);
 assert.equal(decodeURIComponent(configured.password),secret.ACQUIRE_DATABASE_PASSWORD);
});
test('database selection rejects malformed names without exposing supplied values',()=>{
 for(const value of ['',null,123,'acquire/other','acquire?sslmode=disable','acquire\nINJECTED=true','a'.repeat(64)]){
  assert.throws(()=>appEnvironment({...secret,ACQUIRE_DATABASE_NAME:value}),error=>error.message==='Invalid database name');
 }
});
