import type { MandateView, MembershipView } from './acquisition';
import { reviewMandateFit } from './mandate-fit';
import { businessResearchStatus } from './business-research';
import { researchDomain, terminalResearchStates } from './research';

export type CompanySummary = {
  id: string; name: string; domain: string; sector: string; stage: string;
  accreditations: string[]; researchStatus: string;
  hasHeadcount: boolean; hasRevenue: boolean; hasPerson: boolean;
  fit: ReturnType<typeof reviewMandateFit>;
};
export type CompanyListQuery = { search: string; stage: string; research: string; data: string; accreditation: string; page: number };
export const defaultCompanyListQuery: CompanyListQuery = { search: '', stage: 'all', research: 'all', data: 'all', accreditation: '', page: 1 };
export const COMPANY_PAGE_SIZE = 25;
export type CompanyEnrichment = { id: string; targetId: string; name: string; status: string; message: string; profilesFound: number; profilesSaved: number; profilesFailed: number };
export type CompanyList = { mandate: MandateView; revision: string; active: boolean; hasResearch: boolean; rows: CompanySummary[]; total: number; page: number; pages: number; enrichment?: CompanyEnrichment[] };
export type CompanyStatusJob = { status: string; targetId?: string; companyDomain?: string; newBusinessIds?: string[]; seeds: string[] };

export function summariseCompany(member: MembershipView, mandate: MandateView, jobs: CompanyStatusJob[], hasContact: boolean): CompanySummary {
  const { target } = member;
  const findings = member.researchFindings || [];
  const has = (kind: string) => findings.some(f => f.evidence.kind === kind);
  const researching = jobs.some(j => !terminalResearchStates.includes(j.status) && (j.targetId === target.id || j.newBusinessIds?.includes(target.id) || Boolean(target.domain && (j.companyDomain === target.domain || j.seeds.some(url => researchDomain(url) === target.domain)))));
  return { id: target.id, name: target.companyName, domain: target.domain, sector: target.sector.value || '', stage: member.assessment.stage,
    accreditations: member.accreditations.map(a => `${a.issuer} ${a.scope}`),
    researchStatus: businessResearchStatus(target.domain, findings.map(f => f.evidence), researching),
    hasHeadcount: target.headcount.value !== null || has('headcount'), hasRevenue: target.revenue.value !== null || has('revenue'), hasPerson: hasContact || has('person'),
    fit: reviewMandateFit(mandate.brief, target, member.assessment, findings) };
}

export function companyListPage(rows: CompanySummary[], query: CompanyListQuery) {
  const search = query.search.trim().toLowerCase(), accreditation = query.accreditation.trim().toLowerCase();
  const statuses: Record<string, string> = { ready: 'Ready to review', researching: 'Researching', 'needs-evidence': 'Needs more evidence' };
  const filtered = rows.filter(row => `${row.name} ${row.domain} ${row.sector}`.toLowerCase().includes(search)
    && (query.stage === 'all' || row.stage === query.stage)
    && (!accreditation || row.accreditations.some(value => value.toLowerCase().includes(accreditation)))
    && (query.research === 'all' || row.researchStatus === statuses[query.research])
    && (query.data === 'all' || query.data === 'headcount' && row.hasHeadcount || query.data === 'revenue' && row.hasRevenue || query.data === 'person' && row.hasPerson));
  filtered.sort((a, b) => b.fit.score - a.fit.score || (Number(b.hasHeadcount) + Number(b.hasRevenue) + Number(b.hasPerson)) - (Number(a.hasHeadcount) + Number(a.hasRevenue) + Number(a.hasPerson)));
  const pages = Math.max(1, Math.ceil(filtered.length / COMPANY_PAGE_SIZE)), page = Math.min(query.page, pages);
  return { rows: filtered.slice((page - 1) * COMPANY_PAGE_SIZE, page * COMPANY_PAGE_SIZE), total: filtered.length, page, pages };
}
