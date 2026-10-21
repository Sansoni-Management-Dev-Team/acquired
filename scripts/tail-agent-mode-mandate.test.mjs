import test from'node:test';import assert from'node:assert/strict';
import{projectMandateLog}from'./tail-agent-mode-mandate.mjs';
const scope={mandateId:'mandate-a',jobIds:new Set(['job-a']),operationIds:new Set(['operation-a'])};
test('joins existing job-only logs and new mandate-first logs without mixing another mandate',()=>{
 assert.equal(projectMandateLog('research-pipeline '+JSON.stringify({jobId:'job-a',event:'segment_finished',elapsedMs:15}),scope).jobId,'job-a');
 assert.equal(projectMandateLog(JSON.stringify({mandateId:'mandate-a',event:'run_finished',runId:'run-a'}),scope).runId,'run-a');
 assert.equal(projectMandateLog(JSON.stringify({mandateId:'mandate-b',jobId:'job-a'}),scope),null);
 assert.equal(projectMandateLog(JSON.stringify({jobId:'job-b',requestId:'request-a'}),scope),null);
});
test('prints safe telemetry only, omitting bodies, credentials, contact details and malformed rows',()=>{
 const out=projectMandateLog('firmable-account '+JSON.stringify({jobId:'job-a',httpStatus:401,category:'reconnect_required',message:'PRIVATE-body',cookie:'PRIVATE-secret',email:'private@example.com',headers:{authorization:'PRIVATE-secret'}}),scope);
 assert.deepEqual(out,{jobId:'job-a',httpStatus:401,category:'reconnect_required'});assert.equal(projectMandateLog('invalid JSON PRIVATE-body',scope),null);
});
