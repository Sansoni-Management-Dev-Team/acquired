import {z} from 'zod';
import {guardBrowserMutation} from '@/lib/browser-mutation';
import {nativeAgentEnabled} from '@/lib/agent-runtime';
import {agentHandoffActionSchema} from '@/domain/agent-handoffs';
import {agentRequestScope as scope,agentRequestFailure as failure,agentRequestError as error,agentResponseHeaders as headers,type AgentRequestContext as Context} from '@/lib/agent-request-scope';
const schema=z.object({requestKey:z.string().uuid(),command:agentHandoffActionSchema}).strict();
export async function GET(request:Request,context:Context){
 try{const data=await scope(request,context);if(data instanceof Response)return data;return Response.json(await data.store.handoffInbox((await context.params).id),{headers});}catch(cause){return failure(cause);}
}
export async function POST(request:Request,context:Context){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 if(!nativeAgentEnabled())return error('Native agent execution is unavailable.',404);
 const text=await request.text();if(text.length>10000)return error('Task request is too large.',413);
 let raw:unknown;try{raw=JSON.parse(text);}catch{return error('Invalid task request.',400);}
 const object=z.object({requestKey:z.string().uuid()}).passthrough().safeParse(raw);if(!object.success)return error('Invalid task request.',400);
 const {requestKey,...command}=object.data,parsed=schema.safeParse({requestKey,command});if(!parsed.success)return error('Invalid task request.',400);
 try{const data=await scope(request,context);if(data instanceof Response)return data;return Response.json({result:await data.store.controlHandoff((await context.params).id,parsed.data.requestKey,parsed.data.command)},{headers});}catch(cause){return failure(cause);}
}
