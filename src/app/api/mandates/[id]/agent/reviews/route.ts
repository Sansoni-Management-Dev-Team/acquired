import {wakeNativeAgentAfterCommit} from '@/lib/agent-native-wake';
import {z} from 'zod';
import {guardBrowserMutation} from '@/lib/browser-mutation';
import {reviewItemSchema} from '@/domain/agent-authority';
import {agentRequestScope as scope,agentRequestFailure as failure,agentRequestError as error,agentResponseHeaders as headers,type AgentRequestContext as Context} from '@/lib/agent-request-scope';
export async function GET(request:Request,context:Context){
 try{const data=await scope(request,context);if(data instanceof Response)return data;
  const batches=data.thread?await data.store.listReviewBatches(data.thread.id,{pendingOnly:true}):[];
  return Response.json({batches},{headers});
 }catch(cause){return failure(cause);}
}
const decisionSchema=z.object({action:z.literal('decide'),batchId:z.string().uuid(),revision:z.number().int().positive(),items:z.array(reviewItemSchema).min(1).max(50),decision:z.enum(['approved','rejected']),approvalSource:z.literal('automatic_demo').optional()}).strict().refine(value=>!value.approvalSource||value.decision==='approved');
const editSchema=z.object({action:z.literal('edit'),batchId:z.string().uuid(),operationId:z.string().uuid(),revision:z.number().int().positive(),body:z.string().trim().min(1).max(6000)}).strict();
const requestSchema=z.discriminatedUnion('action',[decisionSchema,editSchema]);
export async function POST(request:Request,context:Context){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 const text=await request.text();if(text.length>30000)return error('Review request is too large.',413);
 let raw:unknown;try{raw=JSON.parse(text);}catch{return error('Invalid review request.',400);}
 const parsed=requestSchema.safeParse(raw);if(!parsed.success)return error('Invalid review request.',400);
 try{
  const data=await scope(request,context);if(data instanceof Response)return data;
  if(!data.thread)return error('Review not found.',404);
  const value=parsed.data;
  const batch=value.action==='decide'
   ?await data.store.decideReviewBatch(data.thread.id,value.batchId,value.revision,value.items,value.decision,...(value.approvalSource?[value.approvalSource] as const:[]))
   :await data.store.editEmailReview(data.thread.id,value.batchId,value.operationId,value.revision,value.body);
  if(value.action==='decide'&&value.decision==='approved')wakeNativeAgentAfterCommit();
  return Response.json({batch},{headers});
 }catch(cause){return failure(cause);}
}
