import type { ResearchSchedulingSnapshot } from './research-scheduling-snapshot';
import { createHash } from 'node:crypto';
import { ResearchRepository } from '@/db/research-repository';
import { automaticContinuation } from '@/domain/research-continuation';
import { terminalResearchStates, type ResearchConfig } from '@/domain/research';
import { researchWorker } from './research-service';
export async function dispatchContinuation(org:string, id:string, snapshot?:ResearchSchedulingSnapshot) {
  const repo=new ResearchRepository(org), job=snapshot?.jobs.find(j=>j.id===id) || await repo.get(id);
  if(!job) return false;
  if ((job.config as ResearchConfig).researchRunId) {
    const root = snapshot?.root || await repo.get((job.config as ResearchConfig).researchRunId!);
    if (!root || root.status === 'cancelled') return false;
  }
  // Check the deterministic child before recomputing its time allowance on callback retries.
  const hash=createHash('sha256').update(`${id}:automatic-continuation`).digest('hex');
  const childId=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const existing=snapshot ? snapshot.jobs.find(j=>j.id===childId) : await repo.get(childId);
  if(existing) { if(existing.status==='queued' && !snapshot?.dispatched.has(childId)) { await researchWorker(`/jobs/${childId}`,'POST'); snapshot?.dispatched.add(childId); } return true; }
  const config=automaticContinuation({...job,config:job.config as ResearchConfig});
  if(!config) return false;
  const child=await repo.create(childId,job.mandateId,job.createdBy,config);
  if(snapshot && !snapshot.jobs.some(j=>j.id===child.id)) snapshot.jobs.push(child);
  if (config.researchRunId) {
    const root = await repo.get(config.researchRunId);
    if (!root || root.status === 'cancelled') { await repo.cancelRun(config.researchRunId); return false; }
  }
  if(!terminalResearchStates.includes(child.status) && !snapshot?.dispatched.has(child.id)) { await researchWorker(`/jobs/${child.id}`,'POST'); snapshot?.dispatched.add(child.id); }
  return true;
}
