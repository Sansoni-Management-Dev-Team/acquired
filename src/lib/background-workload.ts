import {AsyncLocalStorage} from 'node:async_hooks';

export class BackgroundUnavailable extends Error{
 constructor(readonly reason:'busy'|'cooldown'|'deadline'|'connection'){super('Background database work is temporarily unavailable');}
}
export function databaseUnavailable(error:unknown):boolean{
 if(error instanceof BackgroundUnavailable)return ['deadline','connection'].includes(error.reason);
 const code=(error as {code?:string})?.code;
 return typeof code==='string'&&(/^(08|53|57P)/.test(code)||['57014','55P03','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE'].includes(code));
}
type Budget={label:string;deadline:number;failure?:unknown};
const shared=globalThis as typeof globalThis&{acquireBackgroundContext?:AsyncLocalStorage<Budget>};
const context=shared.acquireBackgroundContext??=new AsyncLocalStorage<Budget>();
export const backgroundBudget=()=>context.getStore();
export function backgroundRemaining(){
 const budget=backgroundBudget();if(!budget)return Infinity;
 const remaining=Math.floor(budget.deadline-performance.now());
 if(remaining<=0)throw new BackgroundUnavailable('deadline');return remaining;
}
export function withBackgroundBudget<T>(label:string,milliseconds:number,work:()=>Promise<T>):Promise<T>{
 const parent=backgroundBudget();
 return context.run(parent??{label,deadline:performance.now()+milliseconds},work);
}

type Waiter={start:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
/** One process-wide lane for background database transactions, not provider calls
 * or interactive queries. No unbounded queue; no automatic retry of writes. */
export class BackgroundAdmission{
 private active=false;private failures=0;private opens=0;private until=0;private probing=false;
 private queue:Waiter[]=[];
 constructor(private options:{maximumQueued?:number;waitMs?:number;random?:()=>number}={}){}
 async acquire():Promise<((error?:unknown)=>void)&{probe:boolean}>{
  if(this.until>Date.now()||this.probing)throw new BackgroundUnavailable('cooldown');
  if(this.active){
   if(this.queue.length>=(this.options.maximumQueued??2))throw new BackgroundUnavailable('busy');
   await new Promise<void>((resolve,reject)=>{
    const item:Waiter={start:resolve,reject,timer:setTimeout(()=>{
     this.queue=this.queue.filter(entry=>entry!==item);reject(new BackgroundUnavailable('busy'));
    },this.options.waitMs??1000)};this.queue.push(item);
   });
  }else{this.active=true;}
  if(this.until>0)this.probing=true;
  let released=false;
  const release=(error?:unknown)=>{
   if(released)return;released=true;
   if(databaseUnavailable(error)){
    this.failures++;
    if(this.failures>=3||this.probing){
     const delay=Math.min(300000,30000*2**Math.min(this.opens++,4));
     this.until=Date.now()+Math.min(300000,Math.floor(delay*(1+(this.options.random??Math.random)()*0.2)));
    }
   }else if(error===undefined){this.failures=0;this.opens=0;this.until=0;}
   this.probing=false;
   if(this.until>Date.now()){
    for(const item of this.queue){clearTimeout(item.timer);item.reject(new BackgroundUnavailable('cooldown'));}this.queue=[];
   }
   const next=this.queue.shift();if(next){clearTimeout(next.timer);next.start();}else this.active=false;
  };
  return Object.assign(release,{probe:this.probing});
 }
 async run<T>(work:()=>Promise<T>):Promise<T>{
  const release=await this.acquire();try{const result=await work();release();return result;}catch(error){release(error);throw error;}
 }
}
const globalWorkload=globalThis as typeof globalThis&{acquireBackgroundAdmission?:BackgroundAdmission};
export const backgroundAdmission=globalWorkload.acquireBackgroundAdmission??=new BackgroundAdmission();
