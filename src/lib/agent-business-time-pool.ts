import type{Pool,PoolClient}from'pg';
import{assertAgentBusinessTimeScope,type AgentBusinessTimeSelection}from'./agent-business-time';
import{installAgentBusinessTimeSql}from'./agent-business-time-sql';
export type AgentBusinessTimePoolOptions={businessTime:AgentBusinessTimeSelection;runtimeId:string};
/** Trusted per-operation adapter. The outer caller owns the real remote clock
 * pin until all clients finish. No role, membership, admission or lease is replaced. */
export function agentBusinessTimePool<T extends Pick<Pool,'connect'>>(pool:T,options?:AgentBusinessTimePoolOptions):T{
 if(options===undefined)return pool;
 assertAgentBusinessTimeScope(options.businessTime.context,options.businessTime.scope);
 if(!/^[a-z][a-z0-9-]{2,99}$/.test(options.runtimeId))throw Error('Agent business runtime unavailable');
 const context=options.businessTime.context,selection={context,scope:context.scope},runtimeId=options.runtimeId;
 async function connect(){
  const client=await pool.connect();let state:'idle'|'open'|'retired'|'released'='idle',quotaSavepoint=false;
  const retire=(error:Error)=>{if(state==='retired'||state==='released')return;state='retired';client.release(error);};
  async function perform(args:unknown[]){
   if(state==='retired'||state==='released')throw Error('Scoped business connection unavailable');
   const input=args[0],text=typeof input==='string'?input:input&&typeof input==='object'&&'text'in input?input.text:undefined;
   if(typeof text!=='string')throw Error('Scoped business query unavailable');
   const command=text.trim().replace(/;$/,'').trim().toUpperCase(),normalized=command.replace(/\s+/g,' ');
   // Only the single-statement forms used by current repository transactions.
   // Forward the original query/config untouched, including its isolation mode.
   const begins=['BEGIN','BEGIN READ ONLY','BEGIN ISOLATION LEVEL SERIALIZABLE','BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'].includes(normalized);
   if(begins){
    if(state!=='idle')throw Error('Scoped business transaction already started');
    try{
     const result=await Reflect.apply(client.query,client,args);state='open';quotaSavepoint=false;
     await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true),set_config('app.acquire_runtime_id',$3,true)",[context.scope.organizationId,context.scope.userId,runtimeId]);
     await installAgentBusinessTimeSql(client,selection,context.scope);return result;
    }catch(error){try{await client.query('ROLLBACK');}catch{/* Physical retirement resolves uncertain connection state. */}retire(error instanceof Error?error:Error('Scoped business setup failed'));throw error;}
   }
   if(state!=='open')throw Error('Scoped business transaction required');
   if(command==='COMMIT'||command==='ROLLBACK'){
    try{const result=await Reflect.apply(client.query,client,args);state='idle';quotaSavepoint=false;return result;}
    catch(error){retire(error instanceof Error?error:Error('Scoped business transaction outcome unavailable'));throw error;}
   }
   // Normal quota admission owns exactly this savepoint. The actor/runtime/
   // clock settings precede it, so a partial quota rollback retains the pin.
   const creates=normalized==='SAVEPOINT COMMUNICATION_ADMISSION_QUOTA',rollsBack=normalized==='ROLLBACK TO SAVEPOINT COMMUNICATION_ADMISSION_QUOTA',releases=normalized==='RELEASE SAVEPOINT COMMUNICATION_ADMISSION_QUOTA';
   if(creates||rollsBack||releases){
    if(creates?quotaSavepoint:!quotaSavepoint)throw Error('Scoped quota savepoint state unavailable');
    try{const result=await Reflect.apply(client.query,client,args);if(creates)quotaSavepoint=true;else if(releases)quotaSavepoint=false;return result;}
    catch(error){retire(error instanceof Error?error:Error('Scoped quota savepoint outcome unavailable'));throw error;}
   }
   if(/^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION)\b/.test(command))throw Error('Unsupported scoped transaction control');
   return Reflect.apply(client.query,client,args);
  }
  return new Proxy(client,{get(target,property){
   if(property==='query')return(...args:unknown[])=>{const callback=typeof args.at(-1)==='function'?args.pop() as(error:unknown,result?:unknown)=>void:undefined;const result=perform(args);if(callback){void result.then(value=>callback(null,value),error=>callback(error));return;}return result;};
   if(property==='release')return(error?:Error)=>{if(state==='retired'||state==='released')return;if(error||state==='open'){retire(error??Error('Scoped business transaction not finished'));return;}state='released';client.release();};
   const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
  }}) as PoolClient;
 }
 return new Proxy(pool,{get(target,property){
  if(property==='connect')return(callback?:(error:unknown,client?:PoolClient,release?:(error?:Error)=>void)=>void)=>{const result=connect();if(callback){void result.then(client=>callback(null,client,error=>client.release(error)),error=>callback(error));return;}return result;};
  const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
 }}) as T;
}
