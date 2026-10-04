import { dispatchCorpusBusinessResearch } from './corpus-business-research';
import { dispatchBalancedBusinessResearch } from './balanced-business-research';
import type { ResearchConfig } from '@/domain/research';
import { randomUUID } from 'node:crypto';
import { ResearchRepository } from '@/db/research-repository';
import { requestSchedulingLease, finishSchedulingPass } from '@/db/research-scheduler-repository';
import { dispatchDiscoveryCandidates } from './automatic-discovery';
import { dispatchAutomaticEnrichment } from './automatic-enrichment';
import { dispatchContinuation } from './research-continuation';
import { loadResearchSchedulingSnapshot } from './research-scheduling-snapshot';
import { dispatchParallelBusinessResearch } from './parallel-business-research';
export async function scheduleResearchRun(org:string,jobId:string, options:{recovery?:boolean}={}) {
 const job=await new ResearchRepository(org).getExecution(jobId);
 if(!job || job.status==='cancelled') return false;
 const rootId=(job.config as ResearchConfig).researchRunId || job.id;
 const root=rootId===job.id?job:await new ResearchRepository(org).getExecution(rootId);
 if(!root || root.status==='cancelled') return false;
 if(['firmable-v1','web-firmable-v1','hybrid-firmable-v1'].includes((root.config as ResearchConfig).pipelineDesign||''))return false;
 const dispatchBusiness = (root.config as ResearchConfig).pipelineDesign === 'corpus-v1' ? dispatchCorpusBusinessResearch : (root.config as ResearchConfig).pipelineDesign === 'balanced-v1' ? dispatchBalancedBusinessResearch : dispatchParallelBusinessResearch;
 if(!((root.config as ResearchConfig).performanceFlags as {schedulerCoalescing?:boolean}|undefined)?.schedulerCoalescing) {
  await dispatchContinuation(org,jobId);
  if ((root.config as ResearchConfig).parallelBusinessResearch) await dispatchBusiness(org,rootId);
  else {
   await dispatchDiscoveryCandidates(org,jobId);
   await dispatchAutomaticEnrichment(org,jobId);
  }
  return true;
 }
 const owner=randomUUID();
 const lease=await requestSchedulingLease(org,rootId,owner,Boolean(options.recovery));
 if(!lease.acquired) return false;
 let generation=lease.generation;
 // Failure deliberately leaves the short lease/pending generation intact. A
 // recovery poll reclaims it; durable queued jobs use deterministic dispatch IDs.
 for(let pass=0;pass<4;pass++) {
  const snapshot=await loadResearchSchedulingSnapshot(org,rootId);
  if(snapshot) {
   snapshot.schedulingLease={owner,generation};
   for(const candidate of [...snapshot.jobs]) if(candidate.id===rootId || (candidate.config as ResearchConfig).researchRunId===rootId) await dispatchContinuation(org,candidate.id,snapshot);
   if ((root.config as ResearchConfig).parallelBusinessResearch) await dispatchBusiness(org,rootId,snapshot);
   else {
    await dispatchDiscoveryCandidates(org,rootId,snapshot);
    await dispatchAutomaticEnrichment(org,rootId,snapshot);
   }
  }
  const result=await finishSchedulingPass(org,rootId,owner,generation);
  if(!result.again) return true;
  generation=result.generation;
 }
 // Bound request lifetime under a stream of events. The lease expires and the
 // already persisted pending generation is recovered by a later event/poll.
 return true;
}
