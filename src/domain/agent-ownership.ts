import {z} from 'zod';
import {outreachEmail} from './outreach-contact';
const uuid=z.string().uuid(),revision=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const agentDriverSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('agent'),responsibilityId:uuid}).strict(),
 z.object({kind:z.literal('sequence'),enrolmentId:uuid,runtime:z.enum(['n8n','legacy']),generation:revision}).strict(),
 z.object({kind:z.literal('human'),userId:z.string().trim().min(1).max(200)}).strict(),
]);
export type AgentDriver=z.infer<typeof agentDriverSchema>;
export type AgentExecutionOwner={driver:AgentDriver;epoch:number;revision:number;status:'active'|'paused'|'quiescing'|'held'|'complete';contextRevision:string;pendingDriver?:AgentDriver;retiredSequenceIds?:string[]};
export function canonicalAgentPersonKeys(input:{contactId:string;email:string;firmablePersonId?:string|null}){
 const contact=uuid.parse(input.contactId),email=outreachEmail(input.email);if(!email)throw new Error('A valid canonical email is required');
 const keys=['contact:'+contact,'email:'+email];
 if(input.firmablePersonId)keys.push('firmable:'+z.string().trim().min(1).max(200).parse(input.firmablePersonId));
 return [...new Set(keys)].sort();
}
/** Pure policy; storage must resolve canonical aliases and obtain the shared
 * organisation gate before evaluating/committing this transition. */
export function beginAgentHandover(owner:AgentExecutionOwner,target:unknown,expected:{epoch:number;revision:number;contextRevision:string}):AgentExecutionOwner{
 const driver=agentDriverSchema.parse(target);revision.parse(owner.epoch);revision.parse(owner.revision);
 if(owner.epoch!==expected.epoch||owner.revision!==expected.revision||owner.contextRevision!==expected.contextRevision)throw new Error('Conversation ownership or context changed');
 if(owner.status==='quiescing')throw new Error('A handover is already pending');
 if(driver.kind==='sequence'&&(owner.retiredSequenceIds?.includes(driver.enrolmentId)||owner.driver.kind==='sequence'&&owner.driver.enrolmentId===driver.enrolmentId))throw new Error('Use a fresh sequence enrolment; old callbacks must remain fenced');
 const retiredSequenceIds=[...new Set([...(owner.retiredSequenceIds??[]),...(owner.driver.kind==='sequence'?[owner.driver.enrolmentId]:[])])];
 return {...owner,retiredSequenceIds,status:'quiescing',pendingDriver:driver,epoch:revision.parse(owner.epoch+1),revision:revision.parse(owner.revision+1)};
}
export function commitAgentHandover(owner:AgentExecutionOwner,expectedEpoch:number,proof:{unknownSends:number;inFlightSends:number;previousDriverQuiesced:boolean}):AgentExecutionOwner{
 if(owner.status!=='quiescing'||!owner.pendingDriver||owner.epoch!==expectedEpoch)throw new Error('Handover changed or unavailable');
 if(!proof.previousDriverQuiesced||proof.unknownSends!==0||proof.inFlightSends!==0)throw new Error('Reconcile and quiesce the previous driver before committing handover');
 const {pendingDriver,...current}=owner;
 return {...current,driver:pendingDriver,status:'active',epoch:revision.parse(owner.epoch+1),revision:revision.parse(owner.revision+1)};
}
/** Ownership check only, never a substitute for permission/budget/transport admission. */
export function ownsAgentExecution(owner:AgentExecutionOwner,driver:AgentDriver,epoch:number){
 if(owner.status!=='active'||owner.driver.kind==='human'||owner.epoch!==epoch)return false;
 if(driver.kind==='sequence'&&owner.retiredSequenceIds?.includes(driver.enrolmentId))return false;
 const a=agentDriverSchema.parse(owner.driver),b=agentDriverSchema.parse(driver);
 return JSON.stringify(a)===JSON.stringify(b);
}
