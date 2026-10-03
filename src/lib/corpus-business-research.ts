import { chooseBalancedTask } from '@/domain/balanced-research';
import { createHash } from 'node:crypto';
import { parallelBusinessTasks } from './parallel-business-research';
import { dispatchBalancedBusinessResearch } from './balanced-business-research';
import type { ResearchSchedulingSnapshot } from './research-scheduling-snapshot';
import { terminalResearchStates, type ResearchConfig, type ResearchFinding } from '@/domain/research';
import { fieldSatisfied } from '@/domain/research-objectives';
import { ownCompany, relevantBusiness } from '@/domain/business-research';
function companyId(root:string,domain:string){const h=createHash('sha256').update(`${root}:corpus:${domain}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
export function corpusBusinessTasks(snapshot:ResearchSchedulingSnapshot){
 const related=snapshot.jobs.filter(j=>(j.config as ResearchConfig).researchRunId===snapshot.root.id);
 const allowedJobs=new Set([snapshot.root.id,...related.map(j=>j.id)]);
 const planned=parallelBusinessTasks(snapshot);
 return planned.flatMap<{id:string;config:ResearchConfig}>(task=>{
  if(task.config.researchTask==='page')return[];
  if(task.config.researchTask==='website')return[{id:companyId(snapshot.root.id,task.config.companyDomain!),config:{...task.config,pipelineDesign:'corpus-v1' as const,researchTask:'company' as const,budget:{maxPages:11,maxDomains:1,maxModelCalls:2,maxMinutes:3}}}];
  const collection=related.find(j=>(j.config as ResearchConfig).researchTask==='company'&&(j.config as ResearchConfig).companyDomain===task.config.companyDomain);
  if(!collection||!terminalResearchStates.includes(collection.status))return[];
  const target=snapshot.members.find(m=>m.target.domain?.replace(/^www\./,'')===task.config.companyDomain)?.target;
  if(!target)return[];
  const facts=snapshot.findings.filter(f=>f.targetId===target.id&&allowedJobs.has(f.jobId)).map(f=>f.evidence as ResearchFinding);
  if(!ownCompany(facts,`https://${task.config.companyDomain}/`)||!relevantBusiness(facts)||fieldSatisfied(task.config.researchField!,facts))return[];
  return[{...task,config:{...task.config,pipelineDesign:'corpus-v1' as const,targetId:target.id,companyName:target.companyName,inheritedFindings:facts,budget:{maxPages:3,maxDomains:3,maxModelCalls:3,maxMinutes:2}}}];
 });
}
export function chooseCorpusTask<T extends {config:{researchTask?:string;researchField?:string;companyDomain?:string}}>(pending:T[],active:{config:{researchTask?:string;researchField?:string;companyDomain?:string}}[]){
 const collections=pending.filter(t=>t.config.researchTask==='company');
 const fields=pending.filter(t=>t.config.researchTask==='field');
 if(active.filter(t=>t.config.researchTask==='company').length<8&&collections.length)return chooseBalancedTask(collections,active);
 return chooseBalancedTask(fields,active)||chooseBalancedTask(collections,active);
}
export async function dispatchCorpusBusinessResearch(org:string,root:string,snapshot?:ResearchSchedulingSnapshot){
 return dispatchBalancedBusinessResearch(org,root,snapshot,{plan:corpusBusinessTasks,maxJobs:12,choose:chooseCorpusTask});
}
