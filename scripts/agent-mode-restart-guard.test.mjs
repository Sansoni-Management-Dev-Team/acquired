import{test}from'node:test';import assert from'node:assert/strict';import{assertAgentModeRestartIdle}from'./agent-mode-restart-guard.mjs';
const idle={database:'acquire_agent_mode',marker:'acquire-agent-mode-local-only',runningOperations:0,runningRuns:0};
test('restart admits only exact marked zero-running state',()=>{assert.doesNotThrow(()=>assertAgentModeRestartIdle(idle));for(const value of [null,{...idle,database:'other'},{...idle,marker:null},{...idle,runningOperations:1},{...idle,runningRuns:1},{...idle,runningOperations:'0'}])assert.throws(()=>assertAgentModeRestartIdle(value));});
