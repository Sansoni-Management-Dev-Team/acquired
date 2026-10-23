import{z}from'zod';
import{agentChannelSendingBudgetInputSchema}from'@/domain/agent-person-channel';
import{guardBrowserMutation}from'@/lib/browser-mutation';
import{agentRequestScope,agentRequestFailure,agentRequestError,agentResponseHeaders,type AgentRequestContext}from'@/lib/agent-request-scope';
const schema=agentChannelSendingBudgetInputSchema.safeExtend({requestKey:z.string().uuid()});
/** Explicit admin-reviewed cap only. Account selection and message authority are unchanged. */
export async function POST(request:Request,context:AgentRequestContext){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 if(process.env.AGENT_WORKER_SCOPE_MODE!=='registered')return agentRequestError('Registered channel budgets are unavailable.',404);
 const text=await request.text();if(text.length>6000)return agentRequestError('Channel budget is too large.',413);
 let raw:unknown;try{raw=JSON.parse(text);}catch{return agentRequestError('Invalid channel budget.',400);}
 const parsed=schema.safeParse(raw);if(!parsed.success)return agentRequestError('Choose a current account revision, whole-number send cap and valid bounded window.',400);
 try{const scoped=await agentRequestScope(request,context);if(scoped instanceof Response)return scoped;
  if(!scoped.thread)return agentRequestError('Save a reviewed channel policy before changing its account budget.',409);
  const{requestKey,...input}=parsed.data;
  return Response.json({result:await scoped.store.configureChannelSendingBudget(scoped.thread.id,requestKey,input)},{headers:agentResponseHeaders});
 }catch(cause){return agentRequestFailure(cause);}
}
