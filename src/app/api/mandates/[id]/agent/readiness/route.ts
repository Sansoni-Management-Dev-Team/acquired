import{agentRequestScope,agentRequestFailure,agentResponseHeaders,type AgentRequestContext}from'@/lib/agent-request-scope';
import{readAgentChannelReadiness}from'@/lib/agent-runtime-channel-readiness';
import{agentRuntimeConfiguration}from'@/lib/agent-runtime-readiness';
/** Read-only configuration and exact recorded connection status. Never registers, reads peer history or sends. */
export async function GET(request:Request,context:AgentRequestContext){
 try{const scoped=await agentRequestScope(request,context);if(scoped instanceof Response)return scoped;
  const recorded=scoped.thread?await scoped.store.runtimeReadiness(scoped.thread.id):{registered:false,runtimeId:null,responsibilityRevision:null,reason:'Start agent to register this mandate and configure bounded budgets.',budgets:[],channels:[],defaults:{calls:100,sends:30,usd_micro:'10000000',windowHours:24}};
  const readiness={...recorded,channels:scoped.actor?await readAgentChannelReadiness(scoped.actor,recorded.channels):recorded.channels};
  return Response.json({readiness,configuration:agentRuntimeConfiguration(process.env)},{headers:agentResponseHeaders});
 }catch(cause){return agentRequestFailure(cause);}
}
