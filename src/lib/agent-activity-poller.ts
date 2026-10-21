/** Read-only UI subscription substitute. Worker execution never depends on this
 * timer. A user-action generation fences late snapshots from older requests. */
export function startAgentActivityPolling<T>(options:{load:(signal:AbortSignal)=>Promise<T>;apply:(value:T)=>void;isBusy:()=>boolean;isVisible:()=>boolean;version:()=>number;onFailure?:(consecutiveFailures:number)=>void;intervalMs?:number}){
 let stopped=false,failures=0,controller:AbortController|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 const interval=Math.min(60000,Math.max(1000,options.intervalMs??5000));
 const schedule=(milliseconds=interval)=>{if(!stopped)timer=setTimeout(()=>{void tick();},milliseconds);};
 async function tick(){
  if(stopped)return;
  if(options.isBusy()||!options.isVisible()){schedule();return;}
  const version=options.version();controller=new AbortController();const signal=controller.signal;
  try{
   const value=await options.load(signal);failures=0;
   if(!stopped&&!signal.aborted&&!options.isBusy()&&options.isVisible()&&options.version()===version)options.apply(value);
  }catch{if(!stopped&&!signal.aborted)options.onFailure?.(++failures);}
  finally{schedule();}
 }
 schedule(0);
 return ()=>{stopped=true;if(timer)clearTimeout(timer);controller?.abort();};
}
