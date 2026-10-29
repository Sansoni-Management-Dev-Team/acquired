import {completesWorkItems} from '@/domain/research-completion';
import {mandateResearchStatus} from '@/domain/mandate-research-status';
import type {ResearchConfig} from '@/domain/research';

/** Correlated with the original root alias j in either read-only projection.
 * Later runs, other owners and other workflow executions cannot affect it. */
export const initialResearchSummarySql=`(SELECT jsonb_build_object(
 'queued',count(*) FILTER(WHERE child.status='queued'),
 'active',count(*) FILTER(WHERE child.status NOT IN('queued','complete','partial','failed','cancelled')),
 'partial',count(*) FILTER(WHERE child.status='partial'),
 'failed',count(*) FILTER(WHERE child.status='failed'),
 'cancelled',count(*) FILTER(WHERE child.status='cancelled'))
 FROM research_jobs child WHERE child.organization_id=j.organization_id
 AND child.mandate_id=j.mandate_id AND child.created_by=j.created_by
 AND child.workflow_execution_id IS NOT DISTINCT FROM j.workflow_execution_id
 AND(child.id=j.id OR child.config->>'researchRunId'=COALESCE(NULLIF(j.config->>'researchRunId',''),j.id::text)
 OR child.config->>'parentJobId'=j.id::text OR child.config->'companyBackgroundResearch'->>'sourceRootId'=j.id::text)) AS research_summary`;

type Summary=Pick<Parameters<typeof mandateResearchStatus>[0],'queued'|'active'|'partial'|'failed'|'cancelled'>;
/** Keep existing running-stage labels while applying the shared completeness rules. */
export function initialResearchStatus(status:string,config:ResearchConfig,summary?:Summary):string{
 if(!['complete','partial'].includes(status)&&!(completesWorkItems(config)&&status==='failed'))return status;
 const aggregate=mandateResearchStatus({queued:0,active:0,partial:0,failed:0,cancelled:0,...summary,status,people:config.companyPeopleProgress});
 return aggregate==='running'?'extracting':aggregate;
}
