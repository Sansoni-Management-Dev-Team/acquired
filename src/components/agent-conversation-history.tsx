'use client';
import{useEffect,useState}from'react';
import{z}from'zod';
import {AgentChatMessage,AgentChatDetails} from './agent-chat-ui';
const stamp=z.string().datetime({offset:true});
const historySchema=z.object({complete:z.boolean(),observedAt:stamp.nullable(),messages:z.array(z.object({id:z.string().min(1).max(300),direction:z.enum(['inbound','outbound']),text:z.string().max(6000),subject:z.string().max(300).optional(),at:stamp,channel:z.enum(['email','whatsapp','linkedin']).optional()})).max(200)});
type History=z.infer<typeof historySchema>;
type State={key:string;status:'loading'|'ready'|'error';history?:History};
type Props={mandateId:string;revision:number|string;showIncoming?:boolean;expanded?:boolean;presentation?:'summary'|'thread';participantName?:string}&({operationId:string;conversationId?:never}|{conversationId:string;operationId?:never});
const channel=(value:string|undefined)=>value==='whatsapp'?'WhatsApp':value==='linkedin'?'LinkedIn':value==='email'?'Email':null;
function MessageTime({at,kind}:{at:string;kind?:string}){return <p className="mt-1 text-xs text-[var(--muted)]">{channel(kind)&&`${channel(kind)} · `}<time dateTime={at}>{new Date(at).toLocaleString()}</time></p>;}
/** Saved application history only. This never refreshes a provider or approves work. */
export function AgentConversationHistory({mandateId,operationId,conversationId,revision,showIncoming=false,expanded=false,presentation='summary',participantName}:Props){
 const selector=operationId===undefined?'conversationId':'operationId',selected=operationId??conversationId;
 const key=JSON.stringify([mandateId,selector,selected,revision]);
 const[state,setState]=useState<State>({key,status:'loading'});
 useEffect(()=>{
  let active=true;const controller=new AbortController();
  const timer=setTimeout(()=>{controller.abort();if(active)setState({key,status:'error'});},15000);
  void(async()=>{try{
   const response=await fetch(`/api/mandates/${encodeURIComponent(mandateId)}/agent/operations?${selector}=${encodeURIComponent(selected)}&include=history`,{method:'GET',cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error('Saved history unavailable');
   const payload=await response.json(),history=historySchema.parse(payload?.history);
   if(new Set(history.messages.map(m=>m.id)).size!==history.messages.length)throw Error('Saved history unavailable');
   if(active&&!controller.signal.aborted)setState({key,status:'ready',history});
  }catch{if(active)setState({key,status:'error'});}finally{clearTimeout(timer);}})();
  return()=>{active=false;controller.abort();clearTimeout(timer);};
 },[key,mandateId,selector,selected]);
 const current=state.key===key?state:{key,status:'loading' as const};
 if(current.status!=='ready'||!current.history)return <p role="status" className="py-2 text-xs text-[var(--muted)]">{current.status==='error'?(presentation==='thread'?'Couldn’t load this conversation. Close and reopen it to try again.':'Saved conversation could not be loaded. Review current history before approving.'):'Loading saved conversation…'}</p>;
 const history=current.history,messages=[...history.messages].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id)),incoming=messages.filter(m=>m.direction==='inbound').at(-1);
 const thread=<><ol aria-label="Conversation messages" className="mt-3 space-y-5">{messages.map(message=><li key={message.id}><AgentChatMessage speaker={presentation==='thread'?(message.direction==='inbound'?(participantName?.trim()||'Lead'):'Acquire'):(message.direction==='inbound'?'Incoming':'Sent')} kind={message.direction==='outbound'?'user':'assistant'}>{message.subject&&<p className="mt-1 font-medium">{message.subject}</p>}<p className="mt-1 whitespace-pre-wrap break-words leading-7">{message.text}</p><MessageTime at={message.at} kind={message.channel}/></AgentChatMessage></li>)}</ol>{history.observedAt&&<p className="mt-3 text-xs text-[var(--muted)]">Last checked <time dateTime={history.observedAt}>{new Date(history.observedAt).toLocaleString()}</time>.</p>}</>;
 return <section aria-label="Saved conversation" className="space-y-3 py-2">
  {!history.complete&&<p role="status" className="text-xs text-[var(--muted)]">{presentation==='thread'?'I’m still checking this conversation. These are the messages saved so far.':'Saved history is incomplete. Delivery still requires fresh, complete history.'}</p>}
  {presentation==='summary'&&showIncoming&&(incoming?<div className="border-l-2 border-[var(--border)] pl-3"><p className="text-xs font-medium text-[var(--muted)]">Incoming message</p>{incoming.subject&&<p className="mt-2 text-sm font-medium">{incoming.subject}</p>}<p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{incoming.text}</p><MessageTime at={incoming.at} kind={incoming.channel}/></div>:<p className="text-xs text-[var(--muted)]">No incoming message is saved in this conversation.</p>)}
  {messages.length?(presentation==='thread'?thread:<AgentChatDetails open={expanded} summary={<>Full conversation ({messages.length} {messages.length===1?'message':'messages'})</>}>{thread}</AgentChatDetails>):presentation==='thread'?<p className="text-xs text-[var(--muted)]">No messages yet.</p>:!showIncoming&&<p className="text-xs text-[var(--muted)]">No messages are saved in this conversation.</p>}
 </section>;
}
