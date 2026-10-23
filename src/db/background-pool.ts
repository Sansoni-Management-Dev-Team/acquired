import type {Pool,PoolClient,QueryConfig,QueryResult} from 'pg';
import {backgroundAdmission,backgroundBudget,backgroundRemaining,databaseUnavailable,BackgroundAdmission,BackgroundUnavailable} from '@/lib/background-workload';

function report(label:string,stage:string,started:number,outcome:string){
 console.info('background-database',JSON.stringify({module:'database.background',label,stage,outcome,durationMs:Math.round(performance.now()-started)}));
}
/** Applies only inside an explicit background budget. Preserves the original
 * pool for interactive work and the caller's role, scope and transaction SQL. */
export function backgroundPool(pool:Pool,admission:BackgroundAdmission=backgroundAdmission):Pool{
 return new Proxy(pool,{get(target,key){
  if(key==='connect')return(callback?: (error:Error|null,client?:PoolClient,release?:PoolClient['release'])=>void)=>{
   if(!backgroundBudget())return callback?target.connect(callback as never):target.connect();
   const pending=connect(target,admission);
   if(callback){void pending.then(client=>callback(null,client,client.release),error=>callback(error));return;}
   return pending;
  };
  if(key==='query')return(...args:unknown[])=>{
   if(!backgroundBudget())return Reflect.apply(target.query,target,args);
   const callback=typeof args.at(-1)==='function'?args.pop() as (error:unknown,result?:QueryResult)=>void:undefined;
   const pending=(async()=>{const client=await connect(target,admission);try{
    await client.query('BEGIN');const result=await Reflect.apply(client.query,client,args);await client.query('COMMIT');return result;
   }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}})();
   if(callback){void pending.then(value=>callback(null,value),error=>callback(error));return;}
   return pending;
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
}
async function connect(pool:Pool,admission:BackgroundAdmission):Promise<PoolClient>{
 const budget=backgroundBudget()!;backgroundRemaining();
 const admittedAt=performance.now();const free=await admission.acquire().catch(error=>{budget.failure??=error;throw error;});report(budget.label,'admission',admittedAt,'acquired');
 let client:PoolClient|undefined,closed=false,inTransaction=false,failed:unknown;
 const started=performance.now();
 const dispose=(error?:Error)=>{
  if(closed)return;closed=true;clearTimeout(timer);if(client){client.removeListener?.('error',connectionError);if(error)client.release(error);else client.release();}
  free(failed??error);report(budget.label,'transaction',started,error?'retired':'released');
 };
 let stop!:(error:Error)=>void;
 const stopped=new Promise<never>((_,reject)=>{stop=reject;});
 // A transaction may be idle between queries when its deadline expires.
 void stopped.catch(()=>{});
 const connectionError=()=>{const error=new BackgroundUnavailable('connection');failed=error;budget.failure??=error;dispose(error);stop(error);};
 const expire=()=>{const error=new BackgroundUnavailable('deadline');failed=error;budget.failure??=error;dispose(error);stop(error);};
 let timer:ReturnType<typeof setTimeout>;
 const live=()=>{if(closed)throw new BackgroundUnavailable('connection');backgroundRemaining();};
 try{
  timer=setTimeout(expire,Math.min(2000,backgroundRemaining()));
  const checkout=pool.connect().then(value=>{if(closed){value.release(new BackgroundUnavailable('connection'));throw new BackgroundUnavailable('connection');}return value;});
  client=await Promise.race([checkout,stopped]);client.on?.('error',connectionError);clearTimeout(timer);live();
  report(budget.label,'checkout',started,'acquired');
  timer=setTimeout(expire,Math.min(10000,backgroundRemaining()));
 }catch(error){failed=error;budget.failure??=error;dispose(new BackgroundUnavailable('connection'));throw error;}
 const raw=client;
 const execute=async(config:QueryConfig)=>{
  live();const before=performance.now();
  try{const bounded={...config,query_timeout:Math.min(3500,backgroundRemaining())};return await Promise.race([raw.query(bounded),stopped]);}
  finally{report(budget.label,/lock_send_gate|lock_member/.test(config.text)?'gate_wait':'sql',before,closed?'retired':'settled');}
 };
 let appliedStatement=0;
 const limits=()=>{appliedStatement=Math.min(3000,backgroundRemaining());return execute({text:"SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true),set_config('idle_in_transaction_session_timeout',$3,true)",values:[appliedStatement+'ms',Math.min(500,backgroundRemaining())+'ms',Math.min(10000,backgroundRemaining())+'ms']});};
 const query=async(arg:string|QueryConfig,values?:unknown[])=>{
  const config=typeof arg==='string'?{text:arg,values}:{...arg,...(values?{values}:{})};
  const sql=config.text.trim();
  try{
   live();
   if(/^BEGIN\b/i.test(sql)||/^START TRANSACTION\b/i.test(sql)){
    const result=await execute(config);inTransaction=true;await limits();return result;
   }
   if(/^(COMMIT|ROLLBACK)\s*;?$/i.test(sql)){
    const result=await execute(config);inTransaction=false;return result;
   }
   if(!inTransaction)throw Error('Background query requires a transaction');
   // ROLLBACK TO SAVEPOINT must work even in a failed transaction.
   if(!/^ROLLBACK TO\b/i.test(sql)&&backgroundRemaining()<appliedStatement)await limits();
   const result=await execute(config);
   if(/statement_timeout|lock_timeout|idle_in_transaction_session_timeout/i.test(sql))await limits();
   return result;
  }catch(error){
   failed=error;
   if(databaseUnavailable(error))budget.failure??=error;
   const code=(error as {code?:string})?.code;
   // Only a server error with a SQLSTATE has a known protocol boundary. A
   // stalled/lost stream or uncertain commit cannot safely accept rollback.
   if(!code||!/^[0-9A-Z]{5}$/.test(code)||/^(COMMIT|ROLLBACK)\s*;?$/i.test(sql)){
    failed=new BackgroundUnavailable('connection');budget.failure??=failed;dispose(error instanceof Error?error:new BackgroundUnavailable('connection'));
   }
   throw error;
  }
 };
 const boundedClient=new Proxy(raw,{get(target,key){
  if(key==='query')return(...args:unknown[])=>{
   const callback=typeof args.at(-1)==='function'?args.pop() as (error:unknown,result?:QueryResult)=>void:undefined;
   const pending=query(args[0] as string|QueryConfig,args[1] as unknown[]|undefined);
   if(callback){void pending.then(result=>callback(null,result),error=>callback(error));return;}
   return pending;
  };
  if(key==='release')return(error?:Error)=>dispose(error??(inTransaction?new BackgroundUnavailable('connection'):undefined));
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 if(free.probe){try{await query('BEGIN');await query('SELECT 1');await query('ROLLBACK');}catch(error){dispose(new BackgroundUnavailable('connection'));throw error;}}
 return boundedClient;
}
