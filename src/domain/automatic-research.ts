import type { ResearchConfig } from './research';

// Internal limits protect against endless queues and unresponsive providers.
// They are operational ceilings, not controls the buyer needs to tune.
export const ENRICHMENT_CONCURRENCY = 2;
export function automaticResearchConfig(config: ResearchConfig): ResearchConfig {
  if (config.mode !== 'automatic' || config.workflow !== 'business') return config;
  const target = config.targetBusinesses || 20;
  return { ...config, autoRoot: undefined, autoContinueFrom: undefined, autoDomains: [], executionSlot: 0, targetBusinesses: target, strategy: 'discover',
    budget: { maxPages: 10, maxDomains: 10, maxModelCalls: 10, maxMinutes: 15 },
    companyBudget: { maxCompanies: target, maxPages: 12 },
    peopleBudget: config.findPeople ? { maxCompanies: target, maxPages: 12 } : undefined,
    peopleSearchesPerCompany: 2,
    automaticPageLimit: Math.min(1000, Math.max(100, target * 15)),
    automaticDeadline: Date.now() + 2 * 60 * 60 * 1000,
    automaticPagesUsed: 0,
  };
}

export function automaticBatch(job: { id: string; status: string; config: ResearchConfig }, now = Date.now()): ResearchConfig | null {
  const c = job.config, runtime = c.runtime;
  if (c.mode !== 'automatic' || c.purpose || job.status !== 'partial' || !runtime || (!runtime.remaining.length && !c.discoveryPending) || (!runtime.attempts.length && !c.discoveryPending)) return null;
  if (new Set(c.newBusinessIds || []).size >= (c.targetBusinesses || 20)) return null;
  const used = (c.automaticPagesUsed || 0) + runtime.attempts.length;
  if (used >= (c.automaticPageLimit || 100) || now >= (c.automaticDeadline || 0)) return null;
  // Never retry failed pages automatically; carry forward only unread sources.
  return { ...c, autoRoot: c.autoRoot || job.id, autoContinueFrom: job.id,
    researchRunId: c.researchRunId || job.id, executionSlot: 0,
    automaticPagesUsed: used, autoDomains: [], discover: Boolean(c.discoveryPending),
    seeds: runtime.remaining.slice(0, 10),
    budget: { ...c.budget, maxPages: Math.min(10, (c.automaticPageLimit || 100) - used), maxMinutes: Math.min(15, Math.max(1, Math.ceil(((c.automaticDeadline || 0) - now) / 60000))) },
    runtime: { remaining: runtime.remaining, visited: runtime.visited, attempts: [] },
  };
}
