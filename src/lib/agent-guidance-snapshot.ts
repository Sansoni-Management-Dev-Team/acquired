import {z} from 'zod';
import type {PoolClient} from 'pg';
import {guidanceViewSchema,selectAgentGuidance} from '@/domain/agent-guidance';
import {agentRecordDigest as digest,type AgentThread} from '@/db/agent-store';
const category=z.enum(['qualification','tone','buyer_context','follow_up']);
export const agentGuidanceSnapshotSchema=z.object({version:z.literal(1),query:z.string().max(16000).nullable(),categories:z.array(category).min(1).max(4),items:z.array(guidanceViewSchema).max(5)}).strict().refine(value=>value.items.reduce((n,item)=>n+item.input.text.length,0)<=4000,'Guidance exceeds bounded context');
export type AgentGuidanceSnapshot=z.infer<typeof agentGuidanceSnapshotSchema>;
export async function loadApprovedAgentGuidance(c:PoolClient,t:AgentThread,options:{categories:z.infer<typeof category>[];query?:string|null}):Promise<AgentGuidanceSnapshot>{
 const categories=[...new Set(options.categories)].sort(),query=options.query??null;
 const rows=(await c.query("SELECT id,revision,state,input FROM agent_operations WHERE thread_id=$1 AND organization_id=$2 AND owner_user_id=$3 AND mandate_id=$4 AND name='guidance.memory' AND state='approved' ORDER BY id LIMIT 101",[t.id,t.organization_id,t.owner_user_id,t.mandate_id])).rows;
 const records=rows.map(row=>guidanceViewSchema.parse({...row,organizationId:t.organization_id,mandateId:t.mandate_id,userId:t.owner_user_id})).filter(row=>categories.includes(row.input.category));
 if(rows.length>100)throw new Error('Too much saved guidance; consolidate it before planning');
 const items=query===null?records:selectAgentGuidance(records,{organizationId:t.organization_id,mandateId:t.mandate_id,userId:t.owner_user_id},query);
 return agentGuidanceSnapshotSchema.parse({version:1,query,categories,items});
}
export async function assertAgentGuidanceSnapshot(c:PoolClient,t:AgentThread,raw:unknown){const saved=agentGuidanceSnapshotSchema.parse(raw),current=await loadApprovedAgentGuidance(c,t,{categories:saved.categories,query:saved.query});if(digest(saved)!==digest(current))throw new Error('Approved guidance changed; prepare a fresh review');return current;}
