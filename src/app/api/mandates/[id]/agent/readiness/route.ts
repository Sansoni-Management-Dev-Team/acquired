import{agentRequestScope,agentRequestFailure,agentResponseHeaders,type AgentRequestContext}from'@/lib/agent-request-scope';
import{readAgentRuntimeStatus}from'@/lib/agent-controls-runtime';
/** Read-only configuration and exact recorded connection status. Never registers, reads peer history or sends. */
export async function GET(request:Request,context:AgentRequestContext){
 try{const scoped=await agentRequestScope(request,context);if(scoped instanceof Response)return scoped;
  return Response.json(await readAgentRuntimeStatus(scoped),{headers:agentResponseHeaders});
 }catch(cause){return agentRequestFailure(cause);}
}
