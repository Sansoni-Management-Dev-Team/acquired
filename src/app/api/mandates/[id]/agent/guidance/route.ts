import {z} from 'zod';
import {guardBrowserMutation} from '@/lib/browser-mutation';
import {guidanceInputSchema} from '@/domain/agent-guidance';
import {agentFeedbackSchema} from '@/domain/agent-feedback';
import {manualFeedbackInputSchema} from '@/domain/agent-manual-feedback';
import {agentRequestScope as scope,agentRequestFailure as failure,agentRequestError as error,agentResponseHeaders as headers,type AgentRequestContext as Context} from '@/lib/agent-request-scope';
const requestSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('manualFeedback'),requestKey:z.string().trim().min(1).max(150),input:manualFeedbackInputSchema}).strict(),
 z.object({action:z.literal('feedback'),requestKey:z.string().trim().min(1).max(150),input:agentFeedbackSchema}).strict(),
 z.object({action:z.literal('propose'),requestKey:z.string().trim().min(1).max(200),input:guidanceInputSchema}).strict(),
 z.object({action:z.literal('decide'),id:z.string().uuid(),revision:z.number().int().positive(),decision:z.enum(['approved','rejected']),confirmed:z.literal(true)}).strict(),
 z.object({action:z.literal('edit'),id:z.string().uuid(),revision:z.number().int().positive(),input:guidanceInputSchema}).strict(),
]);
export async function GET(request:Request,context:Context){
 if(process.env.AGENT_GUIDANCE_ENABLED!=='true')return error('Saved guidance is unavailable.',404);
 try{const data=await scope(request,context);if(data instanceof Response)return data;
  return Response.json({guidance:data.thread?await data.store.listGuidance(data.thread.id):[]},{headers});
 }catch(cause){return failure(cause);}
}
export async function POST(request:Request,context:Context){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 if(process.env.AGENT_GUIDANCE_ENABLED!=='true')return error('Saved guidance is unavailable.',404);
 const text=await request.text();if(text.length>15000)return error('Guidance request is too large.',413);
 let raw:unknown;try{raw=JSON.parse(text);}catch{return error('Invalid guidance request.',400);}
 const parsed=requestSchema.safeParse(raw);if(!parsed.success)return error('Invalid guidance request.',400);
 try{
  const data=await scope(request,context);if(data instanceof Response)return data;
  const value=parsed.data;
  const thread=data.thread??(value.action==='manualFeedback'?await data.store.openThread((await context.params).id):undefined);
  if(!thread)return error('Save a message before adding guidance.',409);
  const guidance=value.action==='manualFeedback'?await data.store.captureManualFeedback(thread.id,value.requestKey,value.input)
   :value.action==='feedback'?await data.store.captureFeedback(thread.id,value.requestKey,value.input)
   :value.action==='propose'?await data.store.proposeGuidance(thread.id,value.requestKey,value.input)
   :value.action==='edit'?await data.store.editGuidance(thread.id,value.id,value.revision,value.input)
   :await data.store.decideGuidance(thread.id,value.id,value.revision,value.decision);
  return Response.json({guidance},{headers});
 }catch(cause){return failure(cause);}
}
