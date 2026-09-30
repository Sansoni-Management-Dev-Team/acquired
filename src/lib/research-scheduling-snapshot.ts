import { and, eq, sql } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { researchJobs, researchFindings } from '@/db/schema';
import { researchExecutionSelection, ResearchRepository } from '@/db/research-repository';
import { AcquisitionRepository } from '@/db/acquisition-repository';
export type ResearchSchedulingSnapshot = {
 root: typeof researchJobs.$inferSelect;
 jobs: (typeof researchJobs.$inferSelect)[];
 members: Awaited<ReturnType<AcquisitionRepository['memberships']>>;
 findings: Pick<typeof researchFindings.$inferSelect, 'jobId' | 'targetId' | 'evidence' | 'observedAt' | 'sourceUrl'>[];
 dispatched: Set<string>;
 schedulingLease?: { owner: string; generation: number };
};
export async function loadResearchSchedulingSnapshot(org:string,rootId:string):Promise<ResearchSchedulingSnapshot | null> {
 const root = await new ResearchRepository(org).getExecution(rootId);
 if(!root || root.status === 'cancelled') return null;
 const db=requireDb();
 const [jobs,members]=await Promise.all([
  db.select(researchExecutionSelection).from(researchJobs).where(and(eq(researchJobs.organizationId,org),sql`(${researchJobs.id} = ${rootId} OR ${researchJobs.config}->>'researchRunId' = ${rootId} OR (${researchJobs.mandateId} = ${root.mandateId} AND ${researchJobs.status} NOT IN ('complete', 'partial', 'failed', 'cancelled')))`)),
  new AcquisitionRepository(org).memberships(root.mandateId),
 ]);
 const findings = members.length ? await db.select({jobId:researchFindings.jobId,targetId:researchFindings.targetId,evidence:researchFindings.evidence,observedAt:researchFindings.observedAt,sourceUrl:researchFindings.sourceUrl}).from(researchFindings).where(and(eq(researchFindings.organizationId,org),sql`${researchFindings.targetId} IN (${sql.join(members.map(m=>sql`${m.target.id}`),sql`, `)})`)) : [];
 return {root,jobs,members,findings,dispatched:new Set()};
}
