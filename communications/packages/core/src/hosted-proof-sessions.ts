import {randomBytes,createHash} from 'node:crypto';
import {types} from 'node:util';
import {assertSameBinding,type AccessScope,type Coverage,type ConnectionBinding} from '../../contracts/src';
import {parseAuthoritySnapshot} from './remote-application-authority';
import {parseEventPayload} from './event-codec';
import type {OutboxDelivery} from './outbox-delivery';
export interface HostedCoverageProof{coverage:Coverage;scopeDigest:string;serviceRevision:string;subscriberId:string;sessionId:string;expiresAt:string}
export type HostedEventDelivery=Omit<OutboxDelivery,'token'>&{sessionId:string;expiresAt:string};
export interface CoverageRevalidation{proofDigest:string;sessionId:string;binding:ConnectionBinding;scopeDigest:string;serviceRevision:string}
export interface EventRevalidation{proofDigest:string;sessionId:string;binding:ConnectionBinding;subscriberId:string;eventId:string;fingerprint:string}
function fail():never{throw Error('Hosted evidence unavailable');}
function record(raw:unknown,keys:readonly string[]):Record<string,unknown>{if(!raw||typeof raw!=='object'||types.isProxy(raw)||Object.getPrototypeOf(raw)!==Object.prototype)fail();const fields=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(fields).length!==keys.length||keys.some(k=>!fields[k]||!('value'in fields[k])||!fields[k].enumerable))fail();return Object.fromEntries(keys.map(k=>[k,fields[k].value]));}
const id=(v:unknown,max=200):v is string=>typeof v==='string'&&!!v&&v.length<=max&&v.trim()===v&&!/[\u0000-\u001f\u007f]/.test(v);
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const decimal=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9]\d{0,18})$/.test(v)&&BigInt(v)<=BigInt('9223372036854775807');
const iso=(v:unknown):v is string=>typeof v==='string'&&v.length<=64&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
function binding(raw:unknown,scope:AccessScope){return parseAuthoritySnapshot({binding:raw,key:'evidence-validation',operation:'message',payloadDigest:'0'.repeat(64)},scope).binding;}
export function parseHostedCoverageProof(raw:unknown,scope:AccessScope):HostedCoverageProof{
 const r=record(raw,['coverage','scopeDigest','serviceRevision','subscriberId','sessionId','expiresAt']),c=record(r.coverage,['binding','scope','from','through','observedAt','complete','initialSyncComplete','invalidated']),b=binding(c.binding,scope);
 if(!id(c.scope)||!iso(c.from)||!iso(c.through)||!iso(c.observedAt)||Date.parse(c.from)>Date.parse(c.through)||Date.parse(c.through)>Date.parse(c.observedAt)||c.complete!==true||c.initialSyncComplete!==true||c.invalidated!==false||!hex(r.scopeDigest)||!decimal(r.serviceRevision)||!id(r.subscriberId)||!id(r.sessionId)||! /^[A-Za-z0-9_-]{32,200}$/.test(r.sessionId)||!iso(r.expiresAt))fail();
 return{coverage:{binding:b,scope:c.scope,from:c.from,through:c.through,observedAt:c.observedAt,complete:true,initialSyncComplete:true,invalidated:false},scopeDigest:r.scopeDigest,serviceRevision:r.serviceRevision,subscriberId:r.subscriberId,sessionId:r.sessionId,expiresAt:r.expiresAt};
}
export function parseHostedEventDelivery(raw:unknown,scope:AccessScope):HostedEventDelivery{
 const r=record(raw,['binding','subscriberId','eventId','sourceNamespace','sourceEventKey','payload','sessionId','expiresAt']),b=binding(r.binding,scope);
 if(!id(r.subscriberId)||!decimal(r.eventId)||r.eventId==='0'||!['reply_message/v1','reply_review/v1'].includes(r.sourceNamespace as string)||!hex(r.sourceEventKey)||!id(r.sessionId)||! /^[A-Za-z0-9_-]{32,200}$/.test(r.sessionId)||!iso(r.expiresAt))fail();
 return{binding:b,subscriberId:r.subscriberId,eventId:r.eventId,sourceNamespace:r.sourceNamespace as string,sourceEventKey:r.sourceEventKey,payload:parseEventPayload({binding:b,key:r.sourceEventKey},r.payload),sessionId:r.sessionId,expiresAt:r.expiresAt};
}
export function hostedProofDigest(input:HostedCoverageProof|HostedEventDelivery):string{
 let nodes=0;function canonical(value:unknown,depth=0):unknown{if(++nodes>10000||depth>32)fail();if(value===null||['string','boolean'].includes(typeof value))return value;if(typeof value==='number'){if(!Number.isFinite(value))fail();return value;}if(!value||typeof value!=='object'||types.isProxy(value))fail();const fields=Object.getOwnPropertyDescriptors(value);if(Array.isArray(value)){if(value.length>1000||Reflect.ownKeys(fields).length!==value.length+1)fail();return Array.from({length:value.length},(_,i)=>{const d=fields[String(i)];if(!d||!('value'in d)||!d.enumerable)fail();return canonical(d.value,depth+1);});}if(Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(fields).some(k=>typeof k!=='string'||!('value'in fields[k])||!fields[k].enumerable))fail();return Object.fromEntries(Object.keys(fields).sort().map(k=>[k,canonical(fields[k].value,depth+1)]));}
 return createHash('sha256').update('communications.hosted-evidence.v1\0').update(JSON.stringify(canonical(input))).digest('hex');
}
export function createHostedProofSessions(options:{now?:()=>number;ttlMs?:number;maxSessions?:number}={}){
 const now=options.now??Date.now,ttl=options.ttlMs??20000,max=options.maxSessions??100;if(typeof now!=='function'||!Number.isSafeInteger(ttl)||ttl<1||ttl>20000||!Number.isSafeInteger(max)||max<1||max>1000)fail();
 type Session={wire:HostedCoverageProof|HostedEventDelivery;controller:AbortController;until:number;verify:()=>Promise<void>;dispose:()=>void};
 const sessions=new Map<string,Session>();let closed=false;
 async function held<T>(wire:Omit<HostedCoverageProof,'sessionId'|'expiresAt'>|Omit<HostedEventDelivery,'sessionId'|'expiresAt'>,verify:()=>Promise<void>,parent:AbortSignal,work:(wire:HostedCoverageProof|HostedEventDelivery,signal:AbortSignal)=>Promise<T>):Promise<T>{
  if(closed||parent.aborted||sessions.size>=max)fail();const started=now();if(!Number.isSafeInteger(started)||started<0)fail();const sessionId=randomBytes(32).toString('base64url'),until=started+ttl,controller=new AbortController(),value={...structuredClone(wire),sessionId,expiresAt:new Date(until).toISOString()};
  const abort=()=>{controller.abort();sessions.delete(sessionId);},timer=setTimeout(abort,ttl),dispose=()=>{clearTimeout(timer);parent.removeEventListener('abort',abort);abort();};
  sessions.set(sessionId,{wire:value,controller,until,verify,dispose});parent.addEventListener('abort',abort,{once:true});if(parent.aborted)abort();
  try{if(controller.signal.aborted)fail();return await work(structuredClone(value),controller.signal);}finally{dispose();}
 }
 function active(sessionId:string,scope:AccessScope){const s=sessions.get(sessionId);if(!s||s.controller.signal.aborted||now()>=s.until)return null;const b='coverage'in s.wire?s.wire.coverage.binding:s.wire.binding;if(b.applicationId!==scope.applicationId||b.tenantId!==scope.tenantId||b.ownerId!==scope.ownerId)return null;return s;}
 return{
  async withCoverage<T>(proof:{coverage:Coverage;scopeDigest:string;serviceRevision:string;signal:AbortSignal;revalidate():Promise<void>},subscriberId:string,work:(wire:HostedCoverageProof,signal:AbortSignal)=>Promise<T>){const b=proof.coverage.binding,scope={applicationId:b.applicationId,tenantId:b.tenantId,ownerId:b.ownerId};parseHostedCoverageProof({coverage:proof.coverage,scopeDigest:proof.scopeDigest,serviceRevision:proof.serviceRevision,subscriberId,sessionId:'x'.repeat(43),expiresAt:new Date(now()+ttl).toISOString()},scope);return held({coverage:proof.coverage,scopeDigest:proof.scopeDigest,serviceRevision:proof.serviceRevision,subscriberId},proof.revalidate.bind(proof),proof.signal,(wire,signal)=>work(wire as HostedCoverageProof,signal));},
  async withEvent<T>(delivery:OutboxDelivery,verify:()=>Promise<boolean>,work:(wire:HostedEventDelivery,signal:AbortSignal)=>Promise<T>,parentSignal:AbortSignal=new AbortController().signal){if(await verify()!==true)fail();const{token:ignored,...data}=delivery;void ignored;const scope={applicationId:delivery.binding.applicationId,tenantId:delivery.binding.tenantId,ownerId:delivery.binding.ownerId};parseHostedEventDelivery({...data,sessionId:'x'.repeat(43),expiresAt:new Date(now()+ttl).toISOString()},scope);return held(data,async()=>{if(await verify()!==true)fail();},parentSignal,(wire,signal)=>work(wire as HostedEventDelivery,signal));},
  async revalidateCoverage(scope:AccessScope,input:CoverageRevalidation){try{const s=active(input.sessionId,scope);if(!s||!hex(input.proofDigest)||hostedProofDigest(s.wire)!==input.proofDigest||!('coverage'in s.wire)||s.wire.scopeDigest!==input.scopeDigest||s.wire.serviceRevision!==input.serviceRevision)return false;assertSameBinding(s.wire.coverage.binding,input.binding);await s.verify();return active(input.sessionId,scope)===s;}catch{return false;}},
  async revalidateEvent(scope:AccessScope,input:EventRevalidation){try{const s=active(input.sessionId,scope);if(!s||!hex(input.proofDigest)||hostedProofDigest(s.wire)!==input.proofDigest||!('payload'in s.wire)||s.wire.eventId!==input.eventId||s.wire.subscriberId!==input.subscriberId||s.wire.payload.fingerprint!==input.fingerprint)return false;assertSameBinding(s.wire.binding,input.binding);await s.verify();return active(input.sessionId,scope)===s;}catch{return false;}},
  async close(){closed=true;for(const session of [...sessions.values()])session.dispose();},
 };
}
