import {z} from 'zod';
import {guardBrowserMutation} from '@/lib/browser-mutation';
import {nativeAgentEnabled} from '@/lib/agent-runtime';
import {agentRequestScope as scope,agentRequestFailure as failure,agentRequestError as error,agentResponseHeaders as headers,type AgentRequestContext as Context} from '@/lib/agent-request-scope';
const uuid=z.string().uuid();
const schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('create_channels'),requestKey:uuid,mandateRevision:z.string().regex(/^\d{1,30}$/),routeIds:z.array(uuid).min(1).max(200).refine(v=>new Set(v).size===v.length),actions:z.array(z.enum(['initial_email','reply_email','follow_up_email','initial_whatsapp','reply_whatsapp','follow_up_whatsapp','initial_linkedin','reply_linkedin','follow_up_linkedin'])).min(1).max(3).refine(v=>new Set(v).size===v.length),maxSends:z.number().int().min(1).max(100),expiresAt:z.string().datetime({offset:true})}).strict(),
 z.object({action:z.literal('create'),requestKey:uuid,mandateRevision:z.string().regex(/^\d{1,30}$/),conversationIds:z.array(uuid).min(1).max(200),actions:z.array(z.enum(['initial_email','reply_email','follow_up_email'])).min(1).max(3),maxSends:z.number().int().min(1).max(100),expiresAt:z.string().datetime({offset:true})}).strict(),
 z.object({action:z.literal('revoke'),requestKey:uuid,grantId:uuid,revision:z.number().int().positive()}).strict(),
]);
export async function GET(request:Request,context:Context){
 try{const data=await scope(request,context);if(data instanceof Response)return data;return Response.json({grants:data.thread?await data.store.listAuthorityGrants(data.thread.id):[]},{headers});}catch(cause){return failure(cause);}
}
export async function POST(request:Request,context:Context){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 if(!nativeAgentEnabled())return error('Native agent execution is unavailable.',404);
 const text=await request.text();if(text.length>16000)return error('Authority request is too large.',413);
 let raw:unknown;try{raw=JSON.parse(text);}catch{return error('Invalid authority request.',400);}
 const parsed=schema.safeParse(raw);if(!parsed.success)return error('Invalid authority request.',400);
 try{
  const data=await scope(request,context);if(data instanceof Response)return data;if(!data.thread)return error('Start supervision before configuring delegation.',404);
  const {action,requestKey,...input}=parsed.data;
  const result=action==='create_channels'?await data.store.createChannelGrant(data.thread.id,requestKey,input):action==='create'?await data.store.createConversationGrant(data.thread.id,requestKey,input):await data.store.revokeConversationGrant(data.thread.id,requestKey,input);
  return Response.json({result},{headers});
 }catch(cause){return failure(cause);}
}
