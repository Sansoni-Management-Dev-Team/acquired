import {lockResearchPersistence,type ResearchPersistenceDatabase} from './research-persistence-lock';
import {sql} from 'drizzle-orm';
import type {ResearchConfig} from '@/domain/research';
import {buildHybridCompanyContinuationSource,hybridCompanyContinuationSchema,selectHybridCompanyContinuation} from '@/domain/hybrid-company-continuation';
type Database=ResearchPersistenceDatabase;
const queryRows=(result:unknown):Record<string,unknown>[]=>Array.isArray(result)?result:(result as {rows:Record<string,unknown>[]}).rows;
/** Shared persistence entry: establish lock order for every source write, then
 * verify native launch authority when present. Never hold it across provider I/O. */
export async function assertNativeResearchPersistence(database:Database,job:{organizationId:string;mandateId:string;createdBy:string;config:unknown}){
 await lockResearchPersistence(database,job.organizationId);
 const config=job.config as ResearchConfig,native=config.nativeAgent,continuing=Object.hasOwn(config,'companyContinuation');
 if(!native){if(continuing)throw Error('Company continuation requires native research authority');return;}
 const result=await database.execute(sql`SELECT r.id FROM agent_responsibilities r JOIN mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id JOIN member mem ON mem.organization_id=r.organization_id AND mem.user_id=r.owner_user_id
 WHERE r.id=${native.responsibilityId}::uuid AND r.thread_id=${native.threadId}::uuid AND r.organization_id=${job.organizationId} AND r.owner_user_id=${job.createdBy} AND r.mandate_id=${job.mandateId}::uuid AND r.state IN('ready','waiting') AND r.revision=${native.responsibilityRevision} AND r.mandate_revision=${native.mandateRevision} AND m.xmin::text=r.mandate_revision FOR SHARE OF r,m,mem`);
 const rows=queryRows(result);
 if(rows.length!==1)throw new Error('Native research context changed before persistence');
 if(!continuing)return;
 const review=hybridCompanyContinuationSchema.parse(config.companyContinuation);
 // Stay in this source writer's transaction and lock order. A second actor
 // pool transaction would wait on the global lock that this one already owns.
 const originals=queryRows(await database.execute(sql`SELECT id,status,config FROM research_jobs WHERE id=${review.sourceRootId}::uuid AND organization_id=${job.organizationId} AND mandate_id=${job.mandateId}::uuid AND created_by=${job.createdBy} FOR SHARE`));
 if(originals.length!==1)throw Error('Owned company continuation source changed before persistence');
 const original=originals[0],source=await buildHybridCompanyContinuationSource({sourceRootId:original.id,status:original.status,config:original.config});
 selectHybridCompanyContinuation(source,review);
 const previous=queryRows(await database.execute(sql`SELECT current_setting('role',true) AS role,current_setting('app.acquire_org',true) AS organization_id,current_setting('app.acquire_user',true) AS user_id`));
 if(previous.length!==1||typeof previous[0].role!=='string'||!previous[0].role)throw Error('Native company continuation transaction scope is unavailable');
 const prior=previous[0];
 // These are the owned job's identities, never request headers or source data.
 await database.execute(sql`SELECT set_config('app.acquire_org',${job.organizationId},true),set_config('app.acquire_user',${job.createdBy},true)`);
 await database.execute(sql`SET LOCAL ROLE acquire_agent_user`);
 let sqlCompleted=false,failed=false;
 try{
  const claims=queryRows(await database.execute(sql`SELECT public.agent_assert_company_continuation(${native.operationId}::uuid) AS continuation`));sqlCompleted=true;
  const claim=claims.length===1?hybridCompanyContinuationSchema.safeParse(claims[0].continuation):undefined;
  if(!claim?.success||JSON.stringify(claim.data)!==JSON.stringify(review))throw Error('Native company continuation changed before persistence');
 }catch(error){failed=true;throw error;}
 finally{
  // A SQL refusal aborts this transaction; another query would only produce
  // 25P02 and hide the original fence error. Its caller must roll back. On a
  // successful SQL call, restore scope before any ordinary source write.
  if(sqlCompleted)try{await database.execute(sql`SELECT set_config('role',${String(prior.role)},true),set_config('app.acquire_org',${typeof prior.organization_id==='string'?prior.organization_id:''},true),set_config('app.acquire_user',${typeof prior.user_id==='string'?prior.user_id:''},true)`);}catch(error){if(!failed)throw error;}
 }
}
