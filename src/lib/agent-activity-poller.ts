// Independent workspace, controls and research subscriptions share a single
// browser-module read lane. A stopped/hidden/busy subscriber is skipped before
// issuing I/O; an aborted read holds the lane until its promise settles.
let pollingLane:Promise<void>=Promise.resolve();
async function inPollingLane(work:()=>Promise<void>){
 const previous=pollingLane;let release:()=>void=()=>{};
 pollingLane=new Promise<void>(resolve=>{release=resolve;});
 await previous;try{await work();}finally{release();}
}
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
   await inPollingLane(async()=>{
   if(stopped||signal.aborted||options.isBusy()||!options.isVisible()||options.version()!==version)return;
   const value=await options.load(signal);failures=0;
   if(!stopped&&!signal.aborted&&!options.isBusy()&&options.isVisible()&&options.version()===version)options.apply(value);
   });
  }catch{if(!stopped&&!signal.aborted){failures++;options.onFailure?.(failures);}}
  finally{schedule(Math.min(60000,interval*2**Math.min(6,Math.max(0,failures-1))));}
 }
 schedule(0);
 return ()=>{stopped=true;if(timer)clearTimeout(timer);controller?.abort();};
}
