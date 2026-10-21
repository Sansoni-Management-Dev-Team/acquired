import test from 'node:test';import assert from 'node:assert/strict';
import {buildAgentWorkerEnvironment} from './agent-mode-worker-env.mjs';
const id='e7da3f8c-8c45-4aef-bac4-392b918e0025';
const app={DATABASE_URL:'postgresql://synthetic:ignored@postgres:5432/acquire_agent_mode',COMMUNICATIONS_DATABASE_URL:'postgresql://synthetic:ignored@postgres:5432/acquire_agent_mode',NODE_ENV:'development',AGENT_MODE_COMMUNICATIONS_MODE:'simulator',COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:'https://127.0.0.1:5590',AGENT_NATIVE_EXECUTION_ENABLED:'false'};
test('simulator startup stays disabled and requires server scope before activation',()=>{
 assert.equal(buildAgentWorkerEnvironment(app,{}, {},'simulator25').AGENT_NATIVE_EXECUTION_ENABLED,'false');
 assert.throws(()=>buildAgentWorkerEnvironment(app,{}, {AGENT_NATIVE_EXECUTION_ENABLED:'true'},'simulator25'),/scope/);
 const out=buildAgentWorkerEnvironment(app,{}, {AGENT_NATIVE_EXECUTION_ENABLED:'true',AGENT_WORKER_MANDATE_ID:id},'simulator25');assert.equal(out.AGENT_NATIVE_EXECUTION_ENABLED,'true');assert.equal(out.AGENT_WORKER_REQUIRE_MANDATE_SCOPE,'true');assert.equal(out.AGENT_WORKER_MANDATE_ID,id);
});
test('ordinary restart retains exact explicit selection and can disable it',()=>{
 const saved={AGENT_NATIVE_EXECUTION_ENABLED:'true',AGENT_WORKER_MANDATE_ID:id,AGENT_MODE_SIMULATOR_TEST_POLICY:'true'};
 assert.equal(buildAgentWorkerEnvironment(app,saved,{},'simulator25').AGENT_MODE_SIMULATOR_TEST_POLICY,'true');
 assert.equal(buildAgentWorkerEnvironment(app,saved,{AGENT_NATIVE_EXECUTION_ENABLED:'false'},'simulator25').AGENT_NATIVE_EXECUTION_ENABLED,'false');
});
test('mailbox restoration always disables native execution and accelerated policy',()=>{
 const out=buildAgentWorkerEnvironment(app,{AGENT_NATIVE_EXECUTION_ENABLED:'true',AGENT_WORKER_MANDATE_ID:id,AGENT_MODE_SIMULATOR_TEST_POLICY:'true'}, {},'mailbox');assert.equal(out.AGENT_NATIVE_EXECUTION_ENABLED,'false');assert.equal(out.AGENT_MODE_SIMULATOR_TEST_POLICY,'false');
});
test('rejects arbitrary origins, malformed scopes, implicit production and wrong accelerated scope',()=>{
 for(const patch of [{NODE_ENV:'production'},{COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:'https://external.example'},{COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:'https://127.0.0.1:5490'}])assert.throws(()=>buildAgentWorkerEnvironment({...app,...patch},{},{},'simulator25'));
 for(const patch of [{AGENT_WORKER_MANDATE_ID:''},{AGENT_WORKER_MANDATE_ID:'not-uuid'},{AGENT_NATIVE_EXECUTION_ENABLED:'yes'},{AGENT_MODE_SIMULATOR_TEST_POLICY:'yes'},{AGENT_MODE_SIMULATOR_TEST_POLICY:'true',AGENT_WORKER_MANDATE_ID:'00000000-0000-4000-8000-000000000001'}])assert.throws(()=>buildAgentWorkerEnvironment(app,{},patch,'simulator25'));
});
test('permits the separate exact isolated pilot scope without arbitrary scope expansion',()=>{
 const newId='e7da3f8c-8c45-4aef-bac4-392b918e0026';
 const out=buildAgentWorkerEnvironment(app,{}, {AGENT_NATIVE_EXECUTION_ENABLED:'true',AGENT_WORKER_MANDATE_ID:newId,AGENT_MODE_SIMULATOR_TEST_POLICY:'true'},'simulator25');assert.equal(out.AGENT_WORKER_MANDATE_ID,newId);
 assert.throws(()=>buildAgentWorkerEnvironment(app,{}, {AGENT_NATIVE_EXECUTION_ENABLED:'true',AGENT_WORKER_MANDATE_ID:'e7da3f8c-8c45-4aef-bac4-392b918e0027',AGENT_MODE_SIMULATOR_TEST_POLICY:'true'},'simulator25'));
});
test('50lead worker retains its exact separate mandate and refuses25scope',()=>{
 const fifty={...app,COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:'https://127.0.0.1:5690'},controls={AGENT_NATIVE_EXECUTION_ENABLED:'true',AGENT_WORKER_MANDATE_ID:'e7da3f8c-8c45-4aef-bac4-392b918e0050',AGENT_MODE_SIMULATOR_TEST_POLICY:'true'};
 assert.equal(buildAgentWorkerEnvironment(fifty,{},controls,'simulator50').AGENT_WORKER_MANDATE_ID,controls.AGENT_WORKER_MANDATE_ID);
 assert.throws(()=>buildAgentWorkerEnvironment(fifty,{}, {...controls,AGENT_WORKER_MANDATE_ID:id},'simulator50'));
 assert.throws(()=>buildAgentWorkerEnvironment(app,{},controls,'simulator25'));
});
test('registered multichannel lane never inherits pilot activation or its global mandate',()=>{
 const appMulti={...app,COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:'https://127.0.0.1:5790',AGENT_WORKER_MANDATE_ID:id};
 const out=buildAgentWorkerEnvironment(appMulti,{AGENT_NATIVE_EXECUTION_ENABLED:'true',AGENT_WORKER_MANDATE_ID:id,AGENT_WORKER_SCOPE_MODE:'exact'},{},'multichannel');
 assert.equal(out.AGENT_NATIVE_EXECUTION_ENABLED,'false');assert.equal(out.AGENT_WORKER_SCOPE_MODE,'registered');assert.equal(out.AGENT_WORKER_RUNTIME_ID,'agent-multichannel-20261017');assert.equal(out.AGENT_WORKER_REQUIRE_MANDATE_SCOPE,'true');assert.equal(Object.hasOwn(out,'AGENT_WORKER_MANDATE_ID'),false);
 const enabled=buildAgentWorkerEnvironment(appMulti,{}, {AGENT_NATIVE_EXECUTION_ENABLED:'true',AGENT_MODE_SIMULATOR_TEST_POLICY:'true'},'multichannel');assert.equal(enabled.AGENT_NATIVE_EXECUTION_ENABLED,'true');
 assert.throws(()=>buildAgentWorkerEnvironment(appMulti,{}, {AGENT_WORKER_MANDATE_ID:id},'multichannel'));
});

test('registered startup rejects conflicting explicit lane identities',()=>{const multi={...app,COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:'https://127.0.0.1:5790'};for(const patch of [{AGENT_WORKER_SCOPE_MODE:'exact'},{AGENT_WORKER_RUNTIME_ID:'arbitrary'}])assert.throws(()=>buildAgentWorkerEnvironment(multi,{},patch,'multichannel'));});

test('registered lane refuses any other database before activation',()=>{const multi={...app,COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:'https://127.0.0.1:5790'};for(const key of ['DATABASE_URL','COMMUNICATIONS_DATABASE_URL'])for(const value of [undefined,'postgresql://synthetic:ignored@postgres:5432/shared','postgresql://synthetic:ignored@127.0.0.1:5432/acquire_agent_mode'])assert.throws(()=>buildAgentWorkerEnvironment({...multi,[key]:value},{},{AGENT_NATIVE_EXECUTION_ENABLED:'true'},'multichannel'));});
