// Framework-independent server loader: native workers and HTTP routes share
// the explicit transaction/actor boundary; no ambient client or environment.
import {z} from 'zod';
import {mandateExecutionContextSchema,mandateExecutionOriginInputSchema,mandateResearchContextSchema,type MandateExecutionContext,type MandateExecutionOriginInput} from '@/domain/mandate-execution-context';
import{executionContextDigest}from'./mandate-execution-policy';
export{executionContextDigest,assertNewEffectPermitted}from'./mandate-execution-policy';
import type {CampaignActor} from '@/db/campaign-client';
type ContextTransaction={query(text:string,values?:unknown[]):Promise<{rows:Array<Record<string,unknown>>}>};
const actorSchema=z.object({organizationId:z.string().min(1).max(200),userId:z.string().min(1).max(200)}).strict();
/** Transaction must already hold its normal restricted role, membership and
 * tenant writer gate. SQL derives origin and projection; callers supply no facts. */
export async function loadMandateExecutionContext(tx:ContextTransaction,input:{actor:CampaignActor;origin:MandateExecutionOriginInput}):Promise<MandateExecutionContext>{
 const actor=actorSchema.parse(input.actor),origin=mandateExecutionOriginInputSchema.parse(input.origin);
 const rows=(await tx.query('SELECT public.agent_load_mandate_execution_context($1::jsonb,$2::text,$3::text) AS context',[JSON.stringify(origin),actor.organizationId,actor.userId])).rows;
 if(rows.length!==1)throw Error('Current mandate execution context unavailable');const c=mandateExecutionContextSchema.parse(rows[0].context);const expectedSource=origin.kind==='agent'?origin.operationId:origin.kind==='campaign'?origin.attemptId:origin.kind==='draft'?origin.messageId:origin.threadId;if(c.origin.kind!==origin.kind||c.origin.sourceId!==expectedSource||origin.kind==='campaign'&&c.origin.enrolmentId!==origin.enrolmentId||origin.kind==='agent_target'&&c.contact.sourceId!==origin.contactId||c.mode==='real'&&c.identityScope.id!==actor.organizationId)throw Error('Execution context differs from original owned source');const{manifestDigest,...preimage}=c;if(executionContextDigest(preimage)!==manifestDigest)throw Error('Mandate execution context proof differs');return c;
}
/** Real research remains independent of mock account setup and contact mapping. */
export async function loadMandateResearchContext(tx:ContextTransaction,input:{actor:CampaignActor;mandateId:string}){const actor=actorSchema.parse(input.actor),id=z.string().uuid().parse(input.mandateId);const rows=(await tx.query('SELECT public.agent_load_mandate_research_context($1::uuid,$2::text,$3::text) AS context',[id,actor.organizationId,actor.userId])).rows;if(rows.length!==1)throw Error('Owned research context unavailable');const context=mandateResearchContextSchema.parse(rows[0].context);if(context.mandateId!==id||context.mode==='real'&&context.identityScope.id!==actor.organizationId)throw Error('Research context differs from owned mandate');return context;}
