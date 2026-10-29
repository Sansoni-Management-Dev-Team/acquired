import {test} from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../src/config.mjs';
const env={RESEARCH_DATABASE_URL:'postgresql://research:password@database:5432/acquire_research_local',RESEARCH_SERVICE_SECRET:'x'.repeat(32),RESEARCH_APP_ORIGIN:'http://127.0.0.1:3100'};
test('standalone local config cannot target production callbacks or application databases',()=>{
  const result=config(env);
  assert.equal(result.APP_ORIGIN,env.RESEARCH_APP_ORIGIN);
  assert.equal(result.LOCAL_DEVELOPMENT,'true');
  assert.throws(()=>config({...env,RESEARCH_APP_ORIGIN:'https://acquire.mlai.au'}));
  assert.throws(()=>config({...env,RESEARCH_DATABASE_URL:'postgresql://a:b@host:5432/postgres'}));
  assert.throws(()=>config({...env,RESEARCH_SERVICE_SECRET:''}));
});

test('local Bing is explicit and model configuration reaches the worker',()=>{
 const result=config({...env,LOCAL_SEARCH_ENGINE:'bing',OPENAI_RESEARCH_MODEL:'configured-model'});
 assert.equal(result.LOCAL_SEARCH_ENGINE,'bing');assert.equal(result.OPENAI_RESEARCH_MODEL,'configured-model');
 assert.throws(()=>config({...env,LOCAL_SEARCH_ENGINE:'unknown'}));
});

test('explicit Tavily configuration requires credentials and refuses unknown providers',()=>{
 assert.throws(()=>config({...env,RESEARCH_SEARCH_PROVIDER:'tavily'}),/API key/);
 assert.throws(()=>config({...env,RESEARCH_READER_PROVIDER:'unknown'}),/Unsupported/);
 const result=config({...env,RESEARCH_SEARCH_PROVIDER:'tavily',RESEARCH_READER_PROVIDER:'tavily',TAVILY_API_KEY:'private'});assert.equal(result.RESEARCH_SEARCH_PROVIDER,'tavily');assert.equal(result.RESEARCH_READER_PROVIDER,'tavily');
});

test('hosted test profile has its own database identity and retains isolated callbacks',()=>{
 const hosted={...env,RESEARCH_DEPLOYMENT:'digitalocean-test',RESEARCH_DATABASE_URL:'postgresql://research:password@database:5432/acquire_research_do_test'};
 const result=config(hosted);
 assert.equal(result.databaseName,'acquire_research_do_test');
 assert.equal(result.LOCAL_SEARCH_REGION,'AU');
 assert.equal(result.databaseMarker,'acquire-research-do-test-only');
 assert.equal(config(env).databaseMarker,'acquire-research-local-only');
 assert.throws(()=>config({...hosted,RESEARCH_DATABASE_URL:env.RESEARCH_DATABASE_URL}));
 assert.throws(()=>config({...env,RESEARCH_DATABASE_URL:hosted.RESEARCH_DATABASE_URL}));
 assert.throws(()=>config({...hosted,RESEARCH_APP_ORIGIN:'https://acquire.mlai.au'}));
 assert.throws(()=>config({...hosted,RESEARCH_DATABASE_URL:'postgresql://research:password@remote-db:5432/acquire_research_do_test'}));
 assert.throws(()=>config({...hosted,RESEARCH_DEPLOYMENT:'production'}));
});

test('explicit hosted production mode reuses the existing dedicated research store and retains the loopback callback relay',()=>{
 const hosted={...env,RESEARCH_DEPLOYMENT:'digitalocean-production',RESEARCH_DATABASE_URL:'postgresql://research:password@database:5432/acquire_research_do_test'};
 const result=config(hosted);
 assert.equal(result.APP_ORIGIN,'http://127.0.0.1:3100');
 assert.equal(result.databaseName,'acquire_research_do_test');
 assert.equal(result.databaseMarker,'acquire-research-do-test-only');
 for(const origin of ['https://acquire.mlai.au','http://acquire.mlai.au','https://other.example','https://acquire.mlai.au/path','https://acquire.mlai.au/?token=private','https://private@acquire.mlai.au'])assert.throws(()=>config({...hosted,RESEARCH_APP_ORIGIN:origin}));
 assert.throws(()=>config({...hosted,RESEARCH_DATABASE_URL:env.RESEARCH_DATABASE_URL}));
 assert.throws(()=>config({...env,RESEARCH_APP_ORIGIN:'https://acquire.mlai.au'}));
});
