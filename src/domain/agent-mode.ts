import { criterionDefinitions, type AcquisitionBrief, type MandateView } from './acquisition';
import { researchJobRunning, terminalResearchStates } from './research';

/** A preview contract, not delegated authority for communication or scheduling. */
export function researchPlan(brief: AcquisitionBrief) {
  return {
    scope: 'research-only' as const,
    requiresReview: true as const,
    outreachEnabled: false as const,
    bookingEnabled: false as const,
    description: brief.naturalLanguage,
    unconfirmedCriteria: brief.criteria.filter(c => c.state === 'unknown' || !c.confirmed).map(c => criterionDefinitions.find(([key]) => key === c.key)?.[1] || c.key),
    steps: ['Save the reviewed mandate', 'Discover companies and enrich supported facts', 'Review evidence in the existing company workspace'],
  };
}
export type AgentResearchJob = { id?: string; status: string; updatedAt?: Date | string; message?: string; pages?: number; modelCalls?: number };
export type InitialMandateResearchView={requestId:string;status:string;jobId?:string;source?:'cached'|'live';candidates?:number;companies?:number;people?:number;blocker?:{code:string;message:string}};
export function agentSnapshot(mandate: MandateView, jobs: AgentResearchJob[],initialResearch?:InitialMandateResearchView) {
  const fixtureName = /^Test mandate (?:[a-fA-F0-9]{8}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})$/.test(mandate.brief.name);
  const subsectors = mandate.brief.criteria.find(c => c.key === 'subsectors')?.value.trim();
  return {
    ...(initialResearch?{initialResearch}:{}),
    mandate: { id: mandate.id, name: mandate.brief.name, ...(fixtureName && subsectors ? { displayName: subsectors } : {}), description: mandate.brief.naturalLanguage },
    scope: 'research-only' as const,
    research: {
      total: jobs.length,
      queued: jobs.filter(job => job.status === 'queued' && researchJobRunning(job)).length,
      active: jobs.filter(job => job.status !== 'queued' && researchJobRunning(job)).length,
      complete: jobs.filter(job => job.status === 'complete').length,
      needsReview: jobs.filter(job => ['failed', 'partial'].includes(job.status) || (!terminalResearchStates.includes(job.status) && !researchJobRunning(job))).length,
      cancelled: jobs.filter(job => job.status === 'cancelled').length,
    },
    jobs: jobs.slice(0, 10).map(job => ({
      id: job.id, status: job.status, updatedAt: job.updatedAt,
      message: job.message?.slice(0, 500), pages: job.pages ?? 0, modelCalls: job.modelCalls ?? 0,
    })),
    links: { brief: `/mandates/${mandate.id}?tab=brief`, companies: `/mandates/${mandate.id}?tab=targets` },
  };
}
export type AgentSnapshot = ReturnType<typeof agentSnapshot>;

/** Human contact reviews stay small; further groups require another explicit review. */
export const agentContactReviewBatchSize = 5;
