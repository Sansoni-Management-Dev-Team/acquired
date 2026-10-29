import {test} from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../src/config.mjs';
import {createAcquireBridge} from '../src/acquire-bridge.mjs';

const host='acquire-n8n-develop.cluster-cjaq4yw64sj8.ap-southeast-2.rds.amazonaws.com';
const origin='https://app.acquire.pajamaprofits.net';
const secret='uat-research-secret-'.padEnd(40,'x');
const env={RESEARCH_DEPLOYMENT:'aws-uat',RESEARCH_DATABASE_URL:`postgresql://research:private@${host}:5432/acquire_research_uat`,RESEARCH_APP_ORIGIN:'http://127.0.0.1:3100',RESEARCH_SERVICE_SECRET:secret};

test('AWS UAT pins its own database identity and verifies RDS TLS for every connection',()=>{
  const result=config(env),url=new URL(result.databaseUrl);
  assert.equal(result.databaseName,'acquire_research_uat');
  assert.equal(result.databaseMarker,'acquire-research-aws-uat-only');
  assert.equal(url.searchParams.get('sslmode'),'verify-full');
  assert.equal(url.searchParams.get('sslrootcert'),'/app/rds-ca.pem');
  for(const change of [
    {RESEARCH_DATABASE_URL:env.RESEARCH_DATABASE_URL.replace(host,'remote-db')},
    {RESEARCH_DATABASE_URL:env.RESEARCH_DATABASE_URL.replace('acquire_research_uat','acquire')},
    {RESEARCH_DATABASE_URL:env.RESEARCH_DATABASE_URL+'?sslmode=no-verify'},
    {RESEARCH_DATABASE_URL:env.RESEARCH_DATABASE_URL+'?sslrootcert=/tmp/foreign.pem'},
    {RESEARCH_APP_ORIGIN:origin},
  ])assert.throws(()=>config({...env,...change}));
  assert.throws(()=>config({...env,RESEARCH_DEPLOYMENT:'local'}));
});

test('UAT relay uses only the UAT app and forwards authenticated callbacks and maintenance',async t=>{
  const calls=[];
  const server=createAcquireBridge({workerSecret:secret,appSecret:secret,uat:true,appOrigin:origin,appSite:origin,fetcher:async(url,options)=>{calls.push({url,options});return Response.json({ok:true});}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const local=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(local+'/api/research/internal/background',{method:'POST',headers:{authorization:`Bearer ${secret}`},body:'{}'});
  assert.equal(response.status,200);assert.equal(calls.length,1);
  assert.equal(calls[0].url,origin+'/api/research/internal/background');
  assert.equal(calls[0].options.redirect,'manual');
  for(const foreign of ['https://acquire.mlai.au','http://app.acquire.pajamaprofits.net',origin+'/path'])assert.throws(()=>createAcquireBridge({workerSecret:secret,appSecret:secret,uat:true,appOrigin:foreign,appSite:foreign}));
  assert.throws(()=>createAcquireBridge({workerSecret:secret,appSecret:secret,production:true,uat:true,appOrigin:origin,appSite:origin}));
});
