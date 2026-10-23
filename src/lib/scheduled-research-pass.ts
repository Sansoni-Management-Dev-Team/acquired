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
  await observeScheduledInitialResearch();
  trace('phase_finished');
  backgroundRemaining();if(backgroundBudget()?.failure)throw backgroundBudget()!.failure;
  phase='maintenance';phaseStarted=performance.now();
  const pending=await maintainScheduledResearch();
  trace('phase_finished');
  backgroundRemaining();if(backgroundBudget()?.failure)throw backgroundBudget()!.failure;
  return pending;
 }catch(error){
  // Do not log arbitrary errors: they can contain SQL, payloads or credentials.
  trace('phase_failed');throw error;
 }
}
