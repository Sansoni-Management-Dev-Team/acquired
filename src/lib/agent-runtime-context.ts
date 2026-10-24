import{z}from'zod';
import{localSimulatorTestPolicy}from'./agent-simulator-test-policy';
/** Server environment only. This function accepts no mandate, account or client tool input. */
export function configuredAgentRegisteredRuntime(env:Record<string,string|undefined>=process.env){
 if(env.AGENT_WORKER_SCOPE_MODE!=='registered')return null;
 return z.string().regex(/^[a-z][a-z0-9-]{2,99}$/).parse(env.AGENT_WORKER_RUNTIME_ID);
}
export function agentTransactionRuntimeContext(env:Record<string,string|undefined>=process.env){
 const runtimeId=configuredAgentRegisteredRuntime(env);
 const channelSimulation=(runtimeId==='agent-multichannel-20261017'||runtimeId==='acquire-isolated-20261024')&&env.AGENT_LOCAL_SIMULATION_ENABLED==='true'&&localSimulatorTestPolicy(env);
 return {runtimeId,channelSimulation};
}
