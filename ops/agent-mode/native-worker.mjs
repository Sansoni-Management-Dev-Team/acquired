import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
/** Polling speed does not grant execution or sending authority. Only the
 * explicit development simulator policy keeps accelerated-test polling. */
export function nativeWorkerPollingMode(env={}){
 return env.NODE_ENV==='development'&&env.AGENT_MODE_COMMUNICATIONS_MODE==='simulator'&&env.AGENT_MODE_SIMULATOR_TEST_POLICY==='true'?'fast-test':'adaptive';
}
/** Loopback background driver. Browser tabs do not own polling or work. */
export async function requestNativeTick({secret,fetcher=globalThis.fetch,signal}={}){
 if(!secret)throw new Error('Native worker credentials unavailable');
 signal?.throwIfAborted();
 const response=await fetcher('http://127.0.0.1:3000/api/internal/agent/tick',{method:'POST',headers:{authorization:'Bearer '+secret},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(55000)]):AbortSignal.timeout(55000)});
 if(!response.ok)throw new Error('Native worker request failed');
 let value;try{value=await response.json();}catch{throw new Error('Native worker response unavailable');}
 if(typeof value?.enabled!=='boolean'||![0,1].includes(value.processed)||value.outcome!==undefined&&!['idle','complete','review','defer','lost'].includes(value.outcome))throw new Error('Invalid native worker receipt');
 return {enabled:value.enabled,processed:value.processed,...(value.outcome?{outcome:value.outcome}:{})};
}
/** Same scheduled maintenance request used by the production research Worker.
 * This lane never owns native tick credentials, approval or provider dispatch. */
export async function requestResearchMaintenance({secret,fetcher=globalThis.fetch,signal}={}){
 if(!secret)throw new Error('Research maintenance credentials unavailable');
 signal?.throwIfAborted();
 const response=await fetcher('http://127.0.0.1:3000/api/research/internal/background',{method:'POST',headers:{authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({trigger:'scheduled'}),redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('Research maintenance request failed');
 let value;try{value=await response.json();}catch{throw new Error('Research maintenance response unavailable');}
 if(!Number.isSafeInteger(value?.pending)||value.pending<0||value.pending>50)throw new Error('Invalid research maintenance receipt');
 return {pending:value.pending};
}
/** Independent awaited lanes: a pending/failed native tick cannot postpone the
 * once-minute maintenance request, and maintenance never overlaps itself. */
export async function runNativeWorker({nativeSecret,researchSecret,signal,fetcher=globalThis.fetch,nativeTick=requestNativeTick,maintenance=requestResearchMaintenance,sleep=delay,now=()=>performance.now(),log,pollingMode='adaptive'}={}){
 if(!signal)throw new Error('Worker shutdown signal required');
 if(!['adaptive','fast-test'].includes(pollingMode))throw new Error('Invalid worker polling mode');
 const report=record=>{try{if(log)log(record);else (record.outcome==='error'||record.status==='request_failed'?process.stderr:process.stdout).write(JSON.stringify(record)+'\n');}catch{/*Diagnostics do not interrupt either lane.*/}};
 const pause=async ms=>{try{await sleep(ms,undefined,{signal});return !signal.aborted;}catch{return false;}};
 const native=async()=>{
  let failures=0,idleChecks=0,lastEnabled,lastDelay;
  while(!signal.aborted){
   let nextDelay,processed=0;const started=now();
   try{
    // Drain a small sequential burst through the unchanged one-event API.
    // Stop starting new requests after10s; an in-flight request retains its
    // existing timeout and all normal event/dispatch fences.
    for(let tick=0;tick<5&&!signal.aborted&&(tick===0||now()-started<10000);tick++){
     const result=await nativeTick({secret:nativeSecret,fetcher,signal});failures=0;
     if(result.processed||result.enabled!==lastEnabled)report({component:'native-agent-worker',...result});lastEnabled=result.enabled;
     processed+=result.processed;
     if(!result.enabled||result.processed===0||result.outcome!=='complete')break;
    }
    idleChecks=processed?0:Math.min(2,idleChecks+1);
    nextDelay=lastEnabled===false?60000:processed||pollingMode==='fast-test'?1000:30000*idleChecks;
   }catch{if(signal.aborted)break;failures++;idleChecks=0;nextDelay=Math.min(60000,1000*2**Math.min(failures-1,6));if(failures===1||failures%30===0)report({component:'native-agent-worker',status:'request_failed',consecutiveFailures:failures});}
   if(signal.aborted)break;
   if(nextDelay!==lastDelay){report({component:'native-agent-worker',stage:'native.polling',mode:pollingMode,delayMs:nextDelay,processed,batchLimit:5});lastDelay=nextDelay;}
   if(!await pause(nextDelay))break;
  }
 };
 const research=async()=>{
  let attempt=0;
  while(!signal.aborted){
   const started=now();attempt++;report({component:'native-agent-worker',stage:'research.maintenance',trigger:'scheduled',outcome:'start',attempt});
   try{const receipt=await maintenance({secret:researchSecret,fetcher,signal});report({component:'native-agent-worker',stage:'research.maintenance',trigger:'scheduled',outcome:'complete',attempt,pending:receipt.pending,durationMs:Math.max(0,Math.round(now()-started))});}
   catch{if(signal.aborted)break;report({component:'native-agent-worker',stage:'research.maintenance',trigger:'scheduled',outcome:'error',attempt,durationMs:Math.max(0,Math.round(now()-started))});}
   if(!await pause(Math.max(0,60000-(now()-started))))break;
  }
 };
 await Promise.all([native(),research()]);
}
async function main(){
 const controller=new AbortController();for(const name of ['SIGINT','SIGTERM'])process.once(name,()=>controller.abort());
 await runNativeWorker({nativeSecret:process.env.AGENT_WORKER_SECRET,researchSecret:process.env.RESEARCH_SERVICE_SECRET,signal:controller.signal,pollingMode:nativeWorkerPollingMode(process.env)});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
