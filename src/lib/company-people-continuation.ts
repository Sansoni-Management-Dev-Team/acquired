import {and,eq} from 'drizzle-orm';
import {requireDb} from '@/db/client';
import {researchJobs,firmableSyncRuns} from '@/db/schema';
import {completesWorkItems} from '@/domain/research-completion';
import type {ResearchConfig} from '@/domain/research';
import {withResearchJobWorkflow} from './acquisition-workflow-context';
import {tickCompanyPeople} from './company-people-research';

/** Completion wakes only the exact original queue. Periodic maintenance is a fallback. */
export async function continueCompanyPeople(run:Pick<typeof firmableSyncRuns.$inferSelect,'id'|'trigger'|'requestKey'|'organizationId'|'actorId'|'targetId'>){
 if(run.trigger!=='discovery')return;
 const source=run.requestKey?.match(/^discovery:([0-9a-f-]{36}):([0-9a-f-]{36})$/i);
 if(!source||source[2]!==run.targetId)return;
 const [root]=await requireDb().select().from(researchJobs).where(and(eq(researchJobs.id,source[1]),eq(researchJobs.organizationId,run.organizationId),eq(researchJobs.createdBy,run.actorId))).limit(1);
 const config=root?.config as ResearchConfig|undefined;
 if(!root||!config||!completesWorkItems(config)||config.nativeAgent||!config.companyPeopleRunIds?.includes(run.id))return;
 await withResearchJobWorkflow(root,()=>tickCompanyPeople(root));
}
