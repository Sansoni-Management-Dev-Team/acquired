import {bindCommunicationsWorkflowContext} from './communications-workflow-context';
import{z}from'zod';
import type{OperationSnapshot}from'../../communications/packages/contracts/src';
import type{SqlClient}from'../../communications/packages/storage-postgres/src/webhook-repository';
const proof=z.object({snapshot:z.object({key:z.string(),payloadDigest:z.string().regex(/^[a-f0-9]{64}$/)}).passthrough(),evidenceDigest:z.string().regex(/^[a-f0-9]{64}$/)});
/** Trusted callback only, after original provider association proof. This queues
 * a fresh bounded lookup; it grants no permission to send or rewrite a receipt. */
export async function queueAgentReceiptAssociation(client:Pick<SqlClient,'query'>,bindingId:string,input:{snapshot:OperationSnapshot;evidenceDigest:string}){
 const value=proof.parse(input),match=/^acquire:agent:([a-f0-9-]{36}):[1-9]\d*$/.exec(value.snapshot.key);if(!match)return 0;const operation=z.string().uuid().parse(match[1]);
 const ready=await client.query("SELECT to_regprocedure('public.agent_communications_receipt_wake(uuid,uuid,text,text,text)') IS NOT NULL AS installed,to_regclass('public.agent_conversations') IS NOT NULL AS native_schema");
 if(ready.rows.length!==1||typeof ready.rows[0].installed!=='boolean'||typeof ready.rows[0].native_schema!=='boolean')throw Error('Native receipt recovery readiness unavailable');
 if(!ready.rows[0].installed){if(!ready.rows[0].native_schema)return 0;throw Error('Native receipt recovery helper required');}
 const actor=z.object({applicationId:z.literal('acquire'),tenantId:z.string().min(1),ownerId:z.string().min(1),channel:z.literal('email')}).parse(input.snapshot.binding);
 await bindCommunicationsWorkflowContext(client,{organizationId:actor.tenantId,userId:actor.ownerId},{kind:'agent',operationId:operation});
 const result=await client.query('SELECT public.agent_communications_receipt_wake($1::uuid,$2::uuid,$3,$4,$5) AS queued',[z.string().uuid().parse(bindingId),operation,value.snapshot.key,value.snapshot.payloadDigest,value.evidenceDigest]);
 return z.number().int().min(0).max(1).parse(result.rows[0]?.queued);
}
