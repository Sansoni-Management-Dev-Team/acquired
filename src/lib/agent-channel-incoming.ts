import {z} from 'zod';
import type {SqlClient} from '../../communications/packages/storage-postgres/src/webhook-repository';
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const incoming=z.object({bindingId:z.string().uuid(),serviceEventId:z.string().min(1).max(200),receiptFingerprint:digest,changeFingerprint:digest,channel:z.enum(['email','whatsapp','linkedin']),sender:z.discriminatedUnion('kind',[z.object({kind:z.literal('email'),value:z.string().email()}).strict(),z.object({kind:z.literal('phone'),value:z.string().regex(/^\+[1-9][0-9]{6,14}$/)}).strict(),z.object({kind:z.literal('linkedin_profile'),value:z.string().regex(/^https:\/\/www\.linkedin\.com\/in\/[A-Za-z0-9_%.-]+\/?$/)}).strict()]),providerMessageId:z.string().min(1).max(2048),providerConversationId:z.string().min(1).max(2048).nullable(),occurredAt:z.iso.datetime(),reviewRequired:z.boolean(),reviewReason:z.enum(['semantic_conflict','identity_pending']).nullable(),receiptPreimage:z.string().min(1).max(12000)}).strict().superRefine((v,c)=>{if(v.sender.kind!==({email:'email',whatsapp:'phone',linkedin:'linkedin_profile'} as const)[v.channel]||(!v.reviewRequired&&v.reviewReason!==null))c.addIssue({code:'custom',message:'Exact canonical channel identity and review state required'});});
/** Authenticated application consumer only; shares its receipt transaction and held gate. */
export async function queueAgentChannelCommunicationChange(client:Pick<SqlClient,'query'>,raw:unknown){
 const input=incoming.parse(raw);
 const ready=await client.query("SELECT to_regprocedure('public.agent_channel_communications_change(jsonb)') IS NOT NULL AS installed,to_regclass('public.agent_conversation_channels') IS NOT NULL AS routed_schema");
 const row=ready.rows.length===1?ready.rows[0]:undefined;
 if(typeof row?.installed!=='boolean'||typeof row?.routed_schema!=='boolean')throw Error('Native channel ingress readiness unavailable');
 if(!row.installed){if(!row.routed_schema)return 0;throw Error('Native channel ingress helper required');}
 if(!row.routed_schema)throw Error('Native channel ingress schema required');
 const result=await client.query('SELECT public.agent_channel_communications_change($1::jsonb) AS queued',[JSON.stringify(input)]);
 return z.number().int().min(0).max(100).parse(result.rows.length===1?result.rows[0].queued:undefined);
}
