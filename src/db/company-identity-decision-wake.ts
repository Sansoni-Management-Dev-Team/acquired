import {z} from 'zod';
import {agentRecordDigest} from './agent-store';
import type {CompanyIdentitySqlClient} from './company-identity-store';
const actorSchema=z.object({organizationId:z.string().min(1).max(200),userId:z.string().min(1).max(200)}).strict();
const inputSchema=z.object({mandateId:z.string().uuid(),requestKey:z.string().uuid(),reviewId:z.string().uuid()}).strict();
/** Same trusted write transaction as the immutable decision and publication.
 * This event grants inspection only. It never resumes a person, creates an
 * approval, changes a responsibility revision or reissues provider work. */
export async function wakeAfterCompanyIdentityDecision(c:CompanyIdentitySqlClient,rawActor:{organizationId:string;userId:string},rawInput:{mandateId:string;requestKey:string;reviewId:string}){
 const actor=actorSchema.parse(rawActor),input=inputSchema.parse(rawInput);
 const scopes=(await c.query(`SELECT t.id AS thread_id,r.id AS responsibility_id,r.revision
 FROM company_identity_decisions d
 JOIN mandates m ON m.id=d.mandate_id AND m.organization_id=d.organization_id
 JOIN member mem ON mem.organization_id=d.organization_id AND mem.user_id=d.decided_by
 JOIN mandate_targets mt ON mt.organization_id=d.organization_id AND mt.mandate_id=d.mandate_id AND mt.target_id=(d.receipt->>'targetId')::uuid
 JOIN agent_threads t ON t.mandate_id=m.id AND t.organization_id=m.organization_id AND t.owner_user_id=d.decided_by
 JOIN agent_responsibilities r ON r.thread_id=t.id AND r.organization_id=t.organization_id AND r.owner_user_id=t.owner_user_id AND r.mandate_id=m.id
 JOIN agent_runtime_registrations reg ON reg.thread_id=t.id AND reg.organization_id=t.organization_id AND reg.owner_user_id=t.owner_user_id AND reg.mandate_id=m.id AND reg.responsibility_id=r.id AND reg.responsibility_revision=r.revision AND reg.state='enabled'
 WHERE d.request_key=$1 AND d.review_id=$2 AND d.organization_id=$3 AND d.mandate_id=$4 AND d.decided_by=$5
 AND d.receipt->>'reviewId'=d.review_id::text AND d.receipt->>'status'='adopted'
 AND r.state IN('ready','waiting') AND r.mandate_revision=m.xmin::text
 ORDER BY t.id FOR SHARE OF m,mem,mt,t,r,reg`,[input.requestKey,input.reviewId,actor.organizationId,input.mandateId,actor.userId])).rows;
 let queued=0;
 for(const scope of scopes){const payload={responsibilityId:scope.responsibility_id,revision:scope.revision};const result=await c.query(`INSERT INTO agent_events(thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest)
 VALUES($1,$2,$3,$4,$5,'mandate.supervise',$6,$7) ON CONFLICT(thread_id,event_key) DO NOTHING RETURNING id`,[scope.thread_id,actor.organizationId,input.mandateId,actor.userId,'company-identity-adopted:'+input.requestKey,JSON.stringify(payload),agentRecordDigest(payload)]);queued+=result.rowCount??0;}
 return{queued};
}
