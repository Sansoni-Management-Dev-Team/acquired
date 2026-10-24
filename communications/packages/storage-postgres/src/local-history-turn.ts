import {AsyncLocalStorage} from 'node:async_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import type {SqlPool} from './webhook-repository';
import type {AccessScope} from '../../contracts/src';
const turns=new AsyncLocalStorage<{key:string;active:boolean}>();
/** Local direct-Postgres composition only. Both the app and simulator participate
 * in one tenant turn through scan, commit and application projection. Never use
 * session advisory locks through transaction-mode connection pooling. */
export async function localHistoryTurn<T>(pool:SqlPool,scope:AccessScope,work:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
 if(!scope||[scope.applicationId,scope.tenantId,scope.ownerId].some(v=>typeof v!=='string'||!v||v.length>200))throw Error('Local history scope unavailable');
 const key=JSON.stringify(['acquire-local-history-v1',scope.applicationId,scope.tenantId]);
 const check=()=>{if(signal?.aborted)throw Error('Local history cancelled');};check();
 const parent=turns.getStore();if(parent?.active&&parent.key===key)return work();
 const until=Date.now()+20000;
 while(Date.now()<until){
  check();const client=await pool.connect();let acquired=false,retire:Error|undefined;
  try{
   check();const result=await client.query<{acquired:boolean}>('SELECT pg_try_advisory_lock(hashtextextended($1,814762903)) AS acquired',[key]);
   acquired=result.rows[0]?.acquired===true;
   if(acquired){
    check();const context={key,active:true};
    try{return await turns.run(context,work);}finally{context.active=false;}
   }
  }catch(error){retire=Error('Local history session retired');throw error;}
  finally{
   if(acquired){try{const r=await client.query<{released:boolean}>('SELECT pg_advisory_unlock(hashtextextended($1,814762903)) AS released',[key]);if(r.rows[0]?.released!==true)retire=Error('Local history unlock unavailable');}catch{retire=Error('Local history unlock failed');}}
   client.release(retire);
  }
  await delay(25,undefined,{signal});
 }
 throw Error('Local history coordination timeout');
}
