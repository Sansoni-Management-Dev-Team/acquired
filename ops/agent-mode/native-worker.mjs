import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
/** Local-only background driver. Browser tabs do not own polling or work. */
export async function requestNativeTick({secret,fetcher=globalThis.fetch,signal}={}){
 if(!secret)throw new Error('Native worker credentials unavailable');
 signal?.throwIfAborted();
 const response=await fetcher('http://127.0.0.1:3000/api/internal/agent/tick',{method:'POST',headers:{authorization:'Bearer '+secret},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(55000)]):AbortSignal.timeout(55000)});
 if(!response.ok)throw new Error('Native worker request failed');
 let value;try{value=await response.json();}catch{throw new Error('Native worker response unavailable');}
 if(typeof value?.enabled!=='boolean'||![0,1].includes(value.processed)||value.outcome!==undefined&&!['idle','complete','review','defer','lost'].includes(value.outcome))throw new Error('Invalid native worker receipt');
 return {enabled:value.enabled,processed:value.processed,...(value.outcome?{outcome:value.outcome}:{})};
}
async function main(){
 const controller=new AbortController();for(const name of ['SIGINT','SIGTERM'])process.once(name,()=>controller.abort());
 let failures=0,lastEnabled;
 while(!controller.signal.aborted){
  try{
   const result=await requestNativeTick({secret:process.env.AGENT_WORKER_SECRET,signal:controller.signal});failures=0;
   if(result.processed||result.enabled!==lastEnabled)process.stdout.write(JSON.stringify({component:'native-agent-worker',...result})+'\n');lastEnabled=result.enabled;
  }catch{
   if(controller.signal.aborted)break;failures++;
   if(failures===1||failures%30===0)process.stderr.write(JSON.stringify({component:'native-agent-worker',status:'request_failed',consecutiveFailures:failures})+'\n');
  }
  try{await delay(Math.min(10000,failures?failures*1000:1000),undefined,{signal:controller.signal});}catch{break;}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
