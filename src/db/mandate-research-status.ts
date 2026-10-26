import {sql} from 'drizzle-orm';
import type {ResearchPersistenceDatabase} from '@/lib/research-persistence-lock';
import {mandateResearchStatus,type MandateResearchStatus} from '@/domain/mandate-research-status';

/** One compact, read-only query for the list; no per-card polling or job recovery. */
export function mandateResearchStatusQuery(organizationId:string,mandateIds:string[]){
  return sql`SELECT m.id,root.status,root.config->'companyPeopleProgress' AS people,
    counts.queued,counts.active,counts.partial,counts.failed,counts.cancelled
    FROM mandates m
    LEFT JOIN LATERAL (
      SELECT j.id,j.status,j.config FROM research_jobs j
      WHERE j.organization_id=m.organization_id AND j.mandate_id=m.id
      ORDER BY (COALESCE(j.config->>'purpose','')='' AND COALESCE(j.config->>'discoveryCandidate','false')<>'true'
        AND COALESCE(j.config->>'researchTask','')='') DESC,j.created_at DESC,j.id DESC LIMIT 1
    ) root ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE j.status='queued')::int AS queued,
        count(*) FILTER (WHERE j.status NOT IN ('queued','complete','partial','failed','cancelled'))::int AS active,
        count(*) FILTER (WHERE j.status='partial')::int AS partial,
        count(*) FILTER (WHERE j.status='failed')::int AS failed,
        count(*) FILTER (WHERE j.status='cancelled')::int AS cancelled
      FROM research_jobs j WHERE j.organization_id=m.organization_id AND j.mandate_id=m.id
        AND (j.id=root.id OR j.config->>'researchRunId'=COALESCE(NULLIF(root.config->>'researchRunId',''),root.id::text)
          OR j.config->>'parentJobId'=root.id::text OR j.config->'companyBackgroundResearch'->>'sourceRootId'=root.id::text)
    ) counts ON true
    WHERE m.organization_id=${organizationId} AND m.id IN (${sql.join(mandateIds.map(id=>sql`${id}::uuid`),sql`, `)})`;
}

export async function loadMandateResearchStatuses(database:ResearchPersistenceDatabase,organizationId:string,mandateIds:string[]){
  const statuses=new Map<string,MandateResearchStatus>();
  if(!mandateIds.length)return statuses;
  const result=await database.execute(mandateResearchStatusQuery(organizationId,mandateIds));
  type Row=Parameters<typeof mandateResearchStatus>[0]&{id:string};
  const rows=(Array.isArray(result)?result:(result as {rows:Row[]}).rows) as Row[];
  for(const row of rows)statuses.set(row.id,mandateResearchStatus(row));
  return statuses;
}
