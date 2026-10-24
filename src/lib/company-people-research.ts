import {withResearchJobWorkflow} from './acquisition-workflow-context';
import {AcquisitionRepository} from '@/db/acquisition-repository';
import {lockResearchPersistence} from './research-persistence-lock';
import { contactCompanyEligible, contactDeadlineAdmits } from '@/domain/company-contact-policy';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { firmableSyncRuns, researchJobs, targets } from '@/db/schema';
import { FirmableHistoryRepository } from '@/db/firmable-history-repository';
import { companyPeopleProgress } from '@/domain/company-people-progress';
import type { ResearchConfig } from '@/domain/research';
import { researchWorker } from './research-service';
import { recoverFirmableRefreshes } from './firmable-run-recovery';

type Job = Omit<typeof researchJobs.$inferSelect,'workflowExecutionId'> & {workflowExecutionId?:string|null};
type Database=ReturnType<typeof requireDb>;
async function canonicalPeopleLock(tx:Database,job:Job){
 await lockResearchPersistence(tx,job.organizationId);
 const member=await tx.execute(sql`SELECT id FROM member WHERE organization_id=${job.organizationId} AND user_id=${job.createdBy} FOR SHARE`);
 const rows=Array.isArray(member)?member:(member as {rows:unknown[]}).rows;
 if(rows.length!==1)throw Error('Current company contact membership required');
}
async function currentPeopleCompanies(tx:Database,job:Job,targetIds:string[]){
 const repo=new AcquisitionRepository(job.organizationId,tx),mandate=await repo.getMandate(job.mandateId);
 if(!mandate)throw Error('Current company contact mandate unavailable');
 // Basic non-phone People data is not an acquisition-fit decision. Only the
 // current mandate's explicit human decision and accepted provider identity admit it.
 // Derived automatic exclusions stay rankable facts; outreach stages stay held.
 const memberships=await repo.memberships(job.mandateId,targetIds);
 return new Map(memberships.map(member=>[member.target.id,{eligible:!['contacted','in-conversation'].includes(member.assessment.stage)&&(!['excluded','parked'].includes(member.assessment.stage)||member.assessment.decisionOrigin==='automatic')&&/^f\d+$/.test(member.target.sourceData?.firmable?.firmableId??''),fitScore:member.target.scores.fit,firmableId:member.target.sourceData?.firmable?.firmableId}]));
}
/** One automatic people workflow per root leaves room for ongoing company reads.
 * Existing run IDs and request keys make checkpoint retries safe. */
export async function tickCompanyPeople(job: Job, stopped = false) {
  const db = requireDb(), history = new FirmableHistoryRepository(db);
  const dispatch = await db.transaction(async tx => {
    const canonical=(job.config as ResearchConfig).companyIdentityPolicyVersion===1;
    if(canonical)await canonicalPeopleLock(tx,job);
    const [root] = await tx.select().from(researchJobs).where(and(eq(researchJobs.id, job.id), eq(researchJobs.organizationId, job.organizationId))).for('update');
    if (!root) throw Error('Company research root missing');
    const config = root.config as ResearchConfig;
    if(canonical!==(config.companyIdentityPolicyVersion===1)||canonical&&(root.createdBy!==job.createdBy||root.mandateId!==job.mandateId))throw Error('Company contact source changed; refresh its original root');
    if(canonical&&!config.includeCompanyPeople)return [];
    const ids = config.companyPeopleRunIds || [];
    if (!ids.length) return [];
    const runs = await tx.select().from(firmableSyncRuns).where(and(eq(firmableSyncRuns.organizationId, job.organizationId), inArray(firmableSyncRuns.id, ids)));
    if (runs.length !== ids.length) throw Error('Linked people research run missing');
    const pending = runs.filter(run => ['queued', 'running'].includes(run.status));
    if (stopped || ['failed','cancelled'].includes(root.status) || Date.now() >= (config.automaticDeadline || Infinity)) {
      for (const run of pending) await tx.update(firmableSyncRuns).set({ status: run.status === 'queued' ? 'cancelled' : run.profilesSaved ? 'partial' : 'failed', completedAt: new Date(), updatedAt: new Date(), message: root.status === 'cancelled' ? 'Company search cancelled; saved contacts retained' : run.status === 'queued' ? 'Contact admission deadline reached; work unattempted' : 'Contact deadline reached; saved contacts retained', error: { origin: 'admission', reason: root.status === 'cancelled' ? 'cancelled' : 'deadline', attempted: run.status !== 'queued' } }).where(eq(firmableSyncRuns.id, run.id));
      return [];
    }
    const companies = !canonical&&pending.length ? await tx.select().from(targets).where(inArray(targets.id, pending.map(run => run.targetId))) : [];
    const currentCompanies=canonical?await currentPeopleCompanies(tx,job,pending.map(run=>run.targetId)):null;
    const byId = new Map(companies.map(target => [target.id, target]));
    const eligible = (run: typeof pending[number]) => {
      if(currentCompanies){const company=currentCompanies.get(run.targetId);return company?.eligible===true&&company.firmableId===run.firmableCompanyId;}
      const target = byId.get(run.targetId);
      return Boolean(target && contactCompanyEligible(target.qualification, (target.firmographics as Record<string, unknown>).screening));
    };
    const rejected = pending.filter(run => !eligible(run));
    for (const run of rejected) await tx.update(firmableSyncRuns).set({ status: run.profilesSaved ? 'partial' : 'cancelled', completedAt: new Date(), updatedAt: new Date(), message: canonical ? 'Current company membership or identity no longer permits contact enrichment' : 'Contact enrichment not eligible under company screening', error: {origin:'admission',reason:'ineligible',attempted:run.status !== 'queued'} }).where(eq(firmableSyncRuns.id, run.id));
    if (runs.some(run => run.status === 'running')) return [];
    const admitted = pending.filter(run => run.status === 'queued' && eligible(run));
    if (!contactDeadlineAdmits(config.automaticDeadline)) {
      if (admitted.length) await tx.update(firmableSyncRuns).set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date(), message: 'Insufficient contact admission budget; work unattempted', error: {origin:'admission',reason:'insufficient_budget',attempted:false} }).where(inArray(firmableSyncRuns.id, admitted.map(run => run.id)));
      return [];
    }
    const next = admitted.sort((a, b) => (currentCompanies?.get(b.targetId)?.fitScore??byId.get(b.targetId)?.fitScore??0) - (currentCompanies?.get(a.targetId)?.fitScore??byId.get(a.targetId)?.fitScore??0) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))[0];
    if (!next) return [];
    await tx.update(firmableSyncRuns).set({ status: 'running', startedAt: new Date(), updatedAt: new Date(), message: 'Finding company contacts' }).where(eq(firmableSyncRuns.id, next.id));
    return [next];
  });
  for (const run of dispatch) {
    // createBatch uses a stable ID: an uncertain dispatch can be safely retried.
    try { await researchWorker(`/firmable/${run.id}`, 'POST', { mandateId: job.mandateId }, 4000); }
    catch { await db.update(firmableSyncRuns).set({ status: 'queued', updatedAt: new Date(), message: 'People workflow dispatch pending; retrying' }).where(and(eq(firmableSyncRuns.id, run.id), eq(firmableSyncRuns.status, 'running'), eq(firmableSyncRuns.message, 'Finding company contacts'))); }
  }
  const [root] = await db.select().from(researchJobs).where(eq(researchJobs.id, job.id));
  const ids = (root.config as ResearchConfig).companyPeopleRunIds || [];
  const runs = ids.length ? await db.select().from(firmableSyncRuns).where(and(eq(firmableSyncRuns.organizationId, job.organizationId), inArray(firmableSyncRuns.id, ids))) : [];
  await recoverFirmableRefreshes(history, runs.filter(run => run.status === 'running'), job.mandateId);
  return db.transaction(async tx => {
    if((job.config as ResearchConfig).companyIdentityPolicyVersion===1)await canonicalPeopleLock(tx,job);
    const [lockedRoot] = await tx.select().from(researchJobs).where(eq(researchJobs.id, job.id)).for('update');
    const linkedIds = (lockedRoot.config as ResearchConfig).companyPeopleRunIds || [];
    const current = linkedIds.length ? await tx.select().from(firmableSyncRuns).where(and(eq(firmableSyncRuns.organizationId, job.organizationId), inArray(firmableSyncRuns.id, linkedIds))) : [];
    const progress = companyPeopleProgress(current);
    await tx.update(researchJobs).set({ updatedAt: ['complete','partial','failed','cancelled'].includes(lockedRoot.status) ? lockedRoot.updatedAt : new Date(), config: sql`${researchJobs.config} || ${JSON.stringify({ companyPeopleProgress: progress })}::jsonb` }).where(eq(researchJobs.id, job.id));
    return progress;
  });
}
export async function queueCompanyPeople(job: Job, targetId: string, companyId: string) {
  if (!(job.config as ResearchConfig).includeCompanyPeople) return;
  const db = requireDb(), history = new FirmableHistoryRepository(db);
  if((job.config as ResearchConfig).companyIdentityPolicyVersion===1){
   const linked=await db.transaction(async tx=>{
    await canonicalPeopleLock(tx,job);
    const [root]=await tx.select().from(researchJobs).where(and(eq(researchJobs.id,job.id),eq(researchJobs.organizationId,job.organizationId))).for('update');
    if(!root||root.mandateId!==job.mandateId||root.createdBy!==job.createdBy||['cancelled','failed'].includes(root.status)||(root.config as ResearchConfig).companyIdentityPolicyVersion!==1)throw Error('Company contact source is no longer current');
    if(!(root.config as ResearchConfig).includeCompanyPeople)return false;
    const company=(await currentPeopleCompanies(tx,job,[targetId])).get(targetId);
    if(!company?.eligible||company.firmableId!==companyId)return false;
    const currentHistory=new FirmableHistoryRepository(tx);
    const run=await currentHistory.queueRun({organizationId:job.organizationId,actorId:job.createdBy,targetId,requestKey:`discovery:${job.id}:${targetId}`,trigger:'discovery'});
    if(run.trigger==='discovery'&&run.status==='queued')await currentHistory.linkRunCompany(run.id,companyId,'complete');
    await tx.update(researchJobs).set({config:sql`${researchJobs.config} || jsonb_build_object('companyPeopleRunIds', (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements_text(COALESCE(${researchJobs.config}->'companyPeopleRunIds', '[]'::jsonb) || ${JSON.stringify([run.id])}::jsonb)))`}).where(and(eq(researchJobs.id,job.id),eq(researchJobs.organizationId,job.organizationId)));
    return true;
   });
   if(linked)await tickCompanyPeople(job);
   return;
  }
  const [target] = await db.select().from(targets).where(and(eq(targets.id, targetId), eq(targets.organizationId, job.organizationId)));
  if (!target || !contactCompanyEligible(target.qualification, (target.firmographics as Record<string, unknown>).screening)) return;
  const run = await history.queueRun({ organizationId: job.organizationId, actorId: job.createdBy, targetId, requestKey: `discovery:${job.id}:${targetId}`, trigger: 'discovery' });
  if (run.trigger === 'discovery' && run.status === 'queued') await history.linkRunCompany(run.id, companyId, 'complete');
  const linked = await db.update(researchJobs).set({ config: sql`${researchJobs.config} || jsonb_build_object('companyPeopleRunIds', (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements_text(COALESCE(${researchJobs.config}->'companyPeopleRunIds', '[]'::jsonb) || ${JSON.stringify([run.id])}::jsonb)))` }).where(and(eq(researchJobs.id, job.id), eq(researchJobs.organizationId, job.organizationId), sql`${researchJobs.status} <> 'cancelled'`)).returning({ id: researchJobs.id });
  if (!linked.length) { await history.failRun(run.id, 'Company search cancelled'); return; }
  await tickCompanyPeople(job);
}

/** All recovery entry points share the root's locked admission policy. */
export async function recoverAutomaticCompanyPeople(organizationId: string, mandateId: string) {
  const roots = await requireDb().select().from(researchJobs).where(and(eq(researchJobs.organizationId, organizationId), eq(researchJobs.mandateId, mandateId), sql`jsonb_array_length(COALESCE(${researchJobs.config}->'companyPeopleRunIds', '[]'::jsonb)) > 0`, sql`${researchJobs.config}->>'parentJobId' IS NULL`));
  for (const root of roots) await withResearchJobWorkflow(root,()=>tickCompanyPeople(root));
}
