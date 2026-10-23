import {z} from 'zod';
import type {Pool} from 'pg';
import {agentActorSchema,agentRecordDigest,type AgentActor} from '@/db/agent-store';
import {cachedDemoResearchSelectionSchema} from './cached-demo-research';
export const cachedDemoStatusQuerySchema=z.object({requestId:z.string().uuid(),sourceMandateId:z.string().uuid(),presentation:z.enum(['agent','workspace'])}).strict();
/** Read-only recovery of an existing owned demo. A ready result opens its
 * workspace; it never resumes an agent, approves outreach or changes a hold. */
export async function readCachedDemoStatus(pool:Pick<Pool,'query'>,rawActor:AgentActor,raw:unknown){
 const actor=agentActorSchema.parse(rawActor),input=cachedDemoStatusQuerySchema.parse(raw);
 const rows=(await pool.query(`/* cached-demo-status */ SELECT a.metadata,mode.mode,mode.demo_id AS "demoId",t.id AS "threadId",r.id AS "responsibilityId",
  (SELECT count(*)::int FROM mandate_targets mt WHERE mt.organization_id=m.organization_id AND mt.mandate_id=m.id
   AND coalesce(a.metadata->'initialResearch'->'cachedDemo'->'selection'->'targetIds','[]'::jsonb) ? mt.target_id::text) AS companies
  FROM mandates m JOIN member membership ON membership.organization_id=m.organization_id AND membership.user_id=$3
  JOIN audit_events a ON a.id=m.id AND a.entity_id=m.id::text AND a.organization_id=m.organization_id AND a.actor_id=m.created_by AND a.action='agent.mandate_created' AND a.entity_type='mandate'
  JOIN agent_mandate_execution_modes mode ON mode.mandate_id=m.id AND mode.organization_id=m.organization_id AND mode.created_by=$3
  LEFT JOIN agent_threads t ON t.mandate_id=m.id AND t.organization_id=m.organization_id AND t.owner_user_id=$3
  LEFT JOIN agent_responsibilities r ON r.thread_id=t.id
  WHERE m.id=$1 AND m.organization_id=$2 AND m.created_by=$3`,[input.requestId,actor.organizationId,actor.userId])).rows;
 if(rows.length>1)throw Error('Saved demo request unavailable');
 const row=rows[0];
 if(!row)return {status:'missing' as const};
 const initial=row.metadata?.initialResearch,selection=cachedDemoResearchSelectionSchema.safeParse(initial?.cachedDemo?.selection),revision=row.metadata?.creationRevision;
 if(row.mode!=='demo'||row.demoId!==input.requestId||row.metadata?.executionMode!==undefined&&row.metadata.executionMode!=='demo'||initial?.version!==1||initial?.requestId!==input.requestId||initial?.source!=='cached'||(initial.presentation??'agent')!==input.presentation||!selection.success||selection.data.sourceMandateId!==input.sourceMandateId||typeof revision!=='string'||!/^\d{1,30}$/.test(revision)||initial.creationRevision!==revision)throw Error('Saved demo request unavailable');
 const digest=agentRecordDigest({requestId:input.requestId,brief:selection.data.brief,executionMode:'demo',demoSourceMandateId:selection.data.sourceMandateId});
 if(row.metadata.inputDigest!==digest)throw Error('Saved demo request unavailable');
 if(Number(row.companies)!==selection.data.companyCount||input.presentation==='agent'&&(!row.threadId||!row.responsibilityId))return {status:'preparing' as const};
 return {status:'ready' as const,id:input.requestId,revision};
}
