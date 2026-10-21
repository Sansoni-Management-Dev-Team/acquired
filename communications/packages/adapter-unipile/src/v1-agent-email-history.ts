import {createUnipileV1HistorySource,type V1HistoryOptions} from './v1-history';
import type {V1ReplyReadTransport} from './v1-reply-enrichment';
import type {V1ReplyEventResult} from './v1-events';
import type {HistoryOutboundObservation} from '../../core/src/history-backfill';
import {assertSameBinding,type ConnectionBinding,type EventQuery,type EventPage} from '../../contracts/src';
import {classifyEmailDeliveryFailure} from './v1-email-delivery-failure';
import {plain} from './v1-read-guard';
export interface AgentEmailHistoryMessage{id:string;direction:'inbound'|'outbound';text:string;subject?:string;at:string}
/** Private service read: body text never enters the generic webhook/event stream.
 * Exhaustive source coverage and existing identity normalizers remain authority.
 * Per-read captures avoid cross-conversation or concurrent-read contamination. */
export async function readUnipileAgentEmailHistory(options:{source:Omit<V1HistoryOptions,'normalize'|'normalizeOutbound'>;transport:V1ReplyReadTransport;recipient:string;since:string;normalize(transport:V1ReplyReadTransport):(raw:unknown,binding:ConnectionBinding)=>Promise<V1ReplyEventResult>;normalizeOutbound(transport:V1ReplyReadTransport):(raw:unknown,binding:ConnectionBinding,signal:AbortSignal)=>Promise<HistoryOutboundObservation[]|null>;signal?:AbortSignal;readAndCommit?:(source:ReturnType<typeof createUnipileV1HistorySource>,query:EventQuery)=>Promise<EventPage>}){
 const binding=structuredClone(options.source.record.binding),peer=options.recipient;
 if(binding.channel!=='email'||peer!==peer.trim().toLowerCase()||!/^\S+@[^\s@]+\.[^\s@]+$/.test(peer))throw Error('Recorded email history unavailable');
 const captured=new Map<string,{text:string;subject?:string}>(),messages=new Map<string,AgentEmailHistoryMessage>(),deliveryFailures=new Map<string,{id:string;at:string}>(),failureEvidence=new Map<string,{failure:ReturnType<typeof classifyEmailDeliveryFailure>;at:string}>();let incomplete=false;
 const t=options.transport,transport:V1ReplyReadTransport={getAccount:t.getAccount.bind(t),getChat:t.getChat.bind(t),getChatAttendees:t.getChatAttendees.bind(t),getMessage:t.getMessage.bind(t),async getEmail(account,id,request){
  const result=await t.getEmail(account,id,request);
  if(result.kind==='success'&&plain(result.data)){
   const mail=result.data;if(mail.id===id&&mail.account_id===account&&typeof mail.date==='string'){const failure=classifyEmailDeliveryFailure(mail);if(failure.kind!=='none'){if(failureEvidence.size>=200&&!failureEvidence.has(id))incomplete=true;else{const next={failure,at:mail.date},previous=failureEvidence.get(id);if(previous&&JSON.stringify(previous)!==JSON.stringify(next))incomplete=true;else failureEvidence.set(id,next);}}}const participants=[mail.from_attendee,...['to_attendees','cc_attendees','bcc_attendees'].flatMap(field=>Array.isArray(mail[field])?mail[field]:[])];
   if(participants.some(p=>plain(p)&&typeof p.identifier==='string'&&p.identifier.toLowerCase()===peer)){
    if(typeof mail.body!=='string'||mail.body.length>6000||typeof mail.subject!=='string'||mail.subject.length>300||id.length>300||captured.size>=200&&!captured.has(id)){incomplete=true;}
    else{const value={text:mail.body,subject:mail.subject},prior=captured.get(id);if(prior&&JSON.stringify(prior)!==JSON.stringify(value))incomplete=true;else captured.set(id,value);}
   }
  }
  return result;
 }};
 const normalise=options.normalize(transport),outgoing=options.normalizeOutbound(transport);
 const retain=(id:string,direction:'inbound'|'outbound',at:string)=>{const body=captured.get(id);if(!body){incomplete=true;return;}const value={id,direction,...body,at:new Date(at).toISOString()},previous=messages.get(id);if(previous&&JSON.stringify(previous)!==JSON.stringify(value))incomplete=true;else messages.set(id,value);};
 const source=createUnipileV1HistorySource({...options.source,async normalize(raw,b){const result=await normalise(raw,b);if((result.kind==='ignore'&&result.reason==='system_email'||result.kind==='event'&&result.event.type==='email_change'&&result.event.change==='bounce')){const evidence=failureEvidence.get((raw as {email_id:string}).email_id);if(evidence?.failure.kind==='ambiguous')incomplete=true;else if(evidence?.failure.kind==='bounce'&&evidence.failure.recipient===peer){incomplete=true;if((raw as {email_id:string}).email_id.length<=300)deliveryFailures.set((raw as {email_id:string}).email_id,{id:(raw as {email_id:string}).email_id,at:new Date(evidence.at).toISOString()});}}if(result.kind==='event'&&result.event.type==='message'&&result.event.direction==='inbound'&&result.event.sender.kind==='email'&&result.event.sender.value===peer){assertSameBinding(binding,result.event.reference.binding);retain(result.event.reference.id,'inbound',result.event.occurredAt);}return result;},async normalizeOutbound(raw,b,signal){const result=await outgoing(raw,b,signal);for(const item of result??[])if(item.recipient.kind==='email'&&item.recipient.value===peer){assertSameBinding(binding,item.reference.binding);retain(item.reference.id,'outbound',item.occurredAt);}return result;}});
 const query:EventQuery={binding,scope:'account',since:options.since,cursor:null,refresh:true};
 const page=options.readAndCommit?await options.readAndCommit(source,query):await source.read(query,{signal:options.signal});
 assertSameBinding(binding,page.coverage.binding);
 const complete=page.nextCursor===null&&page.coverage.complete&&page.coverage.initialSyncComplete&&!page.coverage.invalidated&&!incomplete;
 return {binding,coverage:page.coverage,source:'communications' as const,observedAt:page.coverage.observedAt,complete,messages:complete?[...messages.values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id)):[],...(deliveryFailures.size?{deliveryFailures:[...deliveryFailures.values()]}:{}),...(!complete?{reason:'Incomplete or oversized verified conversation history'}:{})};
}
