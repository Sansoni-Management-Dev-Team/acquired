export function agentDatabaseConfig(surface?:'host'|'container'):{
 port:5437;database:'acquire_agent_mode';marker:'acquire-agent-mode-local-only';url:string;
};
export function assertAgentDatabaseIdentity(identity:{database:unknown;marker:unknown}):void;
export const pilotTableNames:string[];
export function sanitisePilotRow(table:string,source:Record<string,unknown>):Record<string,unknown>;
