import {z} from 'zod';
import type {SqlClient} from '../../communications/packages/storage-postgres/src/webhook-repository';
const change=z.object({bindingId:z.string().uuid(),serviceEventId:z.string().min(1).max(200),receiptFingerprint:z.string().regex(/^[a-f0-9]{64}$/),changeFingerprint:z.string().regex(/^[a-f0-9]{64}$/),sender:z.string().email(),providerMessageId:z.string().min(1).max(2048),occurredAt:z.iso.datetime(),reviewRequired:z.boolean()}).strict();
/** Called only after authenticated consumption has inserted its immutable app
 * receipt, on the SAME held owner transaction. No body/model/provider I/O. */
export async function queueAgentCommunicationChange(client:Pick<SqlClient,'query'>,raw:unknown){
 const input=change.parse(raw),installed=await client.query("SELECT to_regprocedure('public.agent_communications_change(uuid,text,text,text,text,text,timestamp with time zone,boolean)') IS NOT NULL AS installed");
 if(installed.rows.length!==1||typeof installed.rows[0]?.installed!=='boolean')throw Error('Native communication event readiness unavailable');
 if(!installed.rows[0].installed)return 0;
 const result=await client.query('SELECT public.agent_communications_change($1::uuid,$2,$3,$4,$5,$6,$7::timestamptz,$8::boolean) AS queued',[input.bindingId,input.serviceEventId,input.receiptFingerprint,input.changeFingerprint,input.sender,input.providerMessageId,input.occurredAt,input.reviewRequired]);
 return z.number().int().min(0).max(100).parse(result.rows.length===1?result.rows[0].queued:undefined);
}

const bounce=change.omit({sender:true,reviewRequired:true}).extend({recipient:z.string().email(),receiptPreimage:z.string().min(1).max(12000)}).strict();
/** A separately typed delivery-failure event, never materialised as a lead reply. */
export async function queueAgentEmailBounce(client:Pick<SqlClient,'query'>,raw:unknown){
 const input=bounce.parse(raw),readiness=await client.query("SELECT to_regprocedure('public.agent_communications_bounce(uuid,text,text,text,text,text,timestamp with time zone,text)') IS NOT NULL AS installed,to_regclass('public.agent_conversations') IS NOT NULL AS native_schema");
 if(readiness.rows.length!==1||typeof readiness.rows[0]?.installed!=='boolean'||typeof readiness.rows[0]?.native_schema!=='boolean')throw Error('Native delivery-failure readiness unavailable');
 if(!readiness.rows[0].installed){if(!readiness.rows[0].native_schema)return 0;throw Error('Native delivery-failure helper required');}
 const result=await client.query('SELECT public.agent_communications_bounce($1::uuid,$2,$3,$4,$5,$6,$7::timestamptz,$8) AS queued',[input.bindingId,input.serviceEventId,input.receiptFingerprint,input.changeFingerprint,input.recipient,input.providerMessageId,input.occurredAt,input.receiptPreimage]);
 return z.number().int().min(0).max(100).parse(result.rows.length===1?result.rows[0].queued:undefined);
}
