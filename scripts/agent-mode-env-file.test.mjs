import test from 'node:test';import assert from 'node:assert/strict';import {parseEnv} from 'node:util';
import {serializeAgentEnvironment} from './agent-mode-env-file.mjs';
test('roundtrips keyring JSON, empty/base64/research secrets and dollar signs without Compose interpolation',()=>{
 const values={COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:'v1',encryptionKey:Buffer.alloc(32,1).toString('base64'),digestKey:Buffer.alloc(32,2).toString('base64')}]),EMPTY:'',B64:Buffer.alloc(32,3).toString('base64'),OPENAI_API_KEY:'synthetic-key-1_A',OPENROUTER_API_KEY:'synthetic $credential ${DO_NOT_EXPAND}',LITERAL:'has "quotes", backslash \\ and # hash = equals'};
 const output=serializeAgentEnvironment(values);assert.deepEqual(parseEnv(output),values);assert.deepEqual(JSON.parse(parseEnv(output).COMMUNICATIONS_KEYRING_JSON),JSON.parse(values.COMMUNICATIONS_KEYRING_JSON));
 assert.ok(output.includes("OPENROUTER_API_KEY='synthetic $credential ${DO_NOT_EXPAND}'"));assert.equal(output.endsWith('\n'),true);
});
test('supports an apostrophe only in safe double quoted values; rejects ambiguous combined quoting and expansion',()=>{
 assert.deepEqual(parseEnv(serializeAgentEnvironment({NAME:"O'Brien"})),{NAME:"O'Brien"});
 for(const value of ["O'Brien $TOKEN","O'Brien ${TOKEN}","O'Brien \\path","O'Brien \"quoted\""])assert.throws(()=>serializeAgentEnvironment({TOKEN:value}),/environment/);
});
test('rejects line injection, invalid variable names and non-string values without revealing payloads',()=>{
 for(const value of ['synthetic-secret\nOTHER=on','synthetic-secret\rOTHER=on','synthetic-secret\0payload',123,undefined,null])assert.throws(()=>serializeAgentEnvironment({TOKEN:value}),error=>error.message==='Invalid local agent environment values');
 for(const name of ['BAD-NAME','OTHER=on',' export KEY','1KEY','KEY\nOTHER'])assert.throws(()=>serializeAgentEnvironment({[name]:'synthetic-secret'}),/environment/);
 assert.equal(serializeAgentEnvironment({}),'');
});
test('never executes getters or proxies while serializing private configuration',()=>{
 let read=false;const values={};Object.defineProperty(values,'TOKEN',{get(){read=true;return 'synthetic-secret';},enumerable:true});assert.throws(()=>serializeAgentEnvironment(values));assert.equal(read,false);assert.throws(()=>serializeAgentEnvironment(new Proxy({TOKEN:'synthetic-secret'},{})));
});
