import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createSetupCallbackGateway,callbackGatewayAddress} from './setup-callback-gateway.mjs';
const close=server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
const listen=(server,port=0)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server.address().port));});
function request(port,path,{method='GET',body=Buffer.alloc(0),headers={}}={}){return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path,method,headers},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(body);});}
test('provider account-id return redirects locally without using it as connection authority',async()=>{
 const gateway=createSetupCallbackGateway();const port=await listen(gateway);
 try{
  for(const outcome of ['returned','failed']){
   const result=await request(port,'/setup/'+outcome+'?account_id=synthetic-provider-account_123');
   assert.equal(result.status,303);assert.equal(result.headers.location,'http://acquire-agent.orb.local/settings?setup='+outcome);
   assert.equal(result.headers['referrer-policy'],'no-referrer');
   assert.equal(result.body.includes('synthetic-provider-account'),false);
  }
  for(const query of ['account_id=','account_id=one&account_id=two','account_id=one&next=https://evil.invalid','account_id='+ 'x'.repeat(2049),'account_id=%0d%0aLocation%3Aevil','%61ccount_id=one','account_id=one%26next%3Devil']){
   assert.equal((await request(port,'/setup/returned?'+query)).status,404,query);
  }
 }finally{await close(gateway);}
});
test('gateway exposes only capability callback and fixed return routes',async()=>{
 const received=[];let mode='ok';const upstream=http.createServer((req,res)=>{const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{received.push({method:req.method,url:req.url,headers:req.headers,body:Buffer.concat(chunks)});if(mode==='hang')return;if(mode==='large'){res.end('x'.repeat(9000));return;}if(mode==='fail'){res.statusCode=500;res.end('private provider diagnostic');return;}res.setHeader('Set-Cookie','must-not-leak=private');res.end('{"status":"queued"}');});});
 const upstreamPort=await listen(upstream);
 // Keep the production destination policy fixed while the injected transport
 // routes this suite only to its own ephemeral loopback fixture.
 const fixtureRequest=(url,options,callback)=>{const target=new URL(url);assert.equal(target.origin,'http://127.0.0.1:5461');target.port=String(upstreamPort);return http.request(target,options,callback);};
 const gateway=createSetupCallbackGateway({maxBodyBytes:64,timeoutMs:100,request:fixtureRequest});const port=await listen(gateway);
 try{
  const bytes=Buffer.from('{ "name" : "opaque", "octet":"é" }\n');
  let result=await request(port,'/v1/setup/notify?capability=synthetic._-cap',{method:'POST',body:bytes,headers:{'Content-Type':'application/json','Authorization':'Bearer do-not-forward','Cookie':'private-cookie'}});
  assert.equal(result.status,200);assert.equal(received.length,1);assert.equal(received[0].url,'/v1/setup/notify?capability=synthetic._-cap');assert.deepEqual(received[0].body,bytes);assert.equal(received[0].headers.authorization,undefined);assert.equal(received[0].headers.cookie,undefined);assert.equal(result.headers['set-cookie'],undefined);
  for(const path of ['/v1/connections/list','/api/internal/agent/tick','/v1/setup/notify','/v1/setup/notify?capability=','/v1/setup/notify?capability=one&capability=two','/v1/setup/notify?capability=valid&redirect=evil','/v1/setup/notify?capability='+ 'x'.repeat(129),'/v1/setup/notify?%63apability=opaque','http://evil.invalid/v1/setup/notify?capability=opaque']){result=await request(port,path,{method:'POST',body:Buffer.from('{}')});assert.ok([400,404].includes(result.status),path);}
  assert.equal((await request(port,'/v1/setup/notify?capability=synthetic')).status,404);assert.equal(received.length,1);
  for(const outcome of ['returned','failed']){result=await request(port,'/setup/'+outcome);assert.equal(result.status,303);assert.equal(result.headers.location,'http://acquire-agent.orb.local/settings?setup='+outcome);}
  assert.equal((await request(port,'/setup/returned?next=https://evil.invalid')).status,404);assert.equal((await request(port,'/health?secret=anything')).status,404);assert.equal((await request(port,'/health')).body,'{"status":"ok"}');
  result=await request(port,'/v1/setup/notify?capability=synthetic',{method:'POST',body:Buffer.alloc(65),headers:{'Content-Type':'application/json'}});assert.equal(result.status,413);assert.equal(received.length,1);
  result=await request(port,'/v1/setup/notify?capability=synthetic',{method:'POST',body:Buffer.from('{}'),headers:{'Content-Type':'text/plain'}});assert.equal(result.status,415);assert.equal(received.length,1);
  const streamed=(chunk,end=true)=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port,path:'/v1/setup/notify?capability=synthetic',method:'POST',headers:{'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.write(chunk);if(end)req.end();});
  assert.equal(await streamed(Buffer.alloc(65)),413);assert.equal(received.length,1);
  assert.equal(await streamed(Buffer.from('{'),false),504);assert.equal(received.length,1);
  mode='fail';result=await request(port,'/v1/setup/notify?capability=synthetic',{method:'POST',body:Buffer.from('{}'),headers:{'Content-Type':'application/json'}});assert.equal(result.status,503);assert.ok(!result.body.includes('private'));
  mode='large';result=await request(port,'/v1/setup/notify?capability=synthetic',{method:'POST',body:Buffer.from('{}'),headers:{'Content-Type':'application/json'}});assert.equal(result.status,502);
  mode='hang';result=await request(port,'/v1/setup/notify?capability=synthetic',{method:'POST',body:Buffer.from('{}'),headers:{'Content-Type':'application/json'}});assert.equal(result.status,504);
  await close(upstream);result=await request(port,'/v1/setup/notify?capability=synthetic',{method:'POST',body:Buffer.from('{}'),headers:{'Content-Type':'application/json'}});assert.equal(result.status,503);
 }finally{await close(gateway);await close(upstream);}
});
test('configuration cannot expose another service or bind arbitrary hosts',()=>{
 for(const serviceUrl of ['https://127.0.0.1:5461','http://localhost:5461','http://127.0.0.1:3000','http://127.0.0.1:5461/','http://127.0.0.1:5461@evil.invalid','http://127.0.0.1:5461?secret=x'])assert.throws(()=>createSetupCallbackGateway({serviceUrl}));
 assert.deepEqual(callbackGatewayAddress({}),{host:'127.0.0.1',port:5462});assert.deepEqual(callbackGatewayAddress({AGENT_SETUP_GATEWAY_HOST:'0.0.0.0'}),{host:'0.0.0.0',port:5462});assert.throws(()=>callbackGatewayAddress({AGENT_SETUP_GATEWAY_HOST:'public.invalid'}));assert.throws(()=>createSetupCallbackGateway({maxBodyBytes:2000000}));assert.throws(()=>createSetupCallbackGateway({request:null}));
});
