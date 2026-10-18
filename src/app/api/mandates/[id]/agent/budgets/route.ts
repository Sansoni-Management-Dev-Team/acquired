import {z} from 'zod';
import {guardBrowserMutation} from '@/lib/browser-mutation';
import {agentRequestScope as scope,agentRequestFailure as failure,agentRequestError as error,agentResponseHeaders as headers,type AgentRequestContext as Context} from '@/lib/agent-request-scope';
const schema=z.object({requestKey:z.string().uuid(),scope:z.enum(['organization','user','mandate']),unit:z.enum(['calls','usd_micro','sends']),windowStart:z.string().datetime({offset:true}),windowEnd:z.string().datetime({offset:true}),cap:z.string().regex(/^(0|[1-9]\d{0,11})$/),expectedRevision:z.number().int().nonnegative()}).strict();
export async function GET(request:Request,context:Context){
 try{const data=await scope(request,context);if(data instanceof Response)return data;return Response.json(await data.store.budgetSettings((await context.params).id),{headers});}catch(cause){return failure(cause);}
}
export async function POST(request:Request,context:Context){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 const text=await request.text();if(text.length>6000)return error('Budget request is too large.',413);
 let raw:unknown;try{raw=JSON.parse(text);}catch{return error('Invalid budget request.',400);}
 const parsed=schema.safeParse(raw);if(!parsed.success)return error('Invalid budget request.',400);
 try{const data=await scope(request,context);if(data instanceof Response)return data;
  const {requestKey,...input}=parsed.data,thread=data.thread??await data.store.openThread((await context.params).id);
  return Response.json({result:await data.store.configureExecutionBudget(thread.id,requestKey,input)},{headers});
 }catch(cause){return failure(cause);}
}
