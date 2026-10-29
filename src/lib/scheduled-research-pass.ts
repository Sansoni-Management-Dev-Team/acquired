import {withBackgroundBudget,backgroundBudget,backgroundRemaining,BackgroundUnavailable} from './background-workload';
import {observeScheduledInitialResearch} from './agent-initial-research-observer';
import {maintainScheduledResearch} from './research-maintenance';

let activePass:Promise<number>|undefined;

/** Single persistent app process only. Authentication remains per request in the
 * route. Do not release this guard on HTTP timeout: the database work may still
 * be running. Distributed ownership and SQL cancellation are separate controls.
 */
export async function scheduledResearchPass():Promise<number>{
 const pass=activePass??=withBackgroundBudget('research.scheduled',10000,runPass).finally(()=>{activePass=undefined;});
 // Bound the HTTP response without pretending that it cancels provider work or
 // releasing the shared guard while that work may still be completing.
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([pass,new Promise<never>((_,reject)=>{
  timer=setTimeout(()=>reject(new BackgroundUnavailable('deadline')),12000);
 })]);}finally{clearTimeout(timer);}
}

async function runPass():Promise<number>{
 const started=performance.now();
 let phase='observation',phaseStarted=started;
 const trace=(event:string)=>console.info('research-background',JSON.stringify({
  module:'research.background',event,phase,durationMs:Math.round(performance.now()-phaseStarted),
  passDurationMs:Math.round(performance.now()-started),timestamp:new Date().toISOString(),
 }));
 try{
  const phases:Array<{name:string;run:()=>Promise<unknown>}>=[
   {name:'observation',run:observeScheduledInitialResearch},
   {name:'maintenance',run:maintainScheduledResearch},
  ];
  if(process.env.ACQUISITION_WORKFLOW_ENABLED==='true'||process.env.ACQUISITION_WORKFLOW_SCHEMA_READY==='true')phases.unshift({name:'workflow',run:async()=>{
   const [{recoverAcquisitionWorkflows},{agentPool}]=await Promise.all([import('./acquisition-workflow-recovery'),import('./agent-runtime')]);
   return recoverAcquisitionWorkflows(agentPool());
  }});
  // The same bounded pass rotates its first phase each minute. A slow or
  // failed projection cannot permanently prevent persisted-job maintenance.
  // No additional worker, queue, concurrency or deadline is introduced.
  const first=Math.floor(Date.now()/60000)%phases.length;
  let pending=0;
  for(let offset=0;offset<phases.length;offset++){
   backgroundRemaining();if(backgroundBudget()?.failure)throw backgroundBudget()!.failure;
   const current=phases[(first+offset)%phases.length];phase=current.name;phaseStarted=performance.now();
   const result=await current.run();if(current.name==='maintenance')pending=Number(result)||0;
   trace('phase_finished');
   backgroundRemaining();if(backgroundBudget()?.failure)throw backgroundBudget()!.failure;
  }
  return pending;
 }catch(error){
  // Do not log arbitrary errors: they can contain SQL, payloads or credentials.
  trace('phase_failed');throw error;
 }
}
