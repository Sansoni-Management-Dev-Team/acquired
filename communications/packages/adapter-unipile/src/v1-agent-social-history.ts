import {createUnipileV1HistorySource,type V1HistoryOptions} from './v1-history';
import type {V1ReplyReadTransport} from './v1-reply-enrichment';
import type {V1ReplyEventResult} from './v1-events';
import type {HistoryOutboundObservation} from '../../core/src/history-backfill';
import {assertSameBinding,type CanonicalIdentity,type ConnectionBinding,type EventQuery,type EventPage} from '../../contracts/src';
import {plain} from './v1-read-guard';

export interface AgentSocialHistoryMessage{id:string;direction:'inbound'|'outbound';text:string;at:string;providerConversationId:string}
/** Private full-body read composed with the same exhaustive history source,
 * account/peer proofs and durable checkpoint as generic reply ingestion. Bodies
 * never enter the public event/outbox. No state is shared between reads. */
export async function readUnipileAgentSocialHistory(options:{source:Omit<V1HistoryOptions,'normalize'|'normalizeOutbound'>;transport:V1ReplyReadTransport;recipient:CanonicalIdentity;since:string;normalize(transport:V1ReplyReadTransport):(raw:unknown,binding:ConnectionBinding)=>Promise<V1ReplyEventResult>;normalizeOutbound(transport:V1ReplyReadTransport):(raw:unknown,binding:ConnectionBinding,signal:AbortSignal)=>Promise<HistoryOutboundObservation[]|null>;signal?:AbortSignal;readAndCommit?:(source:ReturnType<typeof createUnipileV1HistorySource>,query:EventQuery)=>Promise<EventPage>}){
 const binding=structuredClone(options.source.record.binding),peer=structuredClone(options.recipient),account=options.source.record.providerAccountId;
 if(binding.channel==='email'||binding.channel==='whatsapp'&&(peer.kind!=='phone'||!/^\+[1-9]\d{6,14}$/.test(peer.value))||binding.channel==='linkedin'&&(peer.kind!=='linkedin_profile'||!/^https:\/\/www\.linkedin\.com\/in\/[A-Za-z0-9_%.-]+$/.test(peer.value)))throw Error('Recorded social history unavailable');
 const captured=new Map<string,{text:string;providerConversationId:string}|null>(),messages=new Map<string,AgentSocialHistoryMessage>();let incomplete=false;
 const t=options.transport,transport:V1ReplyReadTransport={getAccount:t.getAccount.bind(t),getChat:t.getChat.bind(t),getChatAttendees:t.getChatAttendees.bind(t),getEmail:t.getEmail.bind(t),async getMessage(id,request){
  const result=await t.getMessage(id,request);
  if(result.kind==='success'&&plain(result.data)&&result.data.id===id&&result.data.account_id===account){
   const m=result.data,value=typeof m.text==='string'&&m.text.length<=6000&&typeof m.chat_id==='string'&&m.chat_id.length>0&&m.chat_id.length<=300?{text:m.text,providerConversationId:m.chat_id}:null;
   if(captured.has(id)&&JSON.stringify(captured.get(id))!==JSON.stringify(value))captured.set(id,null);else captured.set(id,value);
  }
  return result;
 }};
 const incoming=options.normalize(transport),outgoing=options.normalizeOutbound(transport);
 const samePeer=(identity:CanonicalIdentity)=>identity.kind===peer.kind&&identity.value===peer.value;
 const retain=(id:string,direction:'inbound'|'outbound',at:string,chat:string|undefined)=>{
  const body=captured.get(id);if(!body||body.providerConversationId!==chat||id.length>300||messages.size>=200&&!messages.has(id)){incomplete=true;return;}
  const value={id,direction,...body,at:new Date(at).toISOString()},previous=messages.get(id);
  if(previous&&JSON.stringify(previous)!==JSON.stringify(value))incomplete=true;else messages.set(id,value);
 };
 const source=createUnipileV1HistorySource({...options.source,async normalize(raw,b){
  const result=await incoming(raw,b);
  if(result.kind==='event'&&result.event.type==='message'&&result.event.direction==='inbound'&&samePeer(result.event.sender)){assertSameBinding(binding,result.event.reference.binding);retain(result.event.reference.id,'inbound',result.event.occurredAt,result.event.conversation?.id);}
  if(plain(raw)&&typeof raw.message_id==='string')captured.delete(raw.message_id);
  return result;
 },async normalizeOutbound(raw,b,signal){
  const result=await outgoing(raw,b,signal);
  for(const item of result??[])if(samePeer(item.recipient)){assertSameBinding(binding,item.reference.binding);retain(item.reference.id,'outbound',item.occurredAt,item.conversation?.id);}
  if(plain(raw)&&typeof raw.id==='string')captured.delete(raw.id);
  return result;
 }});
 const query:EventQuery={binding,scope:'account',since:options.since,cursor:null,refresh:true};
 const page=options.readAndCommit?await options.readAndCommit(source,query):await source.read(query,{signal:options.signal});assertSameBinding(binding,page.coverage.binding);
 const complete=page.nextCursor===null&&page.coverage.complete&&page.coverage.initialSyncComplete&&!page.coverage.invalidated&&!incomplete;
 return {binding,coverage:page.coverage,source:'communications' as const,observedAt:page.coverage.observedAt,complete,messages:complete?[...messages.values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id)):[],...(!complete?{reason:'Incomplete or oversized verified conversation history'}:{})};
}
