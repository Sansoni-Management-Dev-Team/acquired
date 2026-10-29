import{z}from'zod';
import{nativeHistoryMessageSchema}from'@/domain/agent-execution';
import{agentRequestScope,agentRequestFailure,agentRequestError,agentResponseHeaders,type AgentRequestContext}from'@/lib/agent-request-scope';
const query=z.union([z.object({operationId:z.string().uuid(),include:z.literal('history').optional()}).strict(),z.object({conversationId:z.string().uuid(),include:z.literal('history')}).strict()]);
const savedHistorySchema=z.object({complete:z.boolean(),observedAt:z.string().datetime({offset:true}).nullable(),messages:z.array(nativeHistoryMessageSchema).max(200)}).strict().refine(value=>new Set(value.messages.map(message=>message.id)).size===value.messages.length,'Duplicate saved history message');
function savedHistory(row:{history_complete:unknown;history_observed_at:unknown;history:unknown}){
 const observed=row.history_observed_at;
 const value=savedHistorySchema.parse({complete:row.history_complete,observedAt:observed instanceof Date?observed.toISOString():observed,messages:row.history});
 return {complete:value.complete,observedAt:value.observedAt===null?null:new Date(value.observedAt).toISOString(),messages:value.messages.map(({id,direction,text,subject,at,channel})=>({id,direction,text,...(subject===undefined?{}:{subject}),at,...(channel===undefined?{}:{channel})}))};
}
/** Original owned application state only. A read never reconciles or submits. */
export async function GET(request:Request,context:AgentRequestContext){
 const parameters=new URL(request.url).searchParams;
 if([...parameters.keys()].length!==new Set(parameters.keys()).size||parameters.size<1||parameters.size>2)return agentRequestError('Choose one operation.',400);
 const parsed=query.safeParse(Object.fromEntries(parameters));if(!parsed.success)return agentRequestError('Invalid operation.',400);
 try{const scope=await agentRequestScope(request,context);if(scope instanceof Response)return scope;
  if(!scope.thread)return agentRequestError('Agent conversation is unavailable.',404);
  if('conversationId' in parsed.data){
   const conversation=await scope.store.conversation(scope.thread.id,parsed.data.conversationId);
   if(conversation.id!==parsed.data.conversationId)throw Error('Conversation changed');
   return Response.json({conversationId:conversation.id,history:savedHistory(conversation)},{headers:agentResponseHeaders});
  }
  const record=await scope.store.operationDisplayRecord(scope.thread.id,parsed.data.operationId),op=record.operation;
  const raw=op.result?.delivery,delivery=raw&&['submitted','unknown','not_submitted'].includes(raw.status)?{status:raw.status,...Object.fromEntries(['effect','submittedAt','providerMessageId','providerOperationId','intentId'].flatMap(key=>typeof raw[key]==='string'?[[key,raw[key]]]:[]))}:null;
  return Response.json({operationId:op.id,name:op.name,state:op.state,conversationId:record.conversation.id,phase:record.conversation.phase,...(typeof record.conversation.pause_reason==='string'?{pauseReason:record.conversation.pause_reason}:{}),...(record.route?{routeId:record.route.id,channel:record.route.channel}:{}),delivery,...(parsed.data.include==='history'?{history:savedHistory(record.conversation)}:{})},{headers:agentResponseHeaders});
 }catch(error){return agentRequestFailure(error);}
}
