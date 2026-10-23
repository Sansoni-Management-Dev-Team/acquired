import type{Pool,PoolClient}from'pg';
import{z}from'zod';
import{PgDialect}from'drizzle-orm/pg-core';
import{lockResearchPersistence}from'@/lib/research-persistence-lock';
import{readableStoredBrief}from'@/domain/stored-brief';
import{buildCompanyMembershipProjection,type AcceptedCompanyObservation,type CompanyProjectionTargetRecord}from'@/domain/company-membership-projection';
import type{SavedResearchFinding}from'@/domain/research';
export type CompanyProjectionSqlClient=Pick<PoolClient,'query'>;
type Actor={organizationId:string;userId:string};
const actorSchema=z.object({organizationId:z.string().min(1).max(200),userId:z.string().min(1).max(200)}).strict(),scopeSchema=z.object({mandateId:z.string().uuid(),targetId:z.string().uuid()}).strict();
const dialect=new PgDialect(),uuid=z.string().uuid();
async function assertPublisher(c:CompanyProjectionSqlClient,actor:Actor){
 const role=(await c.query("SELECT current_setting('role',true) AS role,current_user AS current_user")).rows[0];
 if([role?.role,role?.current_user].some(value=>['acquire_agent_user','acquire_campaign_user','acquire_agent_worker'].includes(value)))throw Error('Company projection publication requires the trusted server transaction');
 await lockResearchPersistence({execute:async statement=>{const q=dialect.sqlToQuery(statement);return c.query(q.sql,q.params);}},actor.organizationId);
 if(!(await c.query('SELECT 1 FROM member WHERE organization_id=$1 AND user_id=$2 FOR SHARE',[actor.organizationId,actor.userId])).rowCount)throw Error('Current company projection membership required');
}
/** Call within the normal server transaction, before entering scoped native
 * admission. A same-transaction shared persistence/adoption caller is safe. */
export async function publishCompanyMembershipProjection(c:CompanyProjectionSqlClient,rawActor:Actor,rawScope:{mandateId:string;targetId:string}){
 const actor=actorSchema.parse(rawActor),scope=scopeSchema.parse(rawScope);
 await assertPublisher(c,actor);
 const m=(await c.query('SELECT m.filters,m.xmin::text AS mandate_revision,mt.version AS membership_version,mt.xmin::text AS membership_revision,mt.assessment FROM mandates m JOIN mandate_targets mt ON mt.mandate_id=m.id AND mt.organization_id=m.organization_id WHERE m.id=$1 AND m.organization_id=$2 AND mt.target_id=$3 FOR SHARE OF m,mt',[scope.mandateId,actor.organizationId,scope.targetId])).rows[0];
 if(!m)throw Error('Company projection membership unavailable');
 const o=(await c.query('SELECT id,input_digest,observed_at,source_facts FROM company_identity_accepted_observations WHERE organization_id=$1 AND mandate_id=$2 AND target_id=$3 ORDER BY observed_at DESC,created_at DESC,id DESC LIMIT 1',[actor.organizationId,scope.mandateId,scope.targetId])).rows[0];
 // Historical memberships are not silently opted into the new authority path.
 if(!o)return{published:false as const,legacy:true as const};
 const r=(await c.query('SELECT t.*,t.xmin::text AS target_revision FROM targets t WHERE id=$1 AND organization_id=$2 FOR SHARE',[scope.targetId,actor.organizationId])).rows[0];if(!r)throw Error('Company source unavailable');
 const target=Object.fromEntries(Object.entries(r).filter(([key])=>key!=='target_revision').map(([key,value])=>[key.replace(/_([a-z])/g,(_m,c:string)=>c.toUpperCase()),value]))as CompanyProjectionTargetRecord;
 const findings=(await c.query('SELECT id,job_id AS "jobId",target_id AS "targetId",source_url AS "sourceUrl",observed_at AS "observedAt",evidence,confidence FROM research_findings WHERE organization_id=$1 AND mandate_id=$2 AND target_id=$3 ORDER BY observed_at DESC,id LIMIT 100',[actor.organizationId,scope.mandateId,scope.targetId])).rows.map(row=>({...row,observedAt:new Date(row.observedAt).toISOString()})) as SavedResearchFinding[];
 const findingsDigest=(await c.query('SELECT public.agent_company_findings_digest($1,$2::uuid,$3::uuid) AS digest',[actor.organizationId,scope.mandateId,scope.targetId])).rows[0].digest;
 const observation:AcceptedCompanyObservation={id:o.id,inputDigest:o.input_digest,observedAt:new Date(o.observed_at).toISOString(),sourceFacts:o.source_facts};
 const projection=buildCompanyMembershipProjection({targetRecord:target,brief:readableStoredBrief(m.filters?.brief),assessment:m.assessment,findings,observation});
 const value={target:projection.effectiveTargetRecord,assessment:projection.effectiveAssessment,screening:projection.screening,blockedReasons:projection.currentCompanyBlockedReasons,observation:{id:o.id,digest:o.input_digest},digest:projection.projectionDigest};
 await c.query(`INSERT INTO company_membership_projections(organization_id,mandate_id,target_id,mandate_revision,membership_version,membership_revision,target_revision,observation_id,observation_digest,findings_digest,projection_digest,projection,published_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
 ON CONFLICT(organization_id,mandate_id,target_id) DO UPDATE SET mandate_revision=EXCLUDED.mandate_revision,membership_version=EXCLUDED.membership_version,membership_revision=EXCLUDED.membership_revision,target_revision=EXCLUDED.target_revision,observation_id=EXCLUDED.observation_id,observation_digest=EXCLUDED.observation_digest,findings_digest=EXCLUDED.findings_digest,projection_digest=EXCLUDED.projection_digest,projection=EXCLUDED.projection,published_by=EXCLUDED.published_by,published_at=clock_timestamp()
 WHERE (company_membership_projections.mandate_revision,company_membership_projections.membership_version,company_membership_projections.membership_revision,company_membership_projections.target_revision,company_membership_projections.observation_id,company_membership_projections.findings_digest,company_membership_projections.projection_digest) IS DISTINCT FROM (EXCLUDED.mandate_revision,EXCLUDED.membership_version,EXCLUDED.membership_revision,EXCLUDED.target_revision,EXCLUDED.observation_id,EXCLUDED.findings_digest,EXCLUDED.projection_digest)`,[actor.organizationId,scope.mandateId,scope.targetId,m.mandate_revision,m.membership_version,m.membership_revision,r.target_revision,o.id,o.input_digest,findingsDigest,projection.projectionDigest,JSON.stringify(value),actor.userId]);
 return{published:true as const,projectionDigest:projection.projectionDigest,observationId:o.id as string};
}
/** Existing trusted transaction only; no BEGIN/COMMIT, no native SHARED lock
 * upgrade. Explicit subsets are bounded at50, including a zero-row scope. */
export async function refreshCompanyMembershipProjectionsInTransaction(c:CompanyProjectionSqlClient,rawActor:Actor,scope:{mandateId:string;targetIds:string[]}){
 const actor=actorSchema.parse(rawActor);z.string().uuid().parse(scope.mandateId);const targetIds=[...new Set(z.array(z.string().uuid()).max(50).parse(scope.targetIds))];
 await assertPublisher(c,actor);
 if(!(await c.query('SELECT 1 FROM mandates WHERE id=$1 AND organization_id=$2 FOR SHARE',[scope.mandateId,actor.organizationId])).rowCount)throw Error('Company projection mandate unavailable');
 const ids=(await c.query('SELECT target_id FROM mandate_targets WHERE organization_id=$1 AND mandate_id=$2 AND ($3::uuid[] IS NULL OR target_id=ANY($3::uuid[])) ORDER BY target_id LIMIT 50',[actor.organizationId,scope.mandateId,targetIds])).rows;
 const until=Date.now()+3000,results=[];
 for(const row of ids){if(Date.now()>=until)throw Error('Company projection refresh exceeded its bounded transaction; refresh is still required');results.push(await publishCompanyMembershipProjection(c,actor,{mandateId:scope.mandateId,targetId:row.target_id}));}
 return{published:results.filter(r=>r.published).length,examined:results.length};
}
export type CompanyProjectionTransaction=<T>(work:(c:CompanyProjectionSqlClient)=>Promise<T>)=>Promise<T>;
/** Enumerate no more than1000 accepted memberships, then release authority
 * between50-member batches. Any later source change remains SQL-fenced. */
export async function refreshCompanyMembershipProjectionBatches(transaction:CompanyProjectionTransaction,rawActor:Actor,scope:{mandateId:string;targetIds?:string[]}){
 const actor=actorSchema.parse(rawActor);z.string().uuid().parse(scope.mandateId);
 if(scope.targetIds)return transaction(c=>refreshCompanyMembershipProjectionsInTransaction(c,actor,{mandateId:scope.mandateId,targetIds:scope.targetIds!}));
 const targetIds=await transaction(async c=>{
  await assertPublisher(c,actor);
  if(!(await c.query('SELECT 1 FROM mandates WHERE id=$1 AND organization_id=$2 FOR SHARE',[scope.mandateId,actor.organizationId])).rowCount)throw Error('Company projection mandate unavailable');
  const ids=(await c.query(`SELECT DISTINCT mt.target_id FROM mandate_targets mt
   JOIN company_identity_accepted_observations o ON o.organization_id=mt.organization_id AND o.mandate_id=mt.mandate_id AND o.target_id=mt.target_id
   WHERE mt.organization_id=$1 AND mt.mandate_id=$2 ORDER BY mt.target_id LIMIT 1001`,[actor.organizationId,scope.mandateId])).rows.map(row=>uuid.parse(row.target_id));
  if(ids.length>1000)throw Error('Company projection refresh exceeds1000 accepted memberships; select a bounded subset');return ids;
 });
 let published=0,examined=0;
 for(let i=0;i<targetIds.length;i+=50){const result=await transaction(c=>refreshCompanyMembershipProjectionsInTransaction(c,actor,{mandateId:scope.mandateId,targetIds:targetIds.slice(i,i+50)}));published+=result.published;examined+=result.examined;}
 return{published,examined};
}
/** Explicit normal command preflight, never called from a SHARED actor TX. */
export async function refreshCompanyMembershipProjections(pool:Pick<Pool,'connect'>,actor:Actor,scope:{mandateId:string;targetIds?:string[]}){
 return refreshCompanyMembershipProjectionBatches(async work=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='3s'");await c.query("SET LOCAL lock_timeout='1s'");const result=await work(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}},actor,scope);
}
