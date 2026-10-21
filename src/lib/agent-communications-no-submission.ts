import{installAgentBusinessTimeSql,type AgentBusinessDbOptions}from'./agent-business-time-sql';
import {z} from 'zod';
import {withCampaignDb,type CampaignActor} from '@/db/campaign-client';
import type {AcquireNoSubmissionResolution} from './campaign-send-admission';
/** Only call with a result authenticated by the private original-intent codec.
 * Ledger completion cannot prepare another intent or resume the conversation. */
export async function settleAgentNoSubmission(actor:CampaignActor,operationId:string,resolution:AcquireNoSubmissionResolution,options?:AgentBusinessDbOptions){
 z.string().uuid().parse(operationId);
 const original=z.object({intentId:z.string().uuid(),operationKey:z.string().min(1).max(1000),proofDigest:z.string().regex(/^[a-f0-9]{64}$/)}).parse(resolution);
 return withCampaignDb(actor,async c=>{if(options?.businessTime)await installAgentBusinessTimeSql(c,options.businessTime,actor);const row=(await c.query('SELECT public.agent_communications_no_submission($1::uuid,$2::uuid,$3::text) AS outcome',[operationId,original.intentId,original.proofDigest])).rows[0];if(row?.outcome?.status!=='not_submitted'||row.outcome.operationKey!==original.operationKey||row.outcome.intentId!==original.intentId||row.outcome.proofDigest!==original.proofDigest)throw Error('Original no-submission ledger proof unavailable');return row.outcome as {status:'not_submitted';intentId:string;proofDigest:string;operationKey:string};},options?.pool?{pool:options.pool}:undefined);
}
