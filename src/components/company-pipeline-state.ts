import { terminalResearchStates } from '@/domain/research';
import type { ResearchJob } from './research-panel';

function secondaryResearch(job:ResearchJob){return job.config.purpose==='people' || Boolean('companyBackgroundResearch' in job.config && job.config.companyBackgroundResearch);}

export function isCompanyPipeline(job: ResearchJob) {
  return ['firmable-v1', 'web-firmable-v1', 'hybrid-firmable-v1'].includes(job.config.pipelineDesign || '');
}
export function researchRoot(jobs: ResearchJob[], id?: string) {
  if (id) return jobs.find(job => job.id === id);
  const roots = jobs.filter(job => !job.config.purpose && !job.config.discoveryCandidate && !job.config.researchTask);
  return roots.find(job => !terminalResearchStates.includes(job.status)) || roots[0];
}

export type CompanyResearchCoverage = Partial<Record<'size' | 'revenue' | 'abn', number>>;

// Web discovery stores saved IDs and evidence coverage separately from company
// pipeline profiles. Both paths use the same progress screen.
export function companyResearchProgressState(root: ResearchJob, jobs: ResearchJob[], summary: { coverage?: CompanyResearchCoverage; peopleSaved?: number } = {}) {
  const state = companyPipelineState(root, jobs);
  if (isCompanyPipeline(root)) return state;
  const runId = root.config.researchRunId || root.id;
  const scoped = [...new Map([root, ...jobs].filter(job => job.id === root.id || job.config.researchRunId === runId || job.config.parentJobId === runId).map(job => [job.id, job])).values()];
  const companies = scoped.filter(job => job.config.discoveryCandidate || job.id === root.id && !job.config.discover);
  const people = scoped.filter(job => job.config.purpose === 'people');
  return {
    ...state,
    savedIds: [...new Set(scoped.flatMap(job => job.config.newBusinessIds || []))],
    settled: terminalResearchStates.includes(root.status) && scoped.filter(job=>!secondaryResearch(job)).every(job => terminalResearchStates.includes(job.status)),
    processed: companies.filter(job => terminalResearchStates.includes(job.status)).length,
    active: companies.filter(job => !terminalResearchStates.includes(job.status)).length,
    headcounts: summary.coverage?.size || 0,
    revenueBands: summary.coverage?.revenue || 0,
    abns: summary.coverage?.abn || 0,
    peopleSaved: summary.peopleSaved || 0,
    peopleActive: people.filter(job => job.status !== 'queued' && !terminalResearchStates.includes(job.status)).length,
    peopleQueued: people.filter(job => job.status === 'queued').length,
  };
}
export function companyPipelineState(root: ResearchJob, jobs: ResearchJob[]) {
  const runId = root.config.researchRunId || root.id;
  const scoped = [...new Map(jobs.filter(job => job.id === root.id || job.config.researchRunId === runId || job.config.parentJobId === runId).map(job => [job.id, job])).values()];
  const children = scoped.filter(job => job.config.researchTask === 'company');
  const savedIds = [...new Set(children.filter(job => ['complete','partial'].includes(job.status) && job.config.targetId).map(job => job.config.targetId!))];
  const people = root.config.companyPeopleProgress;
  const background=scoped.filter(job=>Boolean('companyBackgroundResearch' in job.config && job.config.companyBackgroundResearch));
  const settled = terminalResearchStates.includes(root.status) && scoped.filter(job=>!secondaryResearch(job)).every(job => terminalResearchStates.includes(job.status));
  const config = root.config as typeof root.config & { webSearchPages?: Record<string, { ok: boolean }>; firmableSearchPages?: Record<string, unknown> };
  return { savedIds, settled, backgroundActive:background.filter(job=>job.status!=='queued'&&!terminalResearchStates.includes(job.status)).length,backgroundQueued:background.filter(job=>job.status==='queued').length,backgroundFailed:background.filter(job=>['failed','partial'].includes(job.status)).length,peopleSettled:people?.settled??true, peopleFound: people?.found || 0, peopleSaved: people?.saved || 0, peopleActive: people?.active || 0, peopleQueued: people?.queued || 0, processed: children.filter(job => terminalResearchStates.includes(job.status)).length,
    active: children.filter(job => !terminalResearchStates.includes(job.status)).length,
    failed: children.filter(job => ['failed', 'partial'].includes(job.status)).length,
    headcounts: children.filter(job => { const profile = (job.config as typeof job.config & { firmableProfile?: { headcountExact?: number | null; headcountBand?: unknown } }).firmableProfile; return profile?.headcountExact != null || profile?.headcountBand != null; }).length,
    revenueBands: children.filter(job => (job.config as typeof job.config & { firmableProfile?: { revenueBand?: unknown } }).firmableProfile?.revenueBand != null).length,
    matched: children.filter(job => (job.config as typeof job.config & { firmableMatch?: string }).firmableMatch === 'matched').length,
    abns: children.filter(job => { const lookup = (job.config as typeof job.config & { abnLookup?: { status: string; abn?: string } }).abnLookup; return lookup?.status === 'matched' && lookup.abn; }).length,
    webSearches: Object.values(config.webSearchPages || {}).length,
    webFailures: Object.values(config.webSearchPages || {}).filter(page => !page.ok).length,
    firmableSearches: Object.values(config.firmableSearchPages || {}).length };
}
