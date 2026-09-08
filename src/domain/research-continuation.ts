import { researchDomain, researchUrlKey, uniqueResearchUrls, type ResearchConfig } from './research';
export function automaticContinuation(job: {id:string;status:string;message:string;createdAt:Date;modelCalls:number;config:ResearchConfig}, now=Date.now()):ResearchConfig|null {
  const config=job.config, runtime=config.runtime;
  if(job.status!== 'partial' || !/Worker request budget reached/.test(job.message) || !runtime) return null;
  const pages=config.budget.maxPages-runtime.attempts.length;
  const minutes=Math.floor((job.createdAt.getTime()+config.budget.maxMinutes*60000-now)/60000);
  const retry=runtime.attempts.filter(a=>a.status!=='read').map(a=>a.url);
  const remaining=uniqueResearchUrls([...retry,...runtime.remaining]);
  if(pages<=0 || minutes<1 || !remaining.length || !runtime.attempts.length) return null;
  return {...config,autoContinueFrom:job.id,autoRoot:config.autoRoot||job.id,autoDomains:[...new Set([...(config.autoDomains||[]),...runtime.attempts.map(a=>researchDomain(a.url))])],
    discover:false,seeds:remaining.slice(0,10),budget:{...config.budget,maxPages:pages,maxModelCalls:Math.max(0,config.budget.maxModelCalls-job.modelCalls),maxMinutes:minutes},
    runtime:{remaining,visited:runtime.visited.filter(u=>!retry.some(r=>researchUrlKey(r)===researchUrlKey(u))),attempts:[]}};
}
