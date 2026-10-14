import {assertSameBinding,type CanonicalIdentity,type ConnectionBinding} from "../../contracts/src";
import type { UnipileHttpResult, UnipileRequestOptions } from "./http-core";
import {normalizeV1ReplyEvent,type V1ReplyEventResult,type V1ReplyEventContext} from "./v1-events";
import {normalizeV1AccountReadiness} from './v1-normalization';
export interface VerifiedReplyAlias {binding:ConnectionBinding;providerAccountId:string;sourceId:string;providerId:string;product:string;identity:CanonicalIdentity}
export interface V1ReplyReadTransport {
 getAccount(id:string,options?:UnipileRequestOptions):Promise<UnipileHttpResult>;
 getChat(accountId:string,id:string,options?:UnipileRequestOptions):Promise<UnipileHttpResult>;
 getChatAttendees(accountId:string,id:string,options?:UnipileRequestOptions):Promise<UnipileHttpResult>;
 getMessage(id:string,options?:UnipileRequestOptions):Promise<UnipileHttpResult>;
 getEmail(accountId:string,id:string,options?:UnipileRequestOptions):Promise<UnipileHttpResult>;
}
export type V1ReplyEnrichmentOptions = {binding:ConnectionBinding;providerAccountId:string;sourceId:string;eventsFrom:string;transport:V1ReplyReadTransport;now?:()=>number;deadlineMs?:number;historyAllFolders?:true;
 /** Current physical owner verification from authenticated account metadata against the original
  * service-owned identity. Required: never infer WhatsApp LID/PN or IMAP owner from display names. */
 verifyOwner(input:{binding:ConnectionBinding;providerAccountId:string;sourceId:string;account:unknown;recordedOwner:{channel:'email';ownerAddresses:readonly string[]}|{channel:'whatsapp'|'linkedin';ownerProviderId:string;product:string};signal:AbortSignal}):Promise<boolean>;
 resolveAlias(input:{binding:ConnectionBinding;providerAccountId:string;sourceId:string;providerId:string;product:string;signal:AbortSignal}):Promise<VerifiedReplyAlias|null>;
} & ({channel:"email";ownerAddresses:readonly string[]} | {channel:"whatsapp"|"linkedin";ownerProviderId:string;product:"whatsapp"|"classic"|"sales_navigator"|"recruiter"});
export class ReplyEnrichmentReadError extends Error {constructor(readonly code:"timeout"|"unavailable"|"rate_limited"|"reconnect"){super(code);this.name="ReplyEnrichmentReadError";}}
const object=(v:unknown):v is Record<string,unknown>=>v!==null && typeof v==='object' && !Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string' && v.length>0 && v.length<=2048 && v===v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const review=(code:'protocol'|'account_changed'|'identity_pending'='protocol'):V1ReplyEventResult=>({kind:'review',code});
const ignore=(reason:string):V1ReplyEventResult=>({kind:'ignore',reason});
function date(v:unknown):v is string {
 if(typeof v!=='string')return false;
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(v);
 if(!m)return false;const [y,month,d,h,min,s]=m.slice(1,7).map(Number),zone=m[7];
 return y>=1000 && month>=1 && month<=12 && d>=1 && d<=new Date(Date.UTC(y,month,0)).getUTCDate() && h<=23 && min<=59 && s<=59 &&
 (zone==='Z'||(Number(zone.slice(1,3))<=23 && Number(zone.slice(4,6))<=59)) && Number.isFinite(Date.parse(v));
}
const same=(a:ConnectionBinding,b:ConnectionBinding)=>{try{assertSameBinding(a,b);return true;}catch{return false;}};
const nonReply=new Set(['message_read','message_delivered','message_reaction','message_edited','message_deleted','mail_sent','mail_moved','new_relation']);

/** Read-only corroboration of an authenticated default-format webhook. No sync endpoint, provider
 * mutation, guessed alias, storage fallback or history/freshness certification occurs here.
 * Required owner/alias ports must enforce current grants and original physical-account identity. */
export function createUnipileV1ReplyEnricher(options:V1ReplyEnrichmentOptions):{normalize(raw:unknown,binding:ConnectionBinding):Promise<V1ReplyEventResult>} {
 assertSameBinding(options.binding,options.binding);
 if(options.historyAllFolders!==undefined&&options.historyAllFolders!==true)throw new Error('Invalid reply enrichment configuration');
 if(options.binding.backend!=='unipile' || options.binding.channel!==options.channel || !id(options.providerAccountId) || !id(options.sourceId) || !date(options.eventsFrom))throw new Error('Invalid reply enrichment configuration');
 if(options.channel==='email'&&!Array.isArray(options.ownerAddresses))throw new Error('Invalid reply enrichment configuration');
 const allFolders=options.historyAllFolders===true;const binding=structuredClone(options.binding),providerAccountId=options.providerAccountId,sourceId=options.sourceId,eventsFrom=options.eventsFrom;
 const recorded=options.channel==='email'?{channel:'email' as const,ownerAddresses:[...options.ownerAddresses]}:{channel:options.channel,ownerProviderId:options.ownerProviderId,product:options.product};
 if(recorded.channel==='email'?(!recorded.ownerAddresses.length||recorded.ownerAddresses.length>100||!recorded.ownerAddresses.every(a=>typeof a==='string'&&a===a.toLowerCase()&&a===a.trim()&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(a))):
   (!id(recorded.ownerProviderId)||(recorded.channel==='whatsapp'?recorded.product!=='whatsapp':!['classic','sales_navigator','recruiter'].includes(recorded.product))))throw new Error('Invalid reply enrichment configuration');
 const deadlineMs=options.deadlineMs??10000,now=options.now?.bind(options)??Date.now;
 if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>60000)throw new Error('Invalid reply enrichment configuration');
 const t=options.transport,getAccount=t.getAccount.bind(t),getChat=t.getChat.bind(t),getAttendees=t.getChatAttendees.bind(t),getMessage=t.getMessage.bind(t),getEmail=t.getEmail.bind(t),verifyOwner=options.verifyOwner.bind(options),resolveAlias=options.resolveAlias.bind(options);
 return {async normalize(input,requested){
  const raw=structuredClone(input),requestBinding=structuredClone(requested);
  if(!same(binding,requestBinding) || (object(raw) && raw.account_id!==providerAccountId))return review('account_changed');
  if(!object(raw) || !id(raw.account_id) || typeof raw.event!=='string')return review();
  const timestamp=recorded.channel==='email'?raw.date:raw.timestamp,through=new Date(now()).toISOString();
  const context:V1ReplyEventContext={binding:structuredClone(binding),providerAccountId,timestampBounds:{from:eventsFrom,through},...recorded};
  const initial=normalizeV1ReplyEvent(raw,context);
  if(initial.kind==='ignore' || (initial.kind==='review' && initial.code==='account_changed'))return initial;
  if(nonReply.has(raw.event))return review();
  if(!date(timestamp) || Date.parse(timestamp)<Date.parse(eventsFrom) || Date.parse(timestamp)>Date.parse(through) ||
     (recorded.channel==='email'?(raw.event!=='mail_received'||!id(raw.email_id)):(raw.event!=='message_received'||!id(raw.chat_id)||!id(raw.message_id))))return review();
  if(recorded.channel!=='email' && (initial.kind!=='review'||initial.code!=='identity_pending'))return initial;
  const controller=new AbortController(),signal=controller.signal,deadlineAt=performance.now()+deadlineMs;
  async function check(){if(signal.aborted||performance.now()>=deadlineAt){controller.abort();throw new ReplyEnrichmentReadError('timeout');}}
  async function read(call:()=>Promise<UnipileHttpResult>):Promise<unknown>{
   await check();let result:UnipileHttpResult;
   try{result=structuredClone(await call());}catch{throw new ReplyEnrichmentReadError(signal.aborted?'timeout':'unavailable');}
   await check();
   if(result?.kind!=='success')throw new ReplyEnrichmentReadError(result?.kind==='rejected'&&result.reason==='authentication'?'reconnect':result?.kind==='rejected'&&result.reason==='rate_limited'?'rate_limited':signal.aborted?'timeout':'unavailable');
   if(result.status!==200)return null;
   return result.data;
  }
  const work=async():Promise<V1ReplyEventResult>=>{
   const account=await read(()=>getAccount(providerAccountId,{signal}));
   const ready=normalizeV1AccountReadiness(account,{binding,providerAccountId,sourceId});
   if(ready.status!=='ready'){
    if(ready.status==='review'&&ready.code==='account_changed')return review('account_changed');
    if(ready.status==='review'&&ready.code==='protocol')return review();
    throw new ReplyEnrichmentReadError(ready.status==='review'?'reconnect':'unavailable');
   }
   let ownerVerified:boolean;
   try{ownerVerified=await verifyOwner({binding:structuredClone(binding),providerAccountId,sourceId,account:structuredClone(account),recordedOwner:structuredClone(recorded),signal});}catch{throw new ReplyEnrichmentReadError(signal.aborted?'timeout':'unavailable');}
   await check();if(ownerVerified!==true)return review('account_changed');
   if(recorded.channel==='email'){
    const mail=await read(()=>getEmail(providerAccountId,raw.email_id as string,{signal}));
    if(!object(mail) || mail.kind!=='2_full' || !Array.isArray(mail.headers) || mail.headers.length===0)return review();
    const types=binding.platform==='gmail'?['MAIL','GOOGLE','GOOGLE_OAUTH']:binding.platform==='outlook'?['MAIL','OUTLOOK','EXCHANGE']:['MAIL','ICLOUD'];
    if(mail.type!==undefined&&(typeof mail.type!=='string'||!types.includes(mail.type)))return review('account_changed');
    for(const field of ['type','provider_id','message_id'])if(raw[field]!==undefined&&raw[field]!==mail[field])return review();
    return normalizeV1ReplyEvent(raw,{...context,channel:'email',ownerAddresses:[...recorded.ownerAddresses],...(allFolders?{historyAllFolders:true as const}:{}),email:{binding:structuredClone(binding),providerAccountId,id:raw.email_id as string,complete:true,headersComplete:true,mail}});
   }
   const chat=await read(()=>getChat(providerAccountId,raw.chat_id as string,{signal}));
   if(!object(chat)||chat.object!=='Chat'||chat.account_id!==providerAccountId||chat.id!==raw.chat_id||chat.account_type!==recorded.channel.toUpperCase())return review('account_changed');
   if(chat.type===1)return ignore('group_message');
   if(chat.type!==0)return review();
   const list=await read(()=>getAttendees(providerAccountId,raw.chat_id as string,{signal}));
   if(!object(list)||list.object!=='ChatAttendeeList'||list.cursor!==null||!Array.isArray(list.items)||list.items.length!==2)return review('identity_pending');
   const attendees=list.items;
   if(!attendees.every(a=>object(a)&&a.object==='ChatAttendee'&&a.account_id===providerAccountId&&id(a.id)&&id(a.provider_id)&&(a.is_self===0||a.is_self===1))||
     new Set(attendees.map(a=>(a as Record<string,unknown>).id)).size!==2||new Set(attendees.map(a=>(a as Record<string,unknown>).provider_id)).size!==2)return review('identity_pending');
   const own=attendees.filter(a=>(a as Record<string,unknown>).is_self===1),peer=attendees.filter(a=>(a as Record<string,unknown>).is_self===0);
   if(own.length!==1||peer.length!==1||(own[0] as Record<string,unknown>).provider_id!==recorded.ownerProviderId||!object(raw.sender)||raw.sender.attendee_provider_id!==(peer[0] as Record<string,unknown>).provider_id)return review('identity_pending');
   const message=await read(()=>getMessage(raw.message_id as string,{signal}));
   const peerId=(peer[0] as Record<string,unknown>).provider_id as string,attendeeId=(peer[0] as Record<string,unknown>).id as string;
   if(!object(message)||message.object!=='Message'||message.id!==raw.message_id||message.account_id!==providerAccountId||message.chat_id!==raw.chat_id||message.sender_id!==peerId||message.sender_attendee_id!==attendeeId||
      !date(message.timestamp)||Date.parse(message.timestamp)!==Date.parse(timestamp)||message.is_sender!==0||(object(raw.sender)&&raw.sender.attendee_id!==undefined&&raw.sender.attendee_id!==attendeeId))return review();
   for(const flag of ['is_sender','is_event','hidden','deleted']){
    if(message[flag]!==0&&message[flag]!==1)return review();
    if(raw[flag]!==undefined&&raw[flag]!==message[flag])return review();
   }
   if(['is_event','hidden','deleted'].some(flag=>message[flag]===1))return ignore('non_reply_message');
   if(raw.message_type!==undefined&&raw.message_type!==message.message_type)return review();
   if(message.message_type!==undefined&&message.message_type!==null&&typeof message.message_type!=='string')return review();
   if(recorded.channel==='linkedin'&&['INVITATION','INMAIL_DECLINE','INMAIL_ACCEPT'].includes(message.message_type as string))return ignore('non_reply_message');
   if(message.message_type!==undefined&&message.message_type!==null&&!(recorded.channel==='linkedin'?['MESSAGE','INMAIL','INMAIL_REPLY']:['MESSAGE']).includes(message.message_type as string))return review();
   let alias:VerifiedReplyAlias|null;
   try{alias=structuredClone(await resolveAlias({binding:structuredClone(binding),providerAccountId,sourceId,providerId:peerId,product:recorded.product,signal}));}catch{throw new ReplyEnrichmentReadError(signal.aborted?'timeout':'unavailable');}
   await check();
   if(!alias||!same(binding,alias.binding)||alias.providerAccountId!==providerAccountId||alias.sourceId!==sourceId||alias.providerId!==peerId||alias.product!==recorded.product)return review('identity_pending');
   return normalizeV1ReplyEvent({...raw,is_sender:message.is_sender,is_event:message.is_event,hidden:message.hidden,deleted:message.deleted},{...context,channel:recorded.channel,ownerProviderId:recorded.ownerProviderId,product:recorded.product,
    chat:{binding:structuredClone(binding),providerAccountId,id:raw.chat_id as string,type:'direct',participantProviderIds:[recorded.ownerProviderId,peerId]},sender:{binding:structuredClone(binding),providerAccountId,providerId:peerId,identity:structuredClone(alias.identity)}});
  };
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([work(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ReplyEnrichmentReadError('timeout'));},deadlineMs);})]);}
  finally{clearTimeout(timer);}
 }};
}
