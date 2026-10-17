import {agentRequestScope,agentRequestFailure,agentResponseHeaders,type AgentRequestContext} from '@/lib/agent-request-scope';
/** Saved chat/outbox state only: no model, provider polling or work scheduling. */
export async function GET(request:Request,context:AgentRequestContext){
 try{
  const scoped=await agentRequestScope(request,context);if(scoped instanceof Response)return scoped;
  if(!scoped.thread)return Response.json({conversation:{messages:[]},batches:[],guidance:[]},{headers:agentResponseHeaders});
  const threadId=scoped.thread.id,records=await scoped.store.messages(threadId);
  const messages=records.flatMap(row=>typeof row.content?.text==='string'&&['user','assistant'].includes(row.role)?[{id:row.id as string,role:row.role as 'user'|'assistant',content:row.content.text}]:[]);
  const batches=await scoped.store.listReviewBatches(threadId,{pendingOnly:true});
  const guidance=process.env.AGENT_GUIDANCE_ENABLED==='true'?await scoped.store.listGuidance(threadId):[];
  return Response.json({conversation:{threadId,messages},batches,guidance},{headers:agentResponseHeaders});
 }catch(error){return agentRequestFailure(error);}
}
