import {z} from 'zod';
import type {AgentEventOutcome} from '@/domain/agent-events';
export const historyProgress={historyRoot:z.string().uuid().optional(),historyStep:z.number().int().min(0).max(12).optional(),historyAnchor:z.string().datetime({offset:true}).optional()};
/** Only a verified persisted read checkpoint reaches this helper. Failure retries
 * retain their normal attempts. Progress is bounded independently and never
 * grants inference/send authority or changes the conversation epoch. */
export async function continueAgentHistoryPreparation(store:{enqueueEvent:(threadId:string,key:string,kind:string,payload:unknown)=>Promise<unknown>},input:{event:{id:string;thread_id:string;kind:string;payload:unknown;created_at?:Date|string};assertCurrent:()=>Promise<void>}):Promise<AgentEventOutcome>{
 const event=input.event,historyOnly=event.kind==='conversation.history_changed';
 if(!historyOnly&&!['conversation.reassess','conversation.reminder','channel.due'].includes(event.kind))throw Error('Unsupported history continuation');
 const identity={conversationId:z.string().uuid()},value=historyOnly?z.object({...identity,...historyProgress}).strict().parse(event.payload):z.object({...identity,epoch:z.number().int().positive(),reminderGeneration:z.number().int().positive(),...historyProgress}).strict().parse(event.payload);
 const root=value.historyRoot??z.string().uuid().parse(event.id),step=value.historyStep??0;
 if(step>=12)return {kind:'review',message:'Conversation history could not converge within its bounded checkpoints. Review saved progress before continuing.'};
 if(historyOnly&&!value.historyAnchor&&!event.created_at)throw Error('Original history event timestamp required');
 const anchor=historyOnly?value.historyAnchor??new Date(event.created_at!).toISOString():undefined;
 await input.assertCurrent();
 await store.enqueueEvent(event.thread_id,`history-preparation:${root}:${step+1}`,event.kind==='channel.due'?'conversation.reassess':event.kind,{...value,historyRoot:root,historyStep:step+1,...(anchor?{historyAnchor:anchor}:{})});
 return {kind:'complete'};
}
