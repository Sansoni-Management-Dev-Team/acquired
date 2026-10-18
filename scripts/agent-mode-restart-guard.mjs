/** Read-only restart fence. No expired operation is assumed harmless here. */
export function assertAgentModeRestartIdle(value){
 if(value?.database!=='acquire_agent_mode'||value.marker!=='acquire-agent-mode-local-only'||value.runningOperations!==0||value.runningRuns!==0)throw Error('Agent restart requires the marked local database and zero running operations/runs; worker remains stopped.');
}
