import test from 'node:test';
import assert from 'node:assert/strict';
import {firmableReconnectCredentials, firmableReconnectInvocation, reconnectFirmableAccount} from './reconnect-agent-mode-firmable.mjs';
const cookie='synthetic-client-cookie-value',organization='org_local',session='sess_local';
const credentials={cookie,sessionId:session,organizationId:organization};
test('accepts a private bootstrap config or Cookie export and rejects a different organization',()=>{
 assert.deepEqual(firmableReconnectCredentials({FIRMABLE_CLIENT_COOKIE:cookie,FIRMABLE_SESSION_ID:session,FIRMABLE_ORGANIZATION_ID:organization},organization),credentials);
 assert.deepEqual(firmableReconnectCredentials({cookies:[{domain:'.clerk.firmable.com',name:'__client',value:cookie},{domain:'app.firmable.com',name:'clerk_active_context',value:session+':'+organization}]},organization),credentials);
 assert.throws(()=>firmableReconnectCredentials({...credentials,organizationId:'org_other'},organization),/organization/);
 assert.throws(()=>firmableReconnectCredentials({cookies:[{domain:'other.invalid',name:'__client',value:cookie}]},organization),error=>!error.message.includes(cookie));
});
test('puts credentials and service secret only on stdin, never docker arguments',()=>{
 const request=firmableReconnectInvocation('/reconnect',credentials,'synthetic-service-secret');
 assert.equal(request.args.includes('project-acquire-agent-mode'),true);
 assert.equal(JSON.stringify(request.args).includes(cookie),false);
 assert.equal(JSON.stringify(request.args).includes('synthetic-service-secret'),false);
 assert.deepEqual(JSON.parse(request.input),{path:'/reconnect',credentials,secret:'synthetic-service-secret'});
 assert.throws(()=>firmableReconnectInvocation('/company',credentials,'secret'),/reconnect or status/);
});
test('renews through the existing service, persists only after acceptance, and verifies local status without company or People calls',async()=>{
 const calls=[];let persisted=false;
 const result=await reconnectFirmableAccount({credentials,invoke:async(path,body)=>{calls.push([path,body]);return path==='/reconnect'?{status:200,body:{connected:true}}:{status:200,body:{configured:true,reconnectRequired:false}};},persist:async value=>{assert.deepEqual(value,credentials);persisted=true;}});
 assert.deepEqual(calls.map(c=>c[0]),['/reconnect','/status']);assert.equal(persisted,true);assert.deepEqual(result,{connected:true,statusVerified:true});
});
test('keeps private bootstrap credentials unchanged on rejected renewal, with no automatic retry',async()=>{
 let calls=0,persisted=false;
 await assert.rejects(()=>reconnectFirmableAccount({credentials,invoke:async()=>{calls++;return{status:401,body:{category:'upstream_authentication',private:cookie}};},persist:async()=>{persisted=true;}}),error=>error.message==='Firmable reconnect failed (401, upstream_authentication); existing connection retained');
 assert.equal(calls,1);assert.equal(persisted,false);
});
test('does not claim a completed rotation after an uncertain response or a failed local status readback',async()=>{
 let persisted=false;
 for(const status of[0,502,200])await assert.rejects(()=>reconnectFirmableAccount({credentials,invoke:async()=>({status,body:{category:'outcome_unknown'}}),persist:async()=>{persisted=true;}}),/outcome unknown/);assert.equal(persisted,false);
 const result=await reconnectFirmableAccount({credentials,invoke:async path=>path==='/reconnect'?{status:200,body:{connected:true}}:{status:503,body:{}},persist:async()=>{persisted=true;}});assert.deepEqual(result,{connected:true,statusVerified:false});assert.equal(persisted,true);
});
