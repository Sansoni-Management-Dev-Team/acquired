import {z} from 'zod';
import {guardBrowserMutation} from '@/lib/browser-mutation';
import {nativeAgentEnabled} from '@/lib/agent-runtime';
import {agentRequestScope as scope,agentRequestFailure as failure,agentRequestError as error,agentResponseHeaders as headers,type AgentRequestContext as Context} from '@/lib/agent-request-scope';
const schema=z.object({requestKey:z.string().uuid(),delivery:z.discriminatedUnion('mode',[z.object({mode:z.literal('channels'),policyRevision:z.number().int().positive()}).strict(),z.object({mode:z.literal('local_sink')}).strict(),z.object({mode:z.literal('communications'),bindingId:z.string().uuid()}).strict()])}).strict();
export async function GET(request:Request,context:Context){try{const data=await scope(request,context);if(data instanceof Response)return data;return Response.json(await data.store.targetDeliveryOptions((await context.params).id),{headers});}catch(cause){return failure(cause);}}
export async function POST(request:Request,context:Context){
 const denied=guardBrowserMutation(request);if(denied)return denied;if(!nativeAgentEnabled())return error('Native agent execution is unavailable.',404);
 const text=await request.text();if(text.length>5000)return error('Selection request is too large.',413);let raw:unknown;try{raw=JSON.parse(text);}catch{return error('Invalid selection request.',400);}const input=schema.safeParse(raw);if(!input.success)return error('Invalid selection request.',400);
 try{const data=await scope(request,context);if(data instanceof Response)return data;if(!data.thread)return error('Start supervision before reviewing contacts.',404);return Response.json({result:await data.store.proposeTargetSelection(data.thread.id,input.data.requestKey,input.data.delivery)},{headers});}catch(cause){return failure(cause);}
}
