import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { requireDb } from './client';
import { researchJobs } from './schema';
import { AcquisitionRepository } from './acquisition-repository';
import { loadWorkspaceContacts } from './firmable-read-model';
import { researchActive, terminalResearchStates, type ResearchConfig } from '@/domain/research';
import { companyListPage, summariseCompany, type CompanyList, type CompanyListQuery, type CompanyEnrichment } from '@/domain/company-list';

export class CompanyListRepository {
  constructor(private org: string, private db = requireDb()) {}
  async load(id: string, query: CompanyListQuery, previous?: string): Promise<CompanyList | { unchanged: true; active: boolean; revision: string } | null> {
    const repo = new AcquisitionRepository(this.org, this.db);
    const mandate = await repo.getMandate(id);
    if (!mandate) return null;
    // Progress checks transfer only fields needed for activity and company association.
    const jobs = await this.db.select({ id: researchJobs.id, status: researchJobs.status, updatedAt: researchJobs.updatedAt,
      config: sql<ResearchConfig>`jsonb_build_object('mode', ${researchJobs.config}->'mode', 'purpose', ${researchJobs.config}->'purpose', 'discoveryCandidate', ${researchJobs.config}->'discoveryCandidate', 'automaticDeadline', ${researchJobs.config}->'automaticDeadline', 'companyBackgroundResearch', ${researchJobs.config}->'companyBackgroundResearch', 'targetId', ${researchJobs.config}->'targetId', 'companyDomain', ${researchJobs.config}->'companyDomain', 'newBusinessIds', ${researchJobs.config}->'newBusinessIds')`,
      seeds: researchJobs.seeds,
    }).from(researchJobs).where(and(eq(researchJobs.organizationId, this.org), eq(researchJobs.mandateId, id))).orderBy(sql`${researchJobs.createdAt} DESC`);
    // Hash dependencies inside PostgreSQL: unchanged polls never transfer findings,
    // target profiles, contacts, or execution JSON. Hashes include deletions and edits.
    const optionalSchema=await this.db.execute(sql`SELECT to_regclass('public.company_identity_accepted_observations') IS NOT NULL AS installed`);
    const flags=(Array.isArray(optionalSchema)?optionalSchema:(optionalSchema as {rows:{installed:boolean}[]}).rows) as {installed:boolean}[];
    if(flags.length!==1||typeof flags[0].installed!=='boolean')throw Error('Company observation availability could not be verified.');
    const observationDependency=flags[0].installed?sql`UNION ALL SELECT 'accepted-observation', o.id::text, md5(o.input_digest || ':' || o.observed_at::text || ':' || o.created_at::text || ':' || o.target_id::text) FROM public.company_identity_accepted_observations o WHERE o.organization_id=${this.org} AND o.mandate_id=${id}::uuid AND o.target_id IN (SELECT id FROM linked)`:sql.empty();
    const result = await this.db.execute(sql`
      WITH linked AS (SELECT t.* FROM public.targets t JOIN public.mandate_targets m ON m.target_id=t.id AND m.organization_id=t.organization_id WHERE m.organization_id=${this.org} AND m.mandate_id=${id}),
      shared AS (SELECT DISTINCT f.id FROM public.firmable_companies f JOIN linked t ON f.id=t.firmable_company_id OR f.domain=lower(regexp_replace(t.domain, '^www[.]', '')) OR f.abn=regexp_replace(t.identifiers->>'abn', '[^0-9]', '', 'g')),
      dependencies AS (
        SELECT 'targets' AS source, t.id::text AS id, md5(to_jsonb(t)::text) AS hash FROM linked t
        UNION ALL SELECT 'memberships', m.target_id::text, md5(to_jsonb(m)::text) FROM public.mandate_targets m WHERE m.organization_id=${this.org} AND m.mandate_id=${id}
        UNION ALL SELECT 'findings', f.id::text, md5(to_jsonb(f)::text) FROM public.research_findings f WHERE f.organization_id=${this.org} AND f.target_id IN (SELECT id FROM linked)
        UNION ALL SELECT 'contacts', c.id::text, md5(to_jsonb(c)::text) FROM public.contacts c WHERE c.organization_id=${this.org} AND c.target_id IN (SELECT id FROM linked)
        UNION ALL SELECT 'signals', s.id::text, md5(to_jsonb(s)::text) FROM public.signals s WHERE s.organization_id=${this.org} AND s.target_id IN (SELECT id FROM linked)
        UNION ALL SELECT 'organisation', o.id, md5(coalesce(o.metadata::text,'')) FROM public.organization o WHERE o.id=${this.org}
        UNION ALL SELECT 'company-responses', r.id::text, md5(to_jsonb(r)::text) FROM public.firmable_company_responses r WHERE r.firmable_company_id IN (SELECT id FROM shared)
        UNION ALL SELECT 'people-responses', r.id::text, md5(to_jsonb(r)::text) FROM public.firmable_person_responses r WHERE r.firmable_person_id IN (SELECT firmable_person_id FROM public.firmable_company_people WHERE firmable_company_id IN (SELECT id FROM shared))
        UNION ALL SELECT 'company-people', r.firmable_company_id || ':' || r.firmable_person_id, md5(to_jsonb(r)::text) FROM public.firmable_company_people r WHERE r.firmable_company_id IN (SELECT id FROM shared)
        UNION ALL SELECT 'enrichment', r.id::text, md5(to_jsonb(r)::text) FROM public.firmable_sync_runs r WHERE r.organization_id=${this.org} AND r.target_id IN (SELECT id FROM linked)
        ${observationDependency}
      ) SELECT md5(coalesce(string_agg(source || ':' || id || ':' || hash, ',' ORDER BY source,id),'')) AS revision FROM dependencies`);
    const rows = Array.isArray(result) ? result : (result as { rows: { revision: string }[] }).rows;
    const activeEnrichment = await this.db.execute(sql`SELECT r.id,r.target_id AS "targetId",t.company_name AS name,r.status,r.message,r.profiles_found AS "profilesFound",r.profiles_saved AS "profilesSaved",r.profiles_failed AS "profilesFailed" FROM public.firmable_sync_runs r JOIN public.mandate_targets m ON m.target_id=r.target_id AND m.organization_id=r.organization_id JOIN public.targets t ON t.id=m.target_id AND t.organization_id=m.organization_id WHERE m.organization_id=${this.org} AND m.mandate_id=${id} AND r.status IN ('queued','running') ORDER BY r.created_at DESC`);
    const enrichmentRows = (Array.isArray(activeEnrichment) ? activeEnrichment : (activeEnrichment as { rows: CompanyEnrichment[] }).rows) as CompanyEnrichment[];
    const backgroundPending=jobs.some(job=>job.config.companyBackgroundResearch&&!terminalResearchStates.includes(job.status));
    const active = researchActive(jobs) || backgroundPending || enrichmentRows.length > 0;
    const signatureJobs = jobs.map(j => ({ status: j.status, config: j.config, seeds: j.seeds, deadlineReached: Boolean(j.config.automaticDeadline&&j.config.automaticDeadline<=Date.now()) }));
    const revision = createHash('sha256').update(JSON.stringify(['fit-research-state-v2',rows[0]?.revision, mandate, signatureJobs, query])).digest('hex');
    if (previous === revision) return { unchanged: true, active, revision };
    const memberships = await repo.memberships(id);
    const contacts = await loadWorkspaceContacts(this.db, this.org, memberships);
    const summaries = memberships.map(member => summariseCompany(member, mandate, jobs.map(j => ({ status: j.status, ...j.config, seeds: j.seeds as string[] })), contacts.some(c => c.targetId === member.target.id && Boolean(c.name?.trim()))));
    return { mandate, revision, active, hasResearch: jobs.length > 0, enrichment: enrichmentRows, ...companyListPage(summaries, query) };
  }
}
