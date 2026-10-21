import {randomUUID} from 'node:crypto';
import {types,isDeepStrictEqual} from 'node:util';
import {assertSameBinding,assertOperationMatches,type AccessScope,type ConnectionBinding,type CanonicalIdentity,type OperationSnapshot,type ProviderReference} from '../../contracts/src';
import type {DispatchBlock} from './dispatch';
import type {AdmissionChallenge,HeldApplicationAdmission,HeldApplicationPermit,ServiceAdmissionReceipt} from './send-admission';

/** Private application-authority protocol, never an alternative outreach API.
 * Authenticate its transport independently with a distinct audience/key and bind
 * the returned scope before parsing. No caller-supplied application grant exists. */
export type RemoteAuthorityRequest=
 |{method:'prepared.get';snapshot:OperationSnapshot}
 |{method:'prepared.describe';snapshot:OperationSnapshot}
 |{method:'session.open';requestId:string;challenge:AdmissionChallenge}
 |{method:'session.commit';sessionId:string;receipt:ServiceAdmissionReceipt}
 |{method:'session.abort';sessionId:string};
export type PreparedRemoteCoverage={binding:ConnectionBinding;scopeDigest:string};
export type RemoteAuthorityResponse=
 |{coverageScopes:PreparedRemoteCoverage[]|HeldApplicationPermit['coverageScopes']}
 |{kind:'blocked';outcome:DispatchBlock}
 |{kind:'held';sessionId:string;expiresAt:string;permit:Pick<HeldApplicationPermit,'permitId'|'intentDigest'|'coverageScopes'>}
 |{status:'committed'|'aborted'};
export type RemoteAuthorityTransport=(request:RemoteAuthorityRequest,signal:AbortSignal)=>Promise<unknown>;
function fail():never{throw Error('Remote application authority unavailable');}
const text=(v:unknown,max=200):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:unknown,zero=false):v is string=>typeof v==='string'&&(zero?/^(0|[1-9]\d{0,18})$/:/^[1-9]\d{0,18}$/).test(v)&&BigInt(v)<=BigInt('9223372036854775807');
const session=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{32,200}$/.test(v);
function object(v:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
 if(!v||typeof v!=='object'||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)fail();
 const fields=Object.getOwnPropertyDescriptors(v),out:Record<string,unknown>={};
 if(required.some(k=>!Object.hasOwn(fields,k))||Reflect.ownKeys(fields).some(k=>typeof k!=='string'||![...required,...optional].includes(k)||!('value'in fields[k])||!fields[k].enumerable))fail();
 for(const [k,d]of Object.entries(fields))out[k]=d.value;return out;
}
function scope(raw:unknown):AccessScope{const r=object(raw,['applicationId','tenantId','ownerId']);if(!text(r.applicationId)||!text(r.tenantId)||!text(r.ownerId))fail();return r as unknown as AccessScope;}
const bindingKeys=['applicationId','tenantId','ownerId','connectionId','accountId','generation','channel','platform','backend'];
function binding(raw:unknown,actor:AccessScope):ConnectionBinding{
 const r=object(raw,bindingKeys);for(const k of bindingKeys)if(k!=='generation'&&!text(r[k]))fail();
 if(!Number.isSafeInteger(r.generation)||Number(r.generation)<1||Number(r.generation)>2147483647)fail();
 const b=r as unknown as ConnectionBinding;assertSameBinding(b,b);
 if(b.applicationId!==actor.applicationId||b.tenantId!==actor.tenantId||b.ownerId!==actor.ownerId)fail();return b;
}
function snapshot(raw:unknown,actor:AccessScope):OperationSnapshot{
 const r=object(raw,['binding','key','operation','payloadDigest']),b=binding(r.binding,actor);
 if(!text(r.key,255)||!hex(r.payloadDigest)||!['message','invitation'].includes(r.operation as string)||r.operation==='invitation'&&b.channel!=='linkedin')fail();
 return{binding:b,key:r.key,operation:r.operation as OperationSnapshot['operation'],payloadDigest:r.payloadDigest};
}
function identity(raw:unknown,b:ConnectionBinding):CanonicalIdentity{
 const r=object(raw,['kind','value']);if(!text(r.value,2048))fail();
 if(b.channel==='email'){if(r.kind!=='email'||r.value!==r.value.toLowerCase()||! /^[^\s<>@]+@[^\s<>@]+$/.test(r.value))fail();}
 else if(b.channel==='whatsapp'){if(r.kind!=='phone'||! /^\+[1-9]\d{6,14}$/.test(r.value))fail();}
 else{if(r.kind!=='linkedin_profile')fail();let u:URL;try{u=new URL(r.value);}catch{return fail();}if(u.protocol!=='https:'||!['linkedin.com','www.linkedin.com'].includes(u.hostname)||!/^\/in\/[^/]+\/?$/.test(u.pathname)||u.username||u.password||u.port||u.search||u.hash)fail();}
 return r as unknown as CanonicalIdentity;
}
function reference(raw:unknown,b:ConnectionBinding):ProviderReference{const r=object(raw,['binding','id']),actual=binding(r.binding,b);assertSameBinding(b,actual);if(!text(r.id,2048))fail();return{binding:actual,id:r.id};}
function instant(raw:unknown):string{if(typeof raw!=='string'||raw.length>64||!Number.isFinite(Date.parse(raw))||new Date(raw).toISOString()!==raw)fail();return raw;}
function challenge(raw:unknown,actor:AccessScope):AdmissionChallenge{
 const r=object(raw,['record','claimToken','serviceRevision']),record=object(r.record,['snapshot','recipient','state'],['message','conversation','rfcMessageId']);
 const s=snapshot(record.snapshot,actor),recipient=identity(record.recipient,s.binding);
 if(record.state!=='claimed'||!text(r.claimToken)||!integer(r.serviceRevision,true)||record.rfcMessageId!==undefined&&!text(record.rfcMessageId,2048))fail();
 return{record:{snapshot:s,recipient,state:'claimed',...(record.message===undefined?{}:{message:reference(record.message,s.binding)}),...(record.conversation===undefined?{}:{conversation:reference(record.conversation,s.binding)}),...(record.rfcMessageId===undefined?{}:{rfcMessageId:record.rfcMessageId as string})},claimToken:r.claimToken,serviceRevision:r.serviceRevision};
}
function receipt(raw:unknown,actor:AccessScope):ServiceAdmissionReceipt{
 const r=object(raw,['permitId','intentDigest','journalId','admissionId','snapshot','fencingToken','serviceRevision']);
 if(!text(r.permitId)||!hex(r.intentDigest)||!text(r.journalId)||!text(r.admissionId)||!integer(r.fencingToken)||!integer(r.serviceRevision,true))fail();
 return{permitId:r.permitId,intentDigest:r.intentDigest,journalId:r.journalId,admissionId:r.admissionId,snapshot:snapshot(r.snapshot,actor),fencingToken:r.fencingToken,serviceRevision:r.serviceRevision};
}
export const parseAuthoritySnapshot=(raw:unknown,actor:AccessScope)=>snapshot(raw,scope(actor));
export const parseServiceAdmissionReceipt=(raw:unknown,actor:AccessScope)=>receipt(raw,scope(actor));
export const parseAuthorityRecipient=(raw:unknown,b:ConnectionBinding)=>identity(raw,b);
export function parseRemoteAuthorityRequest(raw:unknown,authenticatedScope:AccessScope):RemoteAuthorityRequest{
 const actor=scope(authenticatedScope),header=object(raw,['method'],['snapshot','requestId','challenge','sessionId','receipt']);
 if(header.method==='prepared.get'||header.method==='prepared.describe'){const r=object(raw,['method','snapshot']);return{method:header.method,snapshot:snapshot(r.snapshot,actor)};}
 if(header.method==='session.open'){const r=object(raw,['method','requestId','challenge']);if(typeof r.requestId!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(r.requestId))fail();return{method:'session.open',requestId:r.requestId,challenge:challenge(r.challenge,actor)};}
 if(header.method==='session.commit'){const r=object(raw,['method','sessionId','receipt']);if(!session(r.sessionId))fail();return{method:'session.commit',sessionId:r.sessionId,receipt:receipt(r.receipt,actor)};}
 if(header.method==='session.abort'){const r=object(raw,['method','sessionId']);if(!session(r.sessionId))fail();return{method:'session.abort',sessionId:r.sessionId};}return fail();
}
function block(raw:unknown):DispatchBlock{
 const r=object(raw,['status','code'],['retryAt']);if(typeof r.code!=='string')fail();
 if(r.status==='waiting'){if(!['incomplete','stale','busy','timeout','rate_limited','unavailable','identity_pending'].includes(r.code))fail();if(r.retryAt!==undefined)instant(r.retryAt);}
 else if(r.status==='review'){if(!['reconnect','account_changed','protocol','unexpected','delivery_disabled','unresolved_send','unsupported','forbidden','operation_conflict'].includes(r.code)||r.retryAt!==undefined)fail();}
 else if(r.status!=='rejected'||! /^[a-zA-Z0-9_:/.-]{1,100}$/.test(r.code)||r.retryAt!==undefined)fail();return r as unknown as DispatchBlock;
}
function coverage(raw:unknown,actor:AccessScope,full:boolean):HeldApplicationPermit['coverageScopes']|PreparedRemoteCoverage[]{
 if(!Array.isArray(raw)||types.isProxy(raw)||Object.getPrototypeOf(raw)!==Array.prototype||raw.length<1||raw.length>3)fail();
 const descriptors=Object.getOwnPropertyDescriptors(raw),values:unknown[]=[];
 if(Reflect.ownKeys(descriptors).length!==raw.length+1)fail();
 for(let index=0;index<raw.length;index++){const field=descriptors[String(index)];if(!field||!('value'in field)||!field.enumerable)fail();values.push(field.value);}
 const result=values.map(value=>{const r=object(value,full?['binding','recipient','scopeDigest','requiredSince']:['binding','scopeDigest']),b=binding(r.binding,actor);if(!hex(r.scopeDigest))fail();return full?{binding:b,scopeDigest:r.scopeDigest,recipient:identity(r.recipient,b),requiredSince:instant(r.requiredSince)}:{binding:b,scopeDigest:r.scopeDigest};});
 if(new Set(result.map(r=>JSON.stringify(r.binding))).size!==result.length||new Set(result.map(r=>r.binding.channel)).size!==result.length)fail();return result as HeldApplicationPermit['coverageScopes']|PreparedRemoteCoverage[];
}
export function parseRemoteAuthorityResponse(input:RemoteAuthorityRequest,raw:unknown,authenticatedScope:AccessScope,options:{now?:number}={}):RemoteAuthorityResponse{
 const actor=scope(authenticatedScope),request=parseRemoteAuthorityRequest(input,actor),now=options.now??Date.now();if(!Number.isSafeInteger(now)||now<0)fail();
 if(request.method==='prepared.get'||request.method==='prepared.describe'){const r=object(raw,['coverageScopes']),values=coverage(r.coverageScopes,actor,request.method==='prepared.describe');if(!values.some(v=>isDeepStrictEqual(v.binding,request.snapshot.binding)))fail();return{coverageScopes:values};}
 if(request.method==='session.open'){
  const r=object(raw,['kind'],['outcome','sessionId','expiresAt','permit']);if(r.kind==='blocked'){object(raw,['kind','outcome']);return{kind:'blocked',outcome:block(r.outcome)};}
  object(raw,['kind','sessionId','expiresAt','permit']);if(r.kind!=='held'||!session(r.sessionId))fail();const expiresAt=instant(r.expiresAt);if(Date.parse(expiresAt)<=now||Date.parse(expiresAt)>now+20000)fail();
  const p=object(r.permit,['permitId','intentDigest','coverageScopes']);if(!text(p.permitId)||!hex(p.intentDigest))fail();const values=coverage(p.coverageScopes,actor,true) as HeldApplicationPermit['coverageScopes'];
  if(!values.some(v=>isDeepStrictEqual(v.binding,request.challenge.record.snapshot.binding)&&isDeepStrictEqual(v.recipient,request.challenge.record.recipient)))fail();
  return{kind:'held',sessionId:r.sessionId,expiresAt,permit:{permitId:p.permitId,intentDigest:p.intentDigest,coverageScopes:values}};
 }
 const r=object(raw,['status']);if(r.status!==(request.method==='session.commit'?'committed':'aborted'))fail();return{status:request.method==='session.commit'?'committed':'aborted'};
}

/** Transport must authenticate the fixed actor and validate TLS/endpoint policy.
 * Every request is single-attempt; a lost COMMIT response remains uncertain. */
export function createRemoteApplicationAuthority(options:{scope:AccessScope;request:RemoteAuthorityTransport;now?:()=>number;timeoutMs?:number}):HeldApplicationAdmission&{getPreparedCoverage(snapshot:OperationSnapshot):Promise<PreparedRemoteCoverage[]>;describePreparedCoverage(snapshot:OperationSnapshot):Promise<HeldApplicationPermit['coverageScopes']>}{
 const actor=scope(options.scope),timeout=options.timeoutMs??5000,now=options.now??Date.now,transport=options.request;
 if(typeof transport!=='function'||typeof now!=='function'||!Number.isSafeInteger(timeout)||timeout<1||timeout>20000)fail();
 async function call(input:RemoteAuthorityRequest,signal:AbortSignal):Promise<RemoteAuthorityResponse>{
  const request=parseRemoteAuthorityRequest(input,actor),controller=new AbortController();if(signal.aborted)fail();
  let rejectStopped!:(e:Error)=>void;const stopped=new Promise<never>((_,reject)=>{rejectStopped=reject;});
  const abort=()=>{controller.abort();rejectStopped(Error('Remote application authority unavailable'));};
  signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,timeout);
  try{if(signal.aborted)abort();const response=await Promise.race([Promise.resolve().then(()=>{if(controller.signal.aborted)fail();return transport(structuredClone(request),controller.signal);}),stopped]);if(controller.signal.aborted||signal.aborted)fail();return parseRemoteAuthorityResponse(request,response,actor,{now:now()});}
  catch{return fail();}
  finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();}
 }
 return{
  async getPreparedCoverage(value){const result=await call({method:'prepared.get',snapshot:value},new AbortController().signal);if(!('coverageScopes'in result))fail();return result.coverageScopes.map(v=>({binding:v.binding,scopeDigest:v.scopeDigest}));},
  async describePreparedCoverage(value){const result=await call({method:'prepared.describe',snapshot:value},new AbortController().signal);if(!('coverageScopes'in result))fail();return coverage(result.coverageScopes,actor,true) as HeldApplicationPermit['coverageScopes'];},
  async open(value,signal){
   const input=parseRemoteAuthorityRequest({method:'session.open',requestId:randomUUID(),challenge:value},actor);if(input.method!=='session.open')return fail();
   const result=await call(input,signal);if(!('kind'in result))return fail();if(result.kind==='blocked')return result;
   let state:'held'|'committing'|'committed'|'aborted'|'uncertain'='held',original:ServiceAdmissionReceipt|undefined,aborting:Promise<void>|undefined;
   return{kind:'held',permit:{...result.permit,
    async commit(raw,commitSignal){
     const parsed=receipt(raw,actor);assertOperationMatches(input.challenge.record.snapshot,parsed.snapshot);
     if(parsed.permitId!==result.permit.permitId||parsed.intentDigest!==result.permit.intentDigest||parsed.serviceRevision!==input.challenge.serviceRevision)fail();
     if(state==='committed'){if(!isDeepStrictEqual(original,parsed))fail();return'committed';}
     if(state!=='held'||signal.aborted||commitSignal.aborted||now()>=Date.parse(result.expiresAt))fail();state='committing';original=parsed;
     try{await call({method:'session.commit',sessionId:result.sessionId,receipt:parsed},commitSignal);if(signal.aborted||commitSignal.aborted||state as string==='aborted'||now()>=Date.parse(result.expiresAt))fail();state='committed';return'committed';}catch{if(state as string!=='aborted')state='uncertain';return fail();}
    },
    abort(){return aborting??=(async()=>{if(state==='committed'||state==='aborted')return;state='aborted';await call({method:'session.abort',sessionId:result.sessionId},new AbortController().signal);})();},
   }};
  },
 };
}
