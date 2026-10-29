import {randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {assertOperationMatches,assertSameBinding,type ConnectionBinding,type OperationSnapshot} from '../../communications/packages/contracts/src';
import type {HeldApplicationAdmission,HeldApplicationPermit,ServiceAdmissionReceipt} from '../../communications/packages/core/src/send-admission';
import {parseRemoteAuthorityRequest,parseRemoteAuthorityResponse,type RemoteAuthorityRequest}from'../../communications/packages/core/src/remote-application-authority';
export type HostedAuthorityCommand=RemoteAuthorityRequest;
export type HostedAuthorityRegistryOptions={scope:{applicationId:string;tenantId:string;ownerId:string};admission:(binding:ConnectionBinding)=>Promise<HeldApplicationAdmission&{getPreparedCoverage(snapshot:OperationSnapshot):Promise<Array<{binding:ConnectionBinding;scopeDigest:string}>>}>;now?:()=>number;ttlMs?:number;openingTimeoutMs?:number;capacity?:number};
/** Receives only the strict authenticated wire parser's captured commands.
 * Handles refer to live application transactions, never a detached approval.
 * The finite request ledger deliberately refuses capacity rather than evicting
 * an old identity and accidentally opening the same challenge again. */
export function createHostedDemoAuthorityRegistry(options:HostedAuthorityRegistryOptions){
 const scope=structuredClone(options.scope),now=options.now??Date.now,ttl=options.ttlMs??15000,openingTimeout=options.openingTimeoutMs??ttl,capacity=options.capacity??4096;
 const unavailable=():never=>{throw Error('Hosted authority unavailable');};
 if(scope.applicationId!=='acquire'||![scope.tenantId,scope.ownerId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200&&v===v.trim())||!Number.isSafeInteger(ttl)||ttl<100||ttl>20000||!Number.isSafeInteger(openingTimeout)||openingTimeout<100||openingTimeout>30000||!Number.isSafeInteger(capacity)||capacity<1||capacity>10000)unavailable();
 type OpenResponse={kind:'held';sessionId:string;expiresAt:string;permit:Pick<HeldApplicationPermit,'permitId'|'intentDigest'|'coverageScopes'>}|Extract<Awaited<ReturnType<HeldApplicationAdmission['open']>>,{kind:'blocked'}>;
 type Entry={request:Extract<HostedAuthorityCommand,{method:'session.open'}>;controller:AbortController;expiresAt:number;timer:ReturnType<typeof setTimeout>;state:'opening'|'held'|'committing'|'committed'|'closed';open:Promise<OpenResponse>;permit?:HeldApplicationPermit;abort?:Promise<void>;sessionId?:string;receipt?:ServiceAdmissionReceipt;commit?:Promise<{status:'committed'}>;detach:()=>void};
 const requests=new Map<string,Entry>(),sessions=new Map<string,Entry>();let closed=false,closing:Promise<void>|undefined;
 function diagnostic(entry:Entry,stage:'binding.resolve'|'admission.open'|'response'|'cancel',outcome:'start'|'complete'|'held'|'blocked'|'error'|'closed',started?:number){
  try{console.info('hosted-authority',JSON.stringify({timestamp:new Date().toISOString(),requestId:entry.request.requestId,stage,outcome,...(started===undefined?{}:{elapsedMs:Math.max(0,Date.now()-started)})}));}catch{/* Diagnostics never change authority. */}
 }
 function owned(binding:ConnectionBinding){assertSameBinding(binding,binding);if(binding.applicationId!==scope.applicationId||binding.tenantId!==scope.tenantId||binding.ownerId!==scope.ownerId||binding.backend!=='unipile')unavailable();}
 function cancel(entry:Entry){if(entry.state!=='closed'&&entry.state!=='committed')diagnostic(entry,'cancel','closed');entry.controller.abort();clearTimeout(entry.timer);entry.detach();if(entry.state!=='committed')entry.state='closed';if(entry.permit&&!entry.abort)entry.abort=Promise.resolve().then(()=>entry.permit!.abort()).then(()=>undefined,()=>undefined);return entry.abort??Promise.resolve();}
 function current(entry:Entry){if(closed||entry.controller.signal.aborted||now()>=entry.expiresAt||entry.state==='closed'){void cancel(entry);unavailable();}}
 async function open(command:Extract<HostedAuthorityCommand,{method:'session.open'}>,signal:AbortSignal):Promise<OpenResponse>{
  owned(command.challenge.record.snapshot.binding);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(command.requestId))unavailable();
  const old=requests.get(command.requestId);if(old){if(!isDeepStrictEqual(command,old.request))unavailable();current(old);return structuredClone(await old.open);}
  if(requests.size>=capacity)unavailable();
  const entry={} as Entry;Object.assign(entry,{request:structuredClone(command),controller:new AbortController(),expiresAt:now()+openingTimeout,state:'opening'});
  const stopped=()=>{void cancel(entry);};entry.detach=()=>signal.removeEventListener('abort',stopped);entry.timer=setTimeout(stopped,openingTimeout);entry.timer.unref?.();signal.addEventListener('abort',stopped,{once:true});requests.set(command.requestId,entry);
  entry.open=(async()=>{let stage:'binding.resolve'|'admission.open'='binding.resolve';let started=Date.now();try{
   diagnostic(entry,stage,'start');
   const authority=await options.admission(structuredClone(command.challenge.record.snapshot.binding));diagnostic(entry,stage,'complete',started);current(entry);
   stage='admission.open';started=Date.now();diagnostic(entry,stage,'start');
   const result=await authority.open(structuredClone(command.challenge),entry.controller.signal);diagnostic(entry,stage,result.kind,started);
   if(result.kind==='blocked'){await cancel(entry);diagnostic(entry,'response','blocked');return structuredClone(result);}
   entry.permit=result.permit;
   if(closed||entry.controller.signal.aborted||now()>=entry.expiresAt){await cancel(entry);unavailable();}
   // Opening is acquisition, not a detached permission. A successful open gets
   // one bounded held window; replays never renew it.
   clearTimeout(entry.timer);entry.expiresAt=now()+ttl;entry.timer=setTimeout(stopped,ttl);entry.timer.unref?.();
   const permit={permitId:result.permit.permitId,intentDigest:result.permit.intentDigest,coverageScopes:structuredClone(result.permit.coverageScopes)};
   for(const coverage of permit.coverageScopes)owned(coverage.binding);
   if(typeof result.permit.commit!=='function'||typeof result.permit.abort!=='function'||!permit.permitId||!/^[a-f0-9]{64}$/.test(permit.intentDigest)||permit.coverageScopes.length<1||permit.coverageScopes.length>3)unavailable();
   entry.sessionId=randomBytes(32).toString('base64url');
   const response={kind:'held' as const,sessionId:entry.sessionId,expiresAt:new Date(entry.expiresAt).toISOString(),permit};
   parseRemoteAuthorityResponse(command,response,scope,{now:now()});entry.state='held';sessions.set(entry.sessionId,entry);diagnostic(entry,'response','held');return response;
  }catch{diagnostic(entry,stage,'error',started);await cancel(entry);diagnostic(entry,'response','error');return unavailable();}})();
  return structuredClone(await entry.open);
 }
 async function execute(raw:HostedAuthorityCommand,signal:AbortSignal):Promise<unknown>{
  if(closed||signal.aborted)unavailable();
  try{
   const command=parseRemoteAuthorityRequest(raw,scope);
   if(command.method==='prepared.describe')return unavailable();
   if(command.method==='prepared.get'){owned(command.snapshot.binding);const authority=await options.admission(command.snapshot.binding);if(closed||signal.aborted)unavailable();const coverageScopes=structuredClone(await authority.getPreparedCoverage(command.snapshot));for(const coverage of coverageScopes)owned(coverage.binding);return parseRemoteAuthorityResponse(command,{coverageScopes},scope,{now:now()});}
   if(command.method==='session.open')return await open(command,signal);
   const entry=sessions.get(command.sessionId)??unavailable();
   if(command.method==='session.abort'){await cancel(entry);return{status:'aborted'};}
   const receipt=command.receipt;owned(receipt.snapshot.binding);assertOperationMatches(entry.request.challenge.record.snapshot,receipt.snapshot);
   if(receipt.permitId!==entry.permit!.permitId||receipt.intentDigest!==entry.permit!.intentDigest||receipt.serviceRevision!==entry.request.challenge.serviceRevision)unavailable();
   if(entry.receipt){if(!isDeepStrictEqual(receipt,entry.receipt))unavailable();if(entry.state==='committed')return{status:'committed'};if(entry.commit&&entry.state==='committing')return await entry.commit;unavailable();}
   current(entry);entry.receipt=structuredClone(receipt);entry.state='committing';
   const abort=()=>{void cancel(entry);};signal.addEventListener('abort',abort,{once:true});
   entry.commit=(async()=>{try{
    const status=await entry.permit!.commit(structuredClone(receipt),entry.controller.signal);
    if(status!=='committed'||entry.controller.signal.aborted||closed||now()>=entry.expiresAt)unavailable();
    entry.state='committed';clearTimeout(entry.timer);entry.detach();return{status:'committed' as const};
   }catch{await cancel(entry);return unavailable();}finally{signal.removeEventListener('abort',abort);}})();return await entry.commit;
  }catch{return unavailable();}
 }
 return{execute,close(){return closing??=(async()=>{closed=true;await Promise.all([...requests.values()].map(async entry=>{await cancel(entry);await entry.open.catch(()=>undefined);await entry.commit?.catch(()=>undefined);await cancel(entry);}));})();}};
}
