import {z} from 'zod';
import {guardBrowserMutation} from '@/lib/browser-mutation';
import {nativeAgentEnabled} from '@/lib/agent-runtime';
import {prepareMandateDemoContacts} from '@/lib/agent-demo-command';
import {startAgentOutreach,AgentOutreachStartError} from '@/lib/agent-start-outreach';
import {AgentDemoProvisioningError} from '@/db/agent-demo-provisioning-store';
import {AgentDemoRecipientError} from '@/lib/agent-demo-client';
import {agentRequestScope,agentRequestError,agentResponseHeaders,type AgentRequestContext} from '@/lib/agent-request-scope';
const schema=z.object({requestKey:z.string().uuid().refine(v=>v===v.toLowerCase()),action:z.literal('start').optional()}).strict();
/** Explicit authenticated preparation only. Sources, mode, run, identities and
 * accounts come from server records; a browser can supply only its retry key. */
export async function POST(request:Request,context:AgentRequestContext){
 const denied=guardBrowserMutation(request);if(denied)return denied;
 if(!nativeAgentEnabled())return agentRequestError('Agent demo preparation is unavailable.',404);
 const text=await request.text();if(text.length>1000)return agentRequestError('Preparation request is too large.',413);
 let raw:unknown;try{raw=JSON.parse(text);}catch{return agentRequestError('Invalid preparation request.',400);}
 const parsed=schema.safeParse(raw);if(!parsed.success)return agentRequestError('Invalid preparation request.',400);
 try{
  const scoped=await agentRequestScope(request,context);if(scoped instanceof Response)return scoped;
  if(parsed.data.action==='start'){
   if(process.env.AGENT_WORKER_SCOPE_MODE!=='registered'||!scoped.thread)return agentRequestError('Start the agent before outreach.',409);
   const result=await startAgentOutreach({actor:scoped.actor,mandateId:(await context.params).id,threadId:scoped.thread.id,requestKey:parsed.data.requestKey,store:scoped.store,prepare:prepareMandateDemoContacts});
   return Response.json({result},{headers:agentResponseHeaders});
  }
  const {kind,...result}=await prepareMandateDemoContacts(scoped.actor,(await context.params).id,parsed.data.requestKey);
  if(kind==='real')return agentRequestError('Real mandates do not use demo contacts.',409);
  return Response.json(result,{headers:agentResponseHeaders});
 }catch(error){
  // Log failure location, never arbitrary exception text, recipients or tokens.
  const cause=error as {name?:unknown;code?:unknown;message?:unknown;stack?:unknown};
  console.info('agent-demo-preparation',JSON.stringify({module:'agent-demo',mandateId:(await context.params).id,stage:'preparation_failed',errorKind:['Error','TypeError','ZodError','AgentDemoProvisioningError','AgentOutreachStartError'].includes(String(cause?.name))?cause.name:'unknown',sqlState:typeof cause?.code==='string'&&/^[A-Z0-9]{5}$/.test(cause.code)?cause.code:undefined,method:typeof cause?.message==='string'?/^([A-Za-z0-9_.]+) is not a function$/.exec(cause.message)?.[1]:undefined,frames:typeof cause?.stack==='string'?cause.stack.split('\n').filter(line=>/^\s+at /.test(line)).slice(0,3).map(line=>/^\s+at ([A-Za-z0-9_.]+)/.exec(line)?.[1]??'unknown'):[],timestamp:new Date().toISOString()}));
  if(error instanceof AgentDemoRecipientError){
   console.info('agent-demo-recipient-refusal',JSON.stringify({mandateId:(await context.params).id,reason:error.reason}));
   return agentRequestError(error.message,error.status);
  }
  return agentRequestError(error instanceof AgentDemoProvisioningError||error instanceof AgentOutreachStartError?error.message:'Could not finish preparing outreach. Press Start again to check the saved progress.',error instanceof AgentDemoProvisioningError?error.status:503);
 }
}
