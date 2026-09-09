import { createHash } from 'node:crypto';
import { ResearchRepository } from '@/db/research-repository';
import { automaticContinuation } from '@/domain/research-continuation';
import { terminalResearchStates, type ResearchConfig } from '@/domain/research';
import { researchWorker } from './research-service';
export async function dispatchContinuation(org:string, id:string) {
  const repo=new ResearchRepository(org), job=await repo.get(id);
  if(!job) return false;
  if ((job.config as ResearchConfig).researchRunId) {
    const root = await repo.get((job.config as ResearchConfig).researchRunId!);
    if (!root || root.status === 'cancelled') return false;
  }
  // Check the deterministic child before recomputing its time allowance on callback retries.
  const hash=createHash('sha256').update(`${id}:automatic-continuation`).digest('hex');
  const childId=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const existing=await repo.get(childId);
  if(existing) { if(existing.status==='queued') await researchWorker(`/jobs/${childId}`,'POST'); return true; }
  const config=automaticContinuation({...job,config:job.config as ResearchConfig});
  if(!config) return false;
  const child=await repo.create(childId,job.mandateId,job.createdBy,config);
  if (config.researchRunId) {
    const root = await repo.get(config.researchRunId);
    if (!root || root.status === 'cancelled') { await repo.cancelRun(config.researchRunId); return false; }
  }
  if(!terminalResearchStates.includes(child.status)) await researchWorker(`/jobs/${child.id}`,'POST');
  return true;
}
