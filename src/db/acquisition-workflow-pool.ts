import type {Pool,PoolClient} from 'pg';
import {acquisitionWorkflowContext,type AcquisitionWorkflowContext} from '@/lib/acquisition-workflow-context';
const contextSql="SELECT set_config('app.acquire_workflow_version',$1,true),set_config('app.acquire_workflow_execution',$2,true),set_config('app.acquire_org',$3,true),set_config('app.acquire_user',$4,true)";
function initialize(client:PoolClient,context:AcquisitionWorkflowContext){return client.query(contextSql,['1',context.id??'',context.organizationId,context.ownerUserId]);}
function callbackResult(pending:Promise<unknown>,callback:unknown){if(typeof callback==='function'){void pending.then(value=>callback(null,value),error=>callback(error));return;}return pending;}
/** Preserves the existing bounded pool. Context applies transaction-locally to
 * individual SQL calls, never across research/provider HTTP work. */
export function acquisitionWorkflowPool(pool:Pool):Pool{
 return new Proxy(pool,{get(target,key){
  if(key==='query')return(...incoming:unknown[])=>{
   const context=acquisitionWorkflowContext();if(!context||context.id===null)return Reflect.apply(target.query,target,incoming);
   const args=[...incoming],callback=typeof args.at(-1)==='function'?args.pop():undefined;
   const pending=(async()=>{const c=await target.connect();try{await c.query('BEGIN');await initialize(c,context);const result=await Reflect.apply(c.query,c,args);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}})();
   return callbackResult(pending,callback);
  };
  if(key==='connect')return(callback?:unknown)=>{
   const context=acquisitionWorkflowContext();if(!context||context.id===null)return typeof callback==='function'?target.connect(callback as never):target.connect();
   const pending=target.connect().then(c=>{
    let inTransaction=false;
    const wrapped=new Proxy(c,{get(client,member){
     if(member==='query')return(...incoming:unknown[])=>{
      const args=[...incoming],done=typeof args.at(-1)==='function'?args.pop():undefined;
      const sql=typeof args[0]==='string'?args[0]:(args[0] as {text?:string})?.text??'';
      const result=(async()=>{
       if(/^\s*(BEGIN\b|START TRANSACTION\b)/i.test(sql)){const value=await Reflect.apply(client.query,client,args);inTransaction=true;await initialize(client,context);return value;}
       if(!inTransaction)throw Error('Workflow database query requires a transaction');
       const value=await Reflect.apply(client.query,client,args);if(/^\s*(COMMIT|ROLLBACK)\s*;?$/i.test(sql))inTransaction=false;return value;
      })();return callbackResult(result,done);
     };
     if(member==='release')return(error?:Error)=>client.release(error??(inTransaction?Error('Unfinished workflow transaction'):undefined));
     const value=Reflect.get(client,member,client);return typeof value==='function'?value.bind(client):value;
    }});return wrapped;
   });
   if(typeof callback==='function'){void pending.then(c=>callback(null,c,c.release),error=>callback(error));return;}return pending;
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
}
