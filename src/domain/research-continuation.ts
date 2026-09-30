import { automaticBatch } from "./automatic-research";
import { researchDomain, researchUrlKey, uniqueResearchUrls, type ResearchConfig } from './research';
export function automaticContinuation(job: {id:string;status:string;message:string;createdAt:Date;modelCalls:number;config:ResearchConfig}, now=Date.now()):ResearchConfig|null {
  const config=job.config, runtime=config.runtime;
  if (config.mode === "automatic" && !config.purpose && !config.discoveryCandidate && !config.researchTask) return automaticBatch(job, now);
  const capacityResume = config.targetedSearchDeferred === true && config.targetedFollowup && Boolean(config.purpose) && (!config.researchTask || config.researchTask === 'field');
  if(job.status!== 'partial' || (!capacityResume && !/Worker request budget reached|Browser admission deferred|Fallback reader admission deferred/.test(job.message)) || !runtime) return null;
  const noProgress = runtime.attempts.every(a => a.status === 'pending');
  const admissionContinuations = noProgress ? (config.admissionContinuations || 0) + 1 : 0;
  if (admissionContinuations > 2) return null;
  const pages=config.budget.maxPages-runtime.attempts.filter(a=>a.status !== 'pending').length;
  const deadline=Math.min(job.createdAt.getTime()+config.budget.maxMinutes*60000, config.automaticDeadline ?? Infinity);
  const minutes=Math.floor((deadline-now)/60000);
  const retry=runtime.attempts.filter(a=>a.status!=='read').map(a=>a.url);
  const remaining=uniqueResearchUrls([...retry,...runtime.remaining]);
  if(pages<=0 || minutes<1 || ((!remaining.length || !runtime.attempts.length) && !capacityResume)) return null;
  return {...config,...(capacityResume ? {targetedSearchDeferred:false} : {}),admissionContinuations,autoContinueFrom:job.id,autoRoot:config.autoRoot||job.id,autoDomains:[...new Set([...(config.autoDomains||[]),...runtime.attempts.map(a=>researchDomain(a.url))])],
    discover:false,seeds:remaining.slice(0,10),budget:{...config.budget,maxPages:pages,maxModelCalls:Math.max(0,config.budget.maxModelCalls-job.modelCalls),maxMinutes:minutes},
    runtime:{remaining,visited:runtime.visited.filter(u=>!retry.some(r=>researchUrlKey(r)===researchUrlKey(u))),attempts:[],...(runtime.pendingPage ? {pendingPage:runtime.pendingPage} : {})}};
}
