import {agentRequestScope,agentRequestFailure,agentResponseHeaders,type AgentRequestContext} from '@/lib/agent-request-scope';
import {agentPool,nativeAgentEnabled} from '@/lib/agent-runtime';
import {readInitialMandateResearch} from '@/lib/agent-initial-research';
import {savedAgentMessages} from '@/lib/agent-saved-messages';
/** Saved chat/outbox state only: no model, provider polling or work scheduling. */
export async function GET(request:Request,context:AgentRequestContext){
 try{
  const scoped=await agentRequestScope(request,context);if(scoped instanceof Response)return scoped;
  const initialResearch=nativeAgentEnabled()?await readInitialMandateResearch(agentPool(),scoped.actor,(await context.params).id):undefined;
  if(!scoped.thread)return Response.json({conversation:{messages:[]},batches:[],guidance:[],...(initialResearch?{initialResearch}:{})},{headers:agentResponseHeaders});
  const threadId=scoped.thread.id,records=await scoped.store.messages(threadId);
  const messages=savedAgentMessages(records);
  const batches=await scoped.store.listReviewBatches(threadId,{pendingOnly:true});
  const guidance=process.env.AGENT_GUIDANCE_ENABLED==='true'?await scoped.store.listGuidance(threadId):[];
  return Response.json({conversation:{threadId,messages},batches,guidance,...(initialResearch?{initialResearch}:{})},{headers:agentResponseHeaders});
 }catch(error){return agentRequestFailure(error);}
}
