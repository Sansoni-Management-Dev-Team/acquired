import type {AgentDemoParticipantsRequest,AgentDemoParticipantsResult} from './agent-demo-client';
import {createHash} from 'node:crypto';
import {z} from 'zod';

/** Stable UUIDv8 identifies the original completed people job across event
 * retries; polling time and personal contact facts never enter the key. */
export function demoResearchPreparationKey(operationId:string,jobId:string){
 z.string().uuid().parse(operationId);z.string().uuid().parse(jobId);
 const b=createHash('sha256').update('acquire.demo.people-preparation.v1:'+operationId+':'+jobId).digest().subarray(0,16);
 b[6]=(b[6]&15)|128;b[8]=(b[8]&63)|128;
 const h=b.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

export type AgentDemoPreparation={kind:'prepared';workflowExecutionId?:string|null;manifest:AgentDemoParticipantsRequest;run:{id:string;runId:string;senders:{channel:string;bindingId:string;bindingDigest:string;accountId:string;providerAccountId:string;sourceId:string}[]}};
export interface AgentDemoProvisioningPort{
 /** Persist the exact metadata-only request before external I/O, or return its
  * existing immutable receipt. Validate current membership, mode and sources. */
 plan(mandateId:string,requestKey:string):Promise<AgentDemoPreparation|{kind:'complete';count:number}>;
 /** Recheck membership, current source CAS and the exact original run/accounts;
  * save receipt+all mappings atomically. Never update real source contacts. */
 commit(prepared:AgentDemoPreparation,result:AgentDemoParticipantsResult):Promise<number>;
}
type Prepare=(manifest:AgentDemoParticipantsRequest)=>Promise<{kind:'real'}|{kind:'demo';result:AgentDemoParticipantsResult}>;
/** Planning and commit use separate transactions: no DB lock is held across a
 * network request. An unknown response reuses the persisted request on retry. */
export async function provisionAgentDemoContacts(store:AgentDemoProvisioningPort,mandateId:string,requestKey:string,prepare:Prepare){
 const planned=await store.plan(mandateId,requestKey);
 if(planned.kind==='complete')return {prepared:planned.count,outreachReady:false as const,replayed:true};
 const response=await prepare(planned.manifest);
 if(response.kind!=='demo')throw Error('No verified demo recipients were returned.');
 const result=response.result;
 if(result.runId!==planned.run.runId||result.accounts.length!==planned.run.senders.length||result.accounts.some(account=>!planned.run.senders.some(sender=>sender.channel===account.channel&&sender.providerAccountId===account.providerAccountId&&sender.sourceId===account.sourceId)))throw Error('The demo service does not match the recorded accounts. No outreach was enabled.');
 const prepared=await store.commit(planned,result);
 // Stage A prepares aliases only. Final route/account admission remains a
 // separate invariant; a successful provisioning response never grants send.
 return {prepared,outreachReady:false as const,replayed:result.replayed};
}
