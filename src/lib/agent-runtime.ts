import {backgroundPool} from '@/db/background-pool';
import {Pool} from 'pg';
import {attachDatabasePool} from '@vercel/functions';
import {type AgentStore,type AgentActor,type AgentStoreOptions} from '@/db/agent-store';
import {AgentChatStore} from '@/db/agent-chat-store';
import {AgentInvitationStore} from '@/db/agent-invitation-store';
import {planNativeChatTurn} from './agent-chat-planner';
import type {AgentGuidanceView} from '@/domain/agent-guidance';
import type {AgentSnapshot} from '@/domain/agent-mode';
import {answerAgentQuestion} from './agent-conversation';
import {savedAgentMessages} from './agent-saved-messages';
export const durableAgentEnabled=()=>process.env.AGENT_DURABLE_STATE_ENABLED==='true';
const globalAgent=globalThis as typeof globalThis & {acquireAgentPools?:Map<string,Pool>};
export const nativeAgentEnabled=()=>durableAgentEnabled()&&process.env.AGENT_NATIVE_EXECUTION_ENABLED==='true';
export function agentPool():Pool{
 const connectionString=process.env.DATABASE_URL;
 if(!connectionString || process.env.DATABASE_DRIVER!=='postgres')throw new Error('Durable agent requires the configured PostgreSQL driver');
 const pools=globalAgent.acquireAgentPools??=new Map<string,Pool>();let pool=pools.get(connectionString);
 if(!pool){const ca=process.env.DATABASE_SSL_CA;pool=new Pool({connectionString,max:4,connectionTimeoutMillis:10000,idleTimeoutMillis:5000,...(ca?{ssl:{ca,rejectUnauthorized:true}}:{})});attachDatabasePool(pool);pool=backgroundPool(pool);pools.set(connectionString,pool);}
 return pool;
}
export function agentStore(actor:AgentActor,options:AgentStoreOptions={}){
 return new AgentInvitationStore(agentPool(),actor,options);
}
export class AgentTurnError extends Error{constructor(message:string,readonly status:number){super(message);}}
export async function savedAgentConversation(store:AgentStore,mandateId:string){
 const thread=await store.findThread(mandateId);
 if(!thread)return {threadId:undefined,messages:[]};
 const records=await store.messages(thread.id);
 const messages=savedAgentMessages(records);
 return {threadId:thread.id,messages};
}
export async function answerSavedAgentConversation(store:AgentStore & {relevantGuidance?:(threadId:string,query:string)=>Promise<AgentGuidanceView[]>},mandateId:string,requestKey:string,question:string,snapshot:AgentSnapshot,answer=answerAgentQuestion){
 const thread=await store.openThread(mandateId);
 const turn=await store.beginConversationTurn(thread.id,requestKey,question);
 if(turn.kind==='busy')throw new AgentTurnError('A reply is already being prepared. Refresh before trying again.',409);
 if(turn.kind==='failed')throw new AgentTurnError('That reply was interrupted. Send a new request to retry.',409);
 if(turn.kind==='complete')return {messageId:turn.messageId!,text:turn.text!};
 try{
  const history=await savedAgentConversation(store,mandateId);
  if(nativeAgentEnabled()){
   const nativeStore=store as AgentChatStore;
   if(typeof nativeStore.nativeChatContext!=='function')throw new Error('Native chat planner unavailable');
   const guidance=process.env.AGENT_GUIDANCE_ENABLED==='true'?await nativeStore.relevantGuidance(thread.id,question+' '+snapshot.mandate.description):[];
   const result=await planNativeChatTurn({store:nativeStore,threadId:thread.id,answerOperationId:turn.operationId,question,messages:history.messages,snapshot,guidance});
   return await store.finishConversationTurn(turn.operationId,result.text,result.appliedGuidance??guidance.map(item=>({id:item.id,revision:item.revision})),result.plan);
  }
  if(process.env.AGENT_GUIDANCE_ENABLED==='true'){
   if(!store.relevantGuidance)throw new Error('Guidance store unavailable');
   const guidance=await store.relevantGuidance(thread.id,question+' '+snapshot.mandate.description);
   const text=await answer(history.messages,snapshot,true,guidance);
   return await store.finishConversationTurn(turn.operationId,text,guidance.map(item=>({id:item.id,revision:item.revision})));
  }
  const text=await answer(history.messages,snapshot,true);
  return await store.finishConversationTurn(turn.operationId,text);
 }catch(error){await store.failConversationTurn(turn.operationId,'failed');throw error;}
}
