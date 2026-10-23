import {refreshCompanyProjectionsBeforeNativeControl} from '@/lib/company-projection-refresh';
import {z} from 'zod';
import {guardBrowserMutation} from '@/lib/browser-mutation';
import {nativeAgentEnabled} from '@/lib/agent-runtime';
import {initializeAgentChannelDefaults} from '@/lib/agent-start-outreach';
import {agentDriverSchema} from '@/domain/agent-ownership';
import {agentDemoPreparationReadiness,agentDemoProvisioningConfiguration} from '@/lib/agent-demo-configuration';
import {agentRequestScope as scope,agentRequestFailure as failure,agentRequestError as error,agentResponseHeaders as headers,type AgentRequestContext as Context} from '@/lib/agent-request-scope';

const uuid=z.string().uuid(),revision=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const ownership={conversationId:uuid,revision,epoch:revision,contextRevision:z.string().regex(/^[a-f0-9]{64}$/)};
const control={requestKey:uuid,expectedRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),mandateRevision:z.string().regex(/^\d+$/).max(30)};
const inputSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('start'),...control}).strict(),
 z.object({action:z.literal('pause'),...control}).strict(),
 z.object({action:z.literal('resume'),...control}).strict(),
 z.object({action:z.literal('handover_begin'),requestKey:uuid,...ownership,target:agentDriverSchema,reason:z.string().trim().min(5).max(2000)}).strict(),
 z.object({action:z.literal('handover_commit'),requestKey:uuid,...ownership}).strict(),
 z.object({action:z.literal('resume_held'),requestKey:uuid,...ownership,reason:z.string().trim().min(5).max(2000)}).strict(),
 z.object({action:z.literal('refresh_held_history'),requestKey:uuid,...ownership}).strict(),
 z.object({action:z.literal('refresh_review_history'),requestKey:uuid,...ownership}).strict(),
 z.object({action:z.literal('reassess_conversation'),requestKey:uuid,...ownership,reason:z.string().trim().min(5).max(2000)}).strict(),
 z.object({action:z.literal('adopt_sequence'),requestKey:uuid,enrolmentId:uuid,expectedVersionId:uuid}).strict(),
]);

/** Read-only: displaying controls never starts a supervisor, model or sequence. */
export async function GET(request:Request,context:Context){
 try{
  const data=await scope(request,context);if(data instanceof Response)return data;
  const controls=request.headers.get('X-Acquire-Control-Snapshot')==='1'
   ?await data.store.controlsSnapshot((await context.params).id,data.thread?.id):undefined;
  const state=controls?controls.state:data.thread?await data.store.executionState(data.thread.id):null;
  const config=agentDemoProvisioningConfiguration();
  const readiness=agentDemoPreparationReadiness(config,data.actor);
  // Existing prepared recipients retain their saved service and account bindings.
  const selectedTesting=process.env.AGENT_DEMO_TARGET==='testing'&&state?.executionMode==='demo'&&!state.demoContacts?.prepared;
  const demoService=selectedTesting?{communicationsApi:'https://127.0.0.1:5991',...readiness,...(!readiness.ready?{message:'The testing service on 5991 is not ready for this mandate yet. Your saved companies and people are available; simulated outreach has not started.'}:{})}:undefined;
  return Response.json({enabled:nativeAgentEnabled(),state,mandateRevision:data.mandate?.revision,demoPreparationEnabled:readiness.ready,demoService,...(controls?{controls}:{})},{headers});
 }catch(cause){return failure(cause);}
}

export async function POST(request:Request,context:Context){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 if(!nativeAgentEnabled())return error('Native agent execution is unavailable.',404);
 const text=await request.text();if(text.length>10000)return error('Control request is too large.',413);
 let raw:unknown;try{raw=JSON.parse(text);}catch{return error('Invalid control request.',400);}
 const parsed=inputSchema.safeParse(raw);if(!parsed.success)return error('Invalid control request.',400);
 try{
  const data=await scope(request,context);if(data instanceof Response)return data;
  const {action,requestKey,...input}=parsed.data;
  if(action==='start'||action==='resume')await refreshCompanyProjectionsBeforeNativeControl(data.actor,(await context.params).id);
  let thread=data.thread;
  if(!thread){
   if(action!=='start')return error('Agent supervision has not been started.',404);
   // scope has already checked this mandate against the current session.
   thread=await data.store.openThread((await context.params).id);
  }
  const result=action==='handover_begin'?await data.store.beginConversationHandover(thread.id,requestKey,input)
   :action==='handover_commit'?await data.store.commitConversationHandover(thread.id,requestKey,input)
   :action==='resume_held'?await data.store.resumeHeldConversation(thread.id,requestKey,input)
   :action==='refresh_held_history'?await data.store.requestHeldHistoryRefresh(thread.id,requestKey,input)
   :action==='refresh_review_history'?await data.store.requestConversationReviewHistory(thread.id,requestKey,input)
   :action==='reassess_conversation'?await data.store.reassessConversationAfterReview(thread.id,requestKey,input)
   :action==='adopt_sequence'?await data.store.adoptSequenceConversation(thread.id,requestKey,input)
   :await data.store.controlResponsibility(thread.id,requestKey,{action,...input});
  if(action==='start'||action==='resume')try{await initializeAgentChannelDefaults(data.store,thread.id,requestKey);}catch{
   console.info('agent-channel-defaults',JSON.stringify({module:'agent-channel-defaults',mandateId:(await context.params).id,stage:'settings_not_ready',timestamp:new Date().toISOString()}));
  }
  return Response.json({result},{headers});
 }catch(cause){return failure(cause);}
}
