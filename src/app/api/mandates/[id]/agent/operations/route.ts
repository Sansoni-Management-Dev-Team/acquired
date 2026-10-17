import{z}from'zod';
import{agentRequestScope,agentRequestFailure,agentRequestError,agentResponseHeaders,type AgentRequestContext}from'@/lib/agent-request-scope';
const query=z.object({operationId:z.string().uuid()}).strict();
/** Original owned application state only. A read never reconciles or submits. */
export async function GET(request:Request,context:AgentRequestContext){
 const parameters=new URL(request.url).searchParams;
 if([...parameters.keys()].length!==1)return agentRequestError('Choose one operation.',400);
 const parsed=query.safeParse(Object.fromEntries(parameters));if(!parsed.success)return agentRequestError('Invalid operation.',400);
 try{const scope=await agentRequestScope(request,context);if(scope instanceof Response)return scope;
  if(!scope.thread)return agentRequestError('Agent conversation is unavailable.',404);
  const record=await scope.store.channelDispatchRecord(scope.thread.id,parsed.data.operationId),op=record.operation;
  const raw=op.result?.delivery,delivery=raw&&['submitted','unknown','not_submitted'].includes(raw.status)?{status:raw.status,...Object.fromEntries(['effect','submittedAt','providerMessageId','providerOperationId','intentId'].flatMap(key=>typeof raw[key]==='string'?[[key,raw[key]]]:[]))}:null;
  return Response.json({operationId:op.id,name:op.name,state:op.state,conversationId:record.conversation.id,phase:record.conversation.phase,...(typeof record.conversation.pause_reason==='string'?{pauseReason:record.conversation.pause_reason}:{}),...(record.route?{routeId:record.route.id,channel:record.route.channel}:{}),delivery},{headers:agentResponseHeaders});
 }catch(error){return agentRequestFailure(error);}
}
