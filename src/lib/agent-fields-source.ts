import{sql}from'drizzle-orm';
import{targetRecordToRankedTarget}from'@/db/target-record-mapper';
import type{targets}from'@/db/schema';
import type{requireDb}from'@/db/client';
import type{ResearchConfig}from'@/domain/research';
/** Projection uses the same normal-workspace field planner. No values or
 * criteria are inferred, and published personal contacts remain another phase. */
export async function nativeFieldsCompany(raw:{targetId:string;name:string;domain:string;sourceRevision:string;blockedReasons:string[];companyIdentityPolicyVersion?:1;target:Record<string,unknown>}){
 const{planCompanyBackgroundScope}=await import('./company-background-research');
 const row=Object.fromEntries(Object.entries(raw.target).map(([key,value])=>[key.replace(/_([a-z])/g,(_,c:string)=>c.toUpperCase()),value]))as typeof targets.$inferSelect;
 const target=targetRecordToRankedTarget(row,[]),scope=planCompanyBackgroundScope(target);
 return{targetId:raw.targetId,name:raw.name,domain:raw.domain,sourceRevision:raw.sourceRevision,blockedReasons:raw.blockedReasons,...(raw.companyIdentityPolicyVersion===1?{companyIdentityPolicyVersion:1 as const}:{}),missingFields:scope.fields,verifyAbn:scope.verifyAbn};
}
/** Must run in the evidence transaction with the target already locked. */
export async function assertNativeFieldsPersistence(db:Pick<ReturnType<typeof requireDb>,'execute'>,job:{id:string;organizationId:string;mandateId:string;createdBy:string;config:unknown}){
 const config=job.config as ResearchConfig&{nativeFieldsSourceRevision?:string},meta=config.nativeAgent;if(!meta)return;
 const installed=await db.execute(sql`SELECT to_regprocedure('public.agent_fields_persistence_permitted(uuid,text,uuid,text,jsonb)') IS NOT NULL AS installed`);
 const available=(Array.isArray(installed)?installed:(installed as{rows:Array<{installed:boolean}>}).rows)[0]?.installed===true;
 if(available){const result=await db.execute(sql`SELECT public.agent_fields_persistence_permitted(${job.id}::uuid,${job.organizationId},${job.mandateId}::uuid,${job.createdBy},${JSON.stringify(job.config)}::jsonb) AS allowed`);const rows=Array.isArray(result)?result:(result as{rows:Array<{allowed:boolean}>}).rows;if(rows[0]?.allowed!==true)throw Error('Saved company or public-field authority changed before persistence');return;}
 if(config.companyIdentityPolicyVersion===1)throw Error('Current company field-source verification is not available');
 const result=await db.execute(sql`SELECT o.id FROM agent_operations o JOIN agent_responsibilities r ON r.id=${meta.responsibilityId}::uuid AND r.thread_id=o.thread_id JOIN mandates m ON m.id=o.mandate_id AND m.organization_id=o.organization_id JOIN targets g ON g.id=${config.targetId}::uuid AND g.organization_id=o.organization_id JOIN mandate_targets mt ON mt.target_id=g.id AND mt.organization_id=o.organization_id AND mt.mandate_id=o.mandate_id
 WHERE o.id=${meta.operationId}::uuid AND o.name='research.fields' AND o.state='running' AND o.organization_id=${job.organizationId} AND o.mandate_id=${job.mandateId}::uuid AND o.owner_user_id=${job.createdBy} AND r.state IN('ready','waiting') AND r.revision=${meta.responsibilityRevision} AND r.mandate_revision=${meta.mandateRevision} AND m.xmin::text=r.mandate_revision AND o.input->'config'->>'requestId'=${config.parentJobId} AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.input->'selected') s WHERE s->>'targetId'=g.id::text AND s->>'childJobId'=${job.id} AND s->>'sourceRevision'=${config.nativeFieldsSourceRevision} AND s->'fields'=${JSON.stringify(config.companyBackgroundResearch?.fields)}::jsonb AND s->>'verifyAbn'=${String(config.companyBackgroundResearch?.verifyAbn)} AND s->>'sourceRevision'=encode(sha256(convert_to(jsonb_build_object('target',g.xmin::text,'membership',mt.version,'assessment',mt.assessment)::text,'UTF8')),'hex')) FOR SHARE OF o,r,m,mt`);
 const rows=Array.isArray(result)?result:(result as{rows:unknown[]}).rows;if(rows.length!==1)throw Error('Saved company or public-field authority changed before persistence');
}
