import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAcquireBridge} from '../src/acquire-bridge.mjs';
const workerSecret='worker-secret-'.padEnd(40,'w'),appSecret='app-secret-'.padEnd(40,'a');
const id='11111111-1111-4111-8111-111111111111';
async function setup(t,fetcher){const server=createAcquireBridge({workerSecret,appSecret,appOrigin:'http://host.docker.internal:3027',fetcher});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));return`http://127.0.0.1:${server.address().port}`}
const headers=secret=>({authorization:`Bearer ${secret}`,'content-type':'application/json'});
test('isolated app dispatch is forwarded with the worker secret and exact input',async t=>{
 const calls=[];const origin=await setup(t,async(url,options)=>{calls.push({url,options});return Response.json({id},{status:202})});
 const body=JSON.stringify({action:'recover-stalled'});
 const response=await fetch(`${origin}/jobs/${id}`,{method:'POST',headers:{...headers(appSecret),'x-research-job-id':id,cookie:'private-session','x-acquire-native-research-job':id},body});
 assert.equal(response.status,202);assert.equal(calls[0].url,`http://127.0.0.1:8787/jobs/${id}`);assert.equal(calls[0].options.headers.get('authorization'),`Bearer ${workerSecret}`);assert.equal(calls[0].options.headers.get('cookie'),null);assert.equal(calls[0].options.headers.get('x-acquire-native-research-job'),id);assert.equal(calls[0].options.body.toString(),body);
});
test('worker callbacks reach the isolated app with its secret and lean query preserved',async t=>{
 const calls=[];const origin=await setup(t,async(url,options)=>{calls.push({url,options});return Response.json({status:'running'})});
 const response=await fetch(`${origin}/api/research/internal/${id}?control=1`,{headers:headers(workerSecret)});
 assert.equal(response.status,200);assert.equal(calls[0].url,`http://host.docker.internal:3027/api/research/internal/${id}?control=1`);assert.equal(calls[0].options.headers.get('authorization'),`Bearer ${appSecret}`);assert.equal(calls[0].options.redirect,'manual');
});
test('wrong credentials, unsupported paths and foreign browser origins make no upstream requests',async t=>{
 let calls=0;const origin=await setup(t,async()=>{calls++;return Response.json({})});
 assert.equal((await fetch(`${origin}/jobs/${id}`,{headers:headers(workerSecret)})).status,401);
 assert.equal((await fetch(`${origin}/api/research/internal/${id}`,{headers:headers(appSecret)})).status,401);
 assert.equal((await fetch(`${origin}/test/runs`,{headers:headers(appSecret)})).status,404);
 assert.equal((await fetch(`${origin}/jobs/${id}`,{headers:{...headers(appSecret),origin:'https://other.example'}})).status,403);
 assert.equal(calls,0);
});
test('redirects and transport failures cannot leak auth to another destination',async t=>{
 let calls=0;const origin=await setup(t,async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://acquire.mlai.au/'}})});
 assert.equal((await fetch(`${origin}/jobs/${id}`,{headers:headers(appSecret)})).status,502);assert.equal(calls,1);
});
test('existing isolated maintenance retains ownership and synthetic job endpoints are absent',async t=>{
 let calls=0;const origin=await setup(t,async()=>{calls++;return Response.json({})});
 const response=await fetch(`${origin}/api/research/internal/background`,{method:'POST',headers:headers(workerSecret),body:'{}'});
 assert.equal(response.status,200);assert.equal((await response.json()).forwarded,false);assert.equal(calls,0);
});
test('only the known isolated callback origin can be configured',()=>{
 assert.throws(()=>createAcquireBridge({workerSecret,appSecret,appOrigin:'https://acquire.mlai.au'}),/isolated/);
 assert.throws(()=>createAcquireBridge({workerSecret:'',appSecret,appOrigin:'http://host.docker.internal:3027'}),/secret/i);
});
test('mirror callbacks use the mirror app and enforce its matching browser origin',async t=>{
 const calls=[];
 const server=createAcquireBridge({workerSecret,appSecret,appOrigin:'http://host.docker.internal:3032',appSite:'https://acquire-research.orb.local',fetcher:async(url,options)=>{calls.push({url,options});return Response.json({ok:true})}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
 const origin=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(`${origin}/api/research/internal/${id}`,{headers:headers(workerSecret)})).status,200);
 assert.equal(calls[0].url,`http://host.docker.internal:3032/api/research/internal/${id}`);
 assert.equal((await fetch(`${origin}/jobs/${id}`,{headers:{...headers(appSecret),origin:'https://acquire-isolated.orb.local'}})).status,403);
 assert.equal((await fetch(`${origin}/jobs/${id}`,{headers:{...headers(appSecret),origin:'https://acquire-research.orb.local'}})).status,200);
 assert.equal(calls.length,2);
 assert.throws(()=>createAcquireBridge({workerSecret,appSecret,appOrigin:'http://host.docker.internal:3032'}),/isolated|matching/i);
});
test('Firmable service paths translate their separate app credential and preserve request context',async t=>{
 const calls=[];const server=createAcquireBridge({workerSecret,appSecret,appFirmableSecret:'firmable-app-secret',fetcher:async(url,options)=>{calls.push({url,options});return Response.json({configured:false})}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
 const origin=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(`${origin}/firmable/status`,{headers:headers(appSecret)})).status,401);
 const response=await fetch(`${origin}/firmable/company/search`,{method:'POST',headers:{...headers('firmable-app-secret'),'x-acquire-native-research-job':id},body:JSON.stringify({query:'aged care software'})});
 assert.equal(response.status,200);assert.equal(calls[0].url,'http://127.0.0.1:8787/firmable/company/search');assert.equal(calls[0].options.headers.get('authorization'),`Bearer ${workerSecret}`);
 assert.equal(calls[0].options.headers.get('x-acquire-native-research-job'),id);
 assert.equal((await fetch(`${origin}/firmable/company/search`,{headers:headers('firmable-app-secret')})).status,405);
 assert.equal((await fetch(`${origin}/firmable/arbitrary`,{headers:headers('firmable-app-secret')})).status,404);
});
test('explicit production relay pins Acquire HTTPS and forwards authenticated maintenance callbacks',async t=>{
 const calls=[];const server=createAcquireBridge({workerSecret,appSecret,production:true,appOrigin:'https://acquire.mlai.au',appSite:'https://acquire.mlai.au',fetcher:async(url,options)=>{calls.push({url,options});return Response.json({ok:true})}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
 const origin=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(`${origin}/api/research/internal/${id}?control=1`,{headers:headers(workerSecret)})).status,200);
 assert.equal((await fetch(`${origin}/api/research/internal/background`,{method:'POST',headers:headers(workerSecret),body:'{}'})).status,200);
 assert.equal(calls[0].url,`https://acquire.mlai.au/api/research/internal/${id}?control=1`);
 assert.equal(calls[1].url,'https://acquire.mlai.au/api/research/internal/background');
 assert.equal(calls[0].options.headers.get('authorization'),`Bearer ${appSecret}`);
 for(const appOrigin of ['http://acquire.mlai.au','https://other.example','https://acquire.mlai.au/path','https://private@acquire.mlai.au'])assert.throws(()=>createAcquireBridge({workerSecret,appSecret,production:true,appOrigin,appSite:'https://acquire.mlai.au'}));
 assert.throws(()=>createAcquireBridge({workerSecret,appSecret,appOrigin:'https://acquire.mlai.au',appSite:'https://acquire.mlai.au'}));
});
