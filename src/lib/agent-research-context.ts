import {sql} from 'drizzle-orm';
import type {requireDb} from '@/db/client';
import type {ResearchConfig} from '@/domain/research';
type Database=Pick<ReturnType<typeof requireDb>,'execute'>;
/** Final native write guard; call first inside the same persistence transaction.
 * Provider I/O has already finished and never runs while these locks are held. */
export async function assertNativeResearchPersistence(database:Database,job:{organizationId:string;mandateId:string;createdBy:string;config:unknown}){
 const native=(job.config as ResearchConfig).nativeAgent;if(!native)return;
 await database.execute(sql`SELECT public.communications_lock_send_gate(${job.organizationId})`);
 const result=await database.execute(sql`SELECT r.id FROM agent_responsibilities r JOIN mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id JOIN member mem ON mem.organization_id=r.organization_id AND mem.user_id=r.owner_user_id
 WHERE r.id=${native.responsibilityId}::uuid AND r.thread_id=${native.threadId}::uuid AND r.organization_id=${job.organizationId} AND r.owner_user_id=${job.createdBy} AND r.mandate_id=${job.mandateId}::uuid AND r.state IN('ready','waiting') AND r.revision=${native.responsibilityRevision} AND r.mandate_revision=${native.mandateRevision} AND m.xmin::text=r.mandate_revision FOR SHARE OF r,m,mem`);
 const rows=Array.isArray(result)?result:(result as {rows:unknown[]}).rows;
 if(rows.length!==1)throw new Error('Native research context changed before persistence');
}
