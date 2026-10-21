import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {createSimulatorGateway,simulatorBridgeAddress} from './simulator-transports.mjs';
test('fixed bridge addresses reject arbitrary destinations and non-simulator startup',()=>{
 assert.deepEqual(simulatorBridgeAddress({AGENT_MODE_COMMUNICATIONS_MODE:'simulator'}),{providerPort:5490,callbackPort:5491,servicePort:5461});
 for(const mode of [undefined,'connect-only','production'])assert.throws(()=>simulatorBridgeAddress({AGENT_MODE_COMMUNICATIONS_MODE:mode}));
});
test('bounded gateway forwards authenticated service bytes and preserves rejection; blocks arbitrary paths',async()=>{
 const observed=[];const upstream=createServer((req,res)=>{let text='';req.on('data',b=>text+=b);req.on('end',()=>{observed.push({url:req.url,auth:req.headers['unipile-auth'],text});res.writeHead(401,{'content-type':'application/json'}).end('{"error":"rejected"}');});});
 await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
 const gateway=createSimulatorGateway({servicePort:upstream.address().port,maxBodyBytes:16});await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
 const call=(path,body='{}',method='POST')=>new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:gateway.address().port,path,method,headers:{'content-type':'application/json','unipile-auth':'synthetic-secret','content-length':Buffer.byteLength(body)}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,text,location:res.headers.location,contract:res.headers['x-communications-contract-version']}));});req.on('error',reject);req.end(body);});
 try{
  const rejected=await call('/v1/webhook');assert.equal(rejected.status,401);assert.equal(rejected.contract,undefined);assert.deepEqual(observed,[{url:'/v1/webhook',auth:'synthetic-secret',text:'{}'}]);
  assert.equal((await call('/v1/setup/notify?capability=abc_123')).status,401);
  assert.equal((await call('/v1/webhook','x'.repeat(17))).status,413);
  for(const path of ['/api/channels/connections','/v1/webhook?target=remote','http://attacker.test/','/v1/setup/notify?capability=x&target=remote'])assert.equal((await call(path)).status,404);
  const returned=await call('/setup/returned','','GET');assert.equal(returned.status,303);assert.equal(returned.location,'http://acquire-agent.orb.local/settings?setup=returned');
  assert.equal(observed.length,2);
 }finally{gateway.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise(r=>gateway.close(r)),new Promise(r=>upstream.close(r))]);}
});

test('25lead bridge uses its separate fixed pair and refuses unknown profiles',()=>{
 assert.deepEqual(simulatorBridgeAddress({AGENT_MODE_COMMUNICATIONS_MODE:'simulator',AGENT_MODE_COMMUNICATIONS_PROFILE:'simulator25'}),{providerPort:5590,callbackPort:5591,servicePort:5461});
 assert.throws(()=>simulatorBridgeAddress({AGENT_MODE_COMMUNICATIONS_MODE:'simulator',AGENT_MODE_COMMUNICATIONS_PROFILE:'arbitrary'}));
});
test('50lead bridge has a separate fixed pair without changing25lead transport',()=>{
 assert.deepEqual(simulatorBridgeAddress({AGENT_MODE_COMMUNICATIONS_MODE:'simulator',AGENT_MODE_COMMUNICATIONS_PROFILE:'simulator50'}),{providerPort:5690,callbackPort:5691,servicePort:5461});
});
test('multichannel bridge uses only fixed5790/5791 pair',()=>{assert.deepEqual(simulatorBridgeAddress({AGENT_MODE_COMMUNICATIONS_MODE:'simulator',AGENT_MODE_COMMUNICATIONS_PROFILE:'multichannel'}),{providerPort:5790,callbackPort:5791,servicePort:5461});});
test('dedicated demo transport has separate fixed provider callback and internal service ports',()=>{
 assert.deepEqual(simulatorBridgeAddress({AGENT_MODE_COMMUNICATIONS_MODE:'simulator',AGENT_MODE_COMMUNICATIONS_PROFILE:'demos',NODE_ENV:'development'}),{providerPort:5890,callbackPort:5891,servicePort:5463,hostProviderPort:5893});
});
