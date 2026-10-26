import {createHash} from 'node:crypto';
import type {AcquisitionBrief} from '@/domain/acquisition';

type Scope={organizationId:string;userId:string;requestId:string;description:string};
export class MandateGenerationRequestError extends Error{
 constructor(message:string,readonly status:409|503){super(message);}
}
/** Short-lived HTTP retry coalescing only. The saved workflow owns admission;
 * this cache grants no authority and is not a durable generation job store. */
export function createMandateGenerationRequests({now=Date.now,ttlMs=15*60*1000,maxEntries=128}:{now?:()=>number;ttlMs?:number;maxEntries?:number}={}){
 const entries=new Map<string,{digest:string;at:number;finished:boolean;pending:Promise<AcquisitionBrief>}>();
 return {async run(scope:Scope,generate:()=>Promise<AcquisitionBrief>):Promise<AcquisitionBrief>{
  for(const [id,entry]of entries)if(entry.finished&&now()-entry.at>=ttlMs)entries.delete(id);
  const key=JSON.stringify([scope.organizationId,scope.userId,scope.requestId]),digest=createHash('sha256').update(scope.description).digest('hex'),prior=entries.get(key);
  if(prior){if(prior.digest!==digest)throw new MandateGenerationRequestError('This search request already has a different brief.',409);return prior.pending;}
  if(entries.size>=maxEntries){const completed=[...entries].find(([,entry])=>entry.finished);if(completed)entries.delete(completed[0]);}
  if(entries.size>=maxEntries)throw new MandateGenerationRequestError('Mandate preparation is busy. Retry this same search shortly.',503);
  const pending=Promise.resolve().then(generate),entry={digest,at:now(),finished:false,pending};entries.set(key,entry);
  void pending.then(()=>{entry.finished=true;},()=>{if(entries.get(key)===entry)entries.delete(key);});
  return pending;
 }};
}
