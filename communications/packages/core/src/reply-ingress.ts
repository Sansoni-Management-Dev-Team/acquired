import type {LocalSyncEventProof} from './local-sync-event';
import {businessNow,type BusinessClock} from './business-clock';
import {emailBounceSemantics} from './email-bounce';
import { createHash } from 'node:crypto';
import { assertSameBinding, type CommunicationEvent, type ConnectionBinding, type AccessScope, type CanonicalIdentity } from "../../contracts/src";

export type ReplyNormalization = {kind:"event";event:CommunicationEvent} | {kind:"ignore";reason:string} | {kind:"review";code:"protocol"|"account_changed"|"identity_pending"};
export type WebhookIngressResult = {status:"accepted"|"duplicate"} | {status:"rejected";code:"unauthorized"|"invalid_request"|"too_large"|"forbidden"} | {status:"retry"};
export interface WebhookCapture {localSync?:LocalSyncEventProof;binding:ConnectionBinding;key:string;rawBody:Uint8Array;receivedAt:string}
export interface WebhookCapturePort {
 /** REQUIRED durable encrypted receipt + scoped dedupe transaction; check current grants/generation.
  * Resolve only after commit. No in-memory fallback is supplied by the coordinator. */
 capture(input:WebhookCapture):Promise<{binding:ConnectionBinding;key:string;status:"accepted"|"duplicate"}>;
}
export interface ReplyIngressOptions {binding:ConnectionBinding;validateEnvelope(raw:unknown,binding:ConnectionBinding):"valid"|"forbidden"|"invalid_request";authenticate(headers:readonly string[]):boolean;journal:WebhookCapturePort;now?:()=>number;maxBodyBytes?:number}
export interface ReplyIngress {authenticate(headers:readonly string[]):boolean;capture(input:{rawHeaders:readonly string[];rawBody:Uint8Array}):Promise<WebhookIngressResult>}
export interface ReplyMatch {scope:AccessScope;personId:string;identity:CanonicalIdentity;since:string}
export type ReplyDecision = {action:"stop";personId:string} | {action:"review";code:"protocol"|"account_changed"|"identity_pending"} | {action:"ignore";reason:string};
export interface ClaimedWebhook extends WebhookCapture {token:string}
export type WebhookClaim = {kind:"claimed";record:ClaimedWebhook} | {kind:"completed"} | {kind:"busy"} | {kind:"forbidden"};
export interface ReplyProcessorPort {
 /** Exact binding/key only; enforce current grants, generation and renewable worker lease fencing. */
 claim(input:{binding:ConnectionBinding;key:string}):Promise<WebhookClaim>;
 /** Application-side/colocated policy port, NOT a separate service DB repository.
  * MUST atomically persist event/dedupe, person-wide hold (all channel/backends), terminal receipt.
  * Recheck grant/generation/token, approved matches and enrollment cutoffs within that transaction.
  * A stale worker or changed identity must not commit a stop. Never clear existing holds.
  * A review decision must also block affected reply coverage; terminal receipt is not readiness. */
 finish(input:{record:ClaimedWebhook;event?:CommunicationEvent;eventKey?:string;eventFingerprint?:string;decision:ReplyDecision}):Promise<{binding:ConnectionBinding;key:string;committed:boolean}>;
}
export interface ReplyProcessorOptions {
  businessClock?:BusinessClock;binding:ConnectionBinding;journal:ReplyProcessorPort;normalize(raw:unknown,binding:ConnectionBinding):Promise<ReplyNormalization>;resolve(event:Extract<CommunicationEvent,{type:"message"}>):Promise<readonly ReplyMatch[]>}
export type ReplyProcessResult = {status:"processed";decision:ReplyDecision} | {status:"duplicate"|"busy"|"retry"|"forbidden"};
const object=(v:unknown):v is Record<string,unknown>=>v!==null && typeof v==='object' && !Array.isArray(v);
const fields=(v:Record<string,unknown>,keys:readonly string[])=>Object.keys(v).every(k=>keys.includes(k));
const bindingFields=['applicationId','tenantId','ownerId','connectionId','accountId','generation','channel','platform','backend'] as const;
const id=(v:unknown,max=2048):v is string=>typeof v==='string' && v.length>0 && v.length<=max && v===v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const code=(v:unknown):v is string=>typeof v==='string' && /^[a-z][a-z0-9_]{0,79}$/.test(v);
const reviewCodes=new Set(['protocol','account_changed','identity_pending']);
function date(v:unknown):v is string {
  if(typeof v!=='string')return false;
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  if(!m)return false;
  const [y,month,d,h,min,s]=m.slice(1,7).map(Number),zone=m[7];
  return y>=1000 && month>=1 && month<=12 && d>=1 && d<=new Date(Date.UTC(y,month,0)).getUTCDate() && h<=23 && min<=59 && s<=59 &&
    (zone==='Z' || (Number(zone.slice(1,3))<=23 && Number(zone.slice(4,6))<=59)) && Number.isFinite(Date.parse(v));
}
function identity(binding:ConnectionBinding,v:unknown):v is CanonicalIdentity {
  if(!object(v) || !fields(v,['kind','value']) || !id(v.value))return false;
  if(binding.channel==='email')return v.kind==='email' && v.value===v.value.toLowerCase() && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v.value);
  if(binding.channel==='whatsapp')return v.kind==='phone' && /^\+[1-9]\d{6,14}$/.test(v.value);
  if(v.kind!=='linkedin_profile')return false;
  try {const u=new URL(v.value);return u.protocol==='https:' && ['linkedin.com','www.linkedin.com'].includes(u.hostname) && /^\/in\/[^/]+\/?$/.test(u.pathname) && !u.username && !u.password && !u.port && !u.search && !u.hash;}catch{return false;}
}
function same(a:ConnectionBinding,b:ConnectionBinding):boolean {try{if(!object(b) || !fields(b,bindingFields))return false;assertSameBinding(a,b);return true;}catch{return false;}}
function parse(bytes:Uint8Array):Record<string,unknown> {
  const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  const value:unknown=JSON.parse(raw);
  if(!object(value))throw new Error('Invalid webhook envelope');
  return value;
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Fixed-position scope encoding avoids property-order/key-delimiter collisions. */
const scope=(b:ConnectionBinding)=>[b.applicationId,b.tenantId,b.ownerId,b.connectionId,b.accountId,b.generation,b.channel,b.platform,b.backend];
const protocol=():ReplyDecision=>({action:'review',code:'protocol'});
function validEvent(binding:ConnectionBinding,value:unknown,receivedAt:string):value is CommunicationEvent {
  if(object(value)&&value.type==='email_change')return binding.channel==='email'&&fields(value,['type','reference','change','recipient','occurredAt'])&&value.change==='bounce'&&object(value.reference)&&fields(value.reference,['binding','id'])&&same(binding,value.reference.binding as ConnectionBinding)&&id(value.reference.id)&&identity(binding,value.recipient)&&date(value.occurredAt)&&Date.parse(value.occurredAt)<=Date.parse(receivedAt);
  if(!object(value) || value.type!=='message' || !object(value.reference) || !fields(value.reference,['binding','id']) || !same(binding,value.reference.binding as ConnectionBinding) || !id(value.reference.id) ||
    typeof value.direction!=='string' || !['inbound','outbound','self','group'].includes(value.direction) || !identity(binding,value.sender) || !date(value.occurredAt) || Date.parse(value.occurredAt)>Date.parse(receivedAt))return false;
  if(value.conversation!==undefined && (!object(value.conversation) || !fields(value.conversation,['binding','id']) || !same(binding,value.conversation.binding as ConnectionBinding) || !id(value.conversation.id)))return false;
  return Object.keys(value).every(k=>['type','reference','conversation','direction','sender','occurredAt'].includes(k));
}

/** Capture/ack only: no inferred history completeness, reply decision or freshness advance. */
export function createReplyWebhookIngress(options:ReplyIngressOptions):ReplyIngress {
  assertSameBinding(options.binding,options.binding);
  if(!fields(options.binding as unknown as Record<string,unknown>,bindingFields))throw new Error('Invalid webhook configuration');
  const binding=structuredClone(options.binding),max=options.maxBodyBytes??262144;
  if(!Number.isSafeInteger(max) || max<1 || max>1048576)throw new Error('Invalid webhook configuration');
  const auth=options.authenticate.bind(options),validate=options.validateEnvelope.bind(options),capture=options.journal.capture.bind(options.journal),now=options.now?.bind(options)??Date.now;
  const authenticate=(headers:readonly string[])=>{try{return auth([...headers])===true;}catch{return false;}};
  return {authenticate,async capture(input){
    if(!authenticate(input.rawHeaders))return {status:'rejected',code:'unauthorized'};
    if(!(input.rawBody instanceof Uint8Array))return {status:'rejected',code:'invalid_request'};
    if(input.rawBody.byteLength>max)return {status:'rejected',code:'too_large'};
    const bytes=Uint8Array.from(input.rawBody);let raw:Record<string,unknown>;
    try{raw=parse(bytes);}catch{return {status:'rejected',code:'invalid_request'};}
    let validation:ReturnType<ReplyIngressOptions['validateEnvelope']>;
    try{validation=validate(structuredClone(raw),structuredClone(binding));}catch{return {status:'rejected',code:'invalid_request'};}
    if(validation!=='valid')return {status:'rejected',code:validation==='forbidden'?'forbidden':'invalid_request'};
    try {
      const receivedAt=new Date(now()).toISOString(),key=hash(['communications.webhook.receipt.v1',scope(binding),createHash('sha256').update(bytes).digest('hex')]);
      const result=structuredClone(await capture({binding:structuredClone(binding),key,rawBody:bytes,receivedAt}));
      if(!result || !same(binding,result.binding) || result.key!==key || !['accepted','duplicate'].includes(result.status))return {status:'retry'};
      return {status:result.status};
    }catch{return {status:'retry'};}
  }};
}

/** Application-side policy coordination. Its atomic finish requires colocated application
 * storage. A separate service database uses createWebhookEventProcessor instead, followed
 * by an application receipt/hold transaction and a service outbox acknowledgement. */
export function createReplyProcessor(options:ReplyProcessorOptions):{process(key:string):Promise<ReplyProcessResult>} {
  assertSameBinding(options.binding,options.binding);
  if(!fields(options.binding as unknown as Record<string,unknown>,bindingFields))throw new Error('Invalid reply configuration');
  const binding=structuredClone(options.binding),claim=options.journal.claim.bind(options.journal),finish=options.journal.finish.bind(options.journal),normalize=options.normalize.bind(options),resolve=options.resolve.bind(options);
  return {async process(key){
    if(!id(key,255))return {status:'retry'};
    let record:ClaimedWebhook;
    try {
      const claimed=structuredClone(await claim({binding:structuredClone(binding),key}));
      if(claimed?.kind==='completed')return {status:'duplicate'};
      if(claimed?.kind==='busy' || claimed?.kind==='forbidden')return {status:claimed.kind};
      if(claimed?.kind!=='claimed' || !claimed.record || !same(binding,claimed.record.binding) || claimed.record.key!==key ||
        !id(claimed.record.token) || !date(claimed.record.receivedAt) || !(claimed.record.rawBody instanceof Uint8Array) || claimed.record.rawBody.byteLength>1048576)return {status:'retry'};
      record=claimed.record;
    }catch{return {status:'retry'};}
    let decision:ReplyDecision,event:CommunicationEvent|undefined,eventKey:string|undefined,eventFingerprint:string|undefined;
    try {
      let raw:Record<string,unknown>|null;
      try{raw=parse(record.rawBody);}catch{raw=null;}
      if(raw===null)decision=protocol();
      else {
        const result=structuredClone(await normalize(raw,structuredClone(binding)));
        if(result?.kind==='ignore' && code(result.reason))decision={action:'ignore',reason:result.reason};
        else if(result?.kind==='review' && reviewCodes.has(result.code))decision={action:'review',code:result.code};
        else if(result?.kind!=='event' || !validEvent(binding,result.event,options.businessClock?new Date(businessNow(options.businessClock)).toISOString():record.receivedAt))decision=protocol();
        else {
          event=structuredClone(result.event);
          if(event.type==='email_change'&&event.change==='bounce'){const semantics=emailBounceSemantics(binding,event);eventKey=semantics.eventKey;eventFingerprint=semantics.fingerprint;decision={action:'ignore',reason:'delivery_failure'};}else{
          // Resolve only genuine normalized messages.
          const message=event as Extract<CommunicationEvent,{type:'message'}>;
          eventKey=hash(['communications.reply.event.v1',scope(binding),message.conversation?.id??null,message.reference.id]);
          eventFingerprint=hash(['communications.reply.content.v1',scope(binding),message.reference.id,message.conversation?.id??null,message.direction,message.sender.kind,message.sender.value,new Date(message.occurredAt).toISOString()]);
          if(message.direction!=='inbound')decision={action:'ignore',reason:'not_inbound'};
          else {
            const matches=structuredClone(await resolve(structuredClone(message)));
            const valid=Array.isArray(matches) && matches.length<=10000 && matches.every(m=>object(m) && fields(m,['scope','personId','identity','since']) && object(m.scope) && fields(m.scope,['applicationId','tenantId','ownerId']) &&
              m.scope.applicationId===binding.applicationId && m.scope.tenantId===binding.tenantId && m.scope.ownerId===binding.ownerId && id(m.personId,255) &&
              identity(binding,m.identity) && m.identity.kind===message.sender.kind && m.identity.value===message.sender.value && date(m.since));
            if(!valid)decision=protocol();
            else {
              const people=[...new Set(matches.filter(m=>Date.parse(m.since)<=Date.parse(message.occurredAt)).map(m=>m.personId))];
              decision=people.length===1?{action:'stop',personId:people[0]}:people.length>1?{action:'review',code:'identity_pending'}:{action:'ignore',reason:'unmatched'};
            }
          }
          }
        }
      }
    }catch{return {status:'retry'};}
    try {
      const result=structuredClone(await finish(structuredClone({record,decision,...(event?{event,eventKey,eventFingerprint}:{})})));
      if(!result || result.committed!==true || !same(binding,result.binding) || result.key!==key)return {status:'retry'};
      return {status:'processed',decision:structuredClone(decision)};
    }catch{return {status:'retry'};}
  }};
}
