import {readAgentSavedChannelPolicy} from '@/lib/agent-controls-runtime';
import{z}from'zod';
import{agentChannelPolicyInputSchema}from'@/domain/agent-person-channel';
import{guardBrowserMutation}from'@/lib/browser-mutation';
import{agentRequestScope,agentRequestFailure,agentRequestError,agentResponseHeaders,type AgentRequestContext}from'@/lib/agent-request-scope';
const schema=agentChannelPolicyInputSchema.safeExtend({requestKey:z.string().uuid()});
/** Saved policy and bounded owned account choices. Reads never create a thread. */
export async function GET(request:Request,context:AgentRequestContext){try{
 const scoped=await agentRequestScope(request,context);if(scoped instanceof Response)return scoped;
 return Response.json(await readAgentSavedChannelPolicy(scoped,(await context.params).id),{headers:agentResponseHeaders});
}catch(cause){return agentRequestFailure(cause);}}
export async function POST(request:Request,context:AgentRequestContext){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 if(process.env.AGENT_WORKER_SCOPE_MODE!=='registered')return agentRequestError('Registered channel policies are unavailable.',404);
 const text=await request.text();if(text.length>10000)return agentRequestError('Channel policy is too large.',413);
 let raw:unknown;try{raw=JSON.parse(text);}catch{return agentRequestError('Invalid channel policy.',400);}
 const parsed=schema.safeParse(raw);if(!parsed.success)return agentRequestError('Choose one exact account per channel, a unique order and a valid delay.',400);
 try{const scoped=await agentRequestScope(request,context);if(scoped instanceof Response)return scoped;
  const thread=scoped.thread??await scoped.store.openThread((await context.params).id),{requestKey,...input}=parsed.data;
  return Response.json({result:await scoped.store.saveChannelPolicy(thread.id,requestKey,input)},{headers:agentResponseHeaders});
 }catch(cause){return agentRequestFailure(cause);}
}
