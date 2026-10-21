import {emailBounceSemantics} from './email-bounce';
import type { ConnectionBinding } from '../../contracts/src';
import { parseEventPayload,type EventPayload } from './event-codec';
import { assertSameBinding } from '../../contracts/src';
import { createHash } from 'node:crypto';
import { types } from 'node:util';

export interface OutboxDelivery { binding:ConnectionBinding; subscriberId:string; eventId:string; sourceNamespace:string; sourceEventKey:string; payload:EventPayload; token:string }
export interface ApplicationReplyReceipt { binding:ConnectionBinding; subscriberId:string; eventId:string; fingerprint:string; status:'committed'|'duplicate' }
export interface EventOutboxPort {
  claim():Promise<{kind:'claimed';delivery:OutboxDelivery}|{kind:'busy'|'forbidden'}>;
  acknowledge(input:{delivery:OutboxDelivery;receipt:ApplicationReplyReceipt}):Promise<{status:'acknowledged'|'duplicate'|'rejected'}>;
}
export interface OutboxDeliveryWorkerOptions {
  binding:ConnectionBinding; subscriberId:string; outbox:EventOutboxPort;
  /** Trusted authenticated application boundary. Resolve only after its receipt/policy transaction
   * commits; an application review is committed evidence too, never an instruction to clear holds. */
  apply(delivery:OutboxDelivery,signal:AbortSignal):Promise<ApplicationReplyReceipt>;
  timeoutMs?:number;
}
export type OutboxWorkResult={status:'delivered'|'duplicate'|'busy'|'forbidden'|'retry'};
const bindingFields=['applicationId','tenantId','ownerId','connectionId','accountId','generation','channel','platform','backend'] as const;
function fail():never{throw Error('Invalid outbox delivery');}
function record(v:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
  if(!v||typeof v!=='object'||Array.isArray(v)||types.isProxy(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail();
  const d=Object.getOwnPropertyDescriptors(v),result:Record<string,unknown>={};
  if(required.some(k=>!Object.hasOwn(d,k))||Reflect.ownKeys(d).some(k=>typeof k!=='string'||![...required,...optional].includes(k)||!('value' in d[k])||!d[k].enumerable))fail();
  for(const k of Object.keys(d))result[k]=d[k].value;return result;
}
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=255&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const eventId=(v:unknown):v is string=>typeof v==='string'&&/^[1-9]\d{0,18}$/.test(v)&&BigInt(v)<=BigInt('9223372036854775807');
function binding(v:unknown):ConnectionBinding{
  const raw=record(v,bindingFields);for(const k of bindingFields)if(k!=='generation'&&!id(raw[k]))fail();
  const b=Object.fromEntries(bindingFields.map(k=>[k,raw[k]])) as unknown as ConnectionBinding;assertSameBinding(b,b);return b;
}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function delivery(v:unknown,expected:ConnectionBinding,subscriberId:string):OutboxDelivery{
  const r=record(v,['binding','subscriberId','eventId','sourceNamespace','sourceEventKey','payload','token']);
  const b=binding(r.binding);assertSameBinding(expected,b);
  if(r.subscriberId!==subscriberId||!eventId(r.eventId)||!id(r.token)||!hex(r.sourceEventKey))fail();
  const p=parseEventPayload({binding:b,key:r.sourceEventKey},r.payload),scope=bindingFields.map(k=>b[k]);
  if(p.outcome.kind==='event'){
    const e=p.outcome.event;if(e.type==='email_change'&&e.change==='bounce'){const semantic=emailBounceSemantics(b,e);if(r.sourceNamespace!=='email_bounce/v1'||r.sourceEventKey!==semantic.eventKey||p.fingerprint!==semantic.fingerprint)fail();}
    else{if(r.sourceNamespace!=='reply_message/v1'||e.type!=='message')fail();
    if(r.sourceEventKey!==hash(['communications.reply.event.v1',scope,e.conversation?.id??null,e.reference.id])||p.fingerprint!==hash(['communications.reply.content.v1',scope,e.reference.id,e.conversation?.id??null,e.direction,e.sender.kind,e.sender.value,new Date(e.occurredAt).toISOString()]))fail();
    }
  }else if(r.sourceNamespace!=='reply_review/v1'||p.fingerprint!==hash(['communications.reply.review.v1',scope,r.sourceEventKey,p.outcome.code]))fail();
  return {binding:b,subscriberId,eventId:r.eventId,sourceNamespace:r.sourceNamespace as string,sourceEventKey:r.sourceEventKey,payload:p,token:r.token};
}
function receipt(v:unknown,d:OutboxDelivery):ApplicationReplyReceipt{
  const r=record(v,['binding','subscriberId','eventId','fingerprint','status']),b=binding(r.binding);assertSameBinding(d.binding,b);
  if(r.subscriberId!==d.subscriberId||r.eventId!==d.eventId||r.fingerprint!==d.payload.fingerprint||(r.status!=='committed'&&r.status!=='duplicate'))fail();
  return {binding:b,subscriberId:d.subscriberId,eventId:d.eventId,fingerprint:d.payload.fingerprint,status:r.status};
}
export function createOutboxDeliveryWorker(options:OutboxDeliveryWorkerOptions):{run():Promise<OutboxWorkResult>}{
  let fixed:ConnectionBinding;
  const timeout=options.timeoutMs??20000;
  try{fixed=binding(options.binding);if(!id(options.subscriberId)||!Number.isSafeInteger(timeout)||timeout<1||timeout>60000||typeof options.outbox?.claim!=='function'||typeof options.outbox?.acknowledge!=='function'||typeof options.apply!=='function')fail();}
  catch{throw Error('Invalid outbox worker configuration');}
  const subscriberId=options.subscriberId,claim=options.outbox.claim.bind(options.outbox),ack=options.outbox.acknowledge.bind(options.outbox),apply=options.apply.bind(options);
  return {async run(){
    const controller=new AbortController(),deadline=performance.now()+timeout;
    const timer=setTimeout(()=>controller.abort(),timeout);
    async function bounded<T>(promise:Promise<T>):Promise<T>{
      if(controller.signal.aborted||performance.now()>=deadline){
        // The callback may block the timer and return an already rejected promise.
        // Observe that rejection even when no remaining budget permits awaiting it.
        void promise.catch(()=>{});fail();
      }
      let abort!:()=>void;
      const stopped=new Promise<never>((_resolve,reject)=>{abort=()=>reject(Error('Delivery deadline reached'));controller.signal.addEventListener('abort',abort,{once:true});});
      try{const result=await Promise.race([promise,stopped]);if(controller.signal.aborted||performance.now()>=deadline)fail();return result;}
      finally{controller.signal.removeEventListener('abort',abort);}
    }
    try{
      const result=record(await bounded(claim()),['kind'],['delivery']);
      if(result.kind==='busy'||result.kind==='forbidden')return {status:result.kind};
      if(result.kind!=='claimed')fail();const d=delivery(result.delivery,fixed,subscriberId);
      const committed=receipt(await bounded(apply(structuredClone(d),controller.signal)),d);
      const acknowledged=record(await bounded(ack({delivery:structuredClone(d),receipt:committed})),['status']);
      if(acknowledged.status==='acknowledged')return {status:committed.status==='duplicate'?'duplicate':'delivered'};
      if(acknowledged.status==='duplicate')return {status:'duplicate'};
      return {status:'retry'};
    }catch{return {status:'retry'};}
    finally{clearTimeout(timer);controller.abort();}
  }};
}
