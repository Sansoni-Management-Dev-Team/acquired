import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {AgentActor,AgentThread} from './agent-store';
import {agentRecordDigest} from '@/lib/agent-record-digest';
const uuid=z.string().uuid(),key=z.string().trim().min(1).max(200);
export function agentJson(value:unknown){
 const parsed=z.json().parse(value);
 if(Buffer.byteLength(JSON.stringify(parsed))>60_000)throw Error('Agent payload exceeds the bounded storage limit');
 return parsed;
}
/** Existing persistence only. Caller owns the actor-scoped RLS transaction. */
export async function openAgentThread(client:PoolClient,actor:AgentActor,mandateId:string):Promise<AgentThread>{
 const values=[actor.organizationId,uuid.parse(mandateId),actor.userId];
 await client.query(`INSERT INTO agent_threads(organization_id,mandate_id,owner_user_id)
        SELECT $1,$2,$3 FROM mandates WHERE id=$2 AND organization_id=$1
        ON CONFLICT(organization_id,mandate_id,owner_user_id) DO NOTHING`,values);
 const row=(await client.query<AgentThread>('SELECT * FROM agent_threads WHERE organization_id=$1 AND mandate_id=$2 AND owner_user_id=$3',values)).rows[0];
 if(!row)throw Error('Mandate not found');return row;
}
export async function appendAgentMessage(client:PoolClient,thread:AgentThread,requestKey:string,role:'user'|'assistant',content:unknown){
 const request=key.parse(requestKey),value=agentJson(content),hash=agentRecordDigest({role:z.enum(['user','assistant']).parse(role),content:value});
 await client.query(`INSERT INTO agent_messages(thread_id,organization_id,mandate_id,owner_user_id,request_key,role,content,content_digest)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(thread_id,request_key) DO NOTHING`,[thread.id,thread.organization_id,thread.mandate_id,thread.owner_user_id,request,role,JSON.stringify(value),hash]);
 const row=(await client.query('SELECT * FROM agent_messages WHERE thread_id=$1 AND request_key=$2',[thread.id,request])).rows[0];
 if(row.content_digest!==hash)throw Error('Idempotency key reused with different message');return row;
}
