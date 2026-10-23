import 'server-only';
import {Pool} from 'pg';
import type {AccessScope} from '../../communications/packages/contracts/src';
import type {SqlClient,SqlPool} from '../../communications/packages/storage-postgres/src/webhook-repository';

const unavailable=():never=>{throw Error('Hosted read unavailable');};
/** Reserved capacity for short callback reads. Outer admission/projector
 * transactions must not occupy the connections needed to authorize their own
 * nested proof callbacks. This pool never performs application writes. */
export function createHostedDemoReadPool(env:Readonly<Record<string,string|undefined>>):SqlPool&{close():Promise<void>}{
 if(!env.DATABASE_URL)return unavailable();
 const physical=new Pool({connectionString:env.DATABASE_URL,max:2,connectionTimeoutMillis:4000,idleTimeoutMillis:5000,...(env.DATABASE_SSL_CA?{ssl:{ca:env.DATABASE_SSL_CA,rejectUnauthorized:true}}:{})});
 return{async connect(){const client=await physical.connect();return{async query<Row>(text:string,values?:unknown[]){const result=await client.query(text,values);return{rows:result.rows as Row[],rowCount:result.rowCount};},release(error?:Error){client.release(error);}};},close:()=>physical.end()};
}

/** Scoped lookup only. The real projector/admission still rechecks the binding,
 * membership, writer gate and original proof inside its retained transaction. */
export function createHostedDemoReadSession(input:AccessScope,pool:SqlPool,options:{allowRowLocks?:boolean}={}){
 const scope=structuredClone(input);
 // The existing effective-contact definer takes FOR SHARE to preserve source
 // CAS. Its trusted read-only lookup needs a locking transaction, without the
 // unrelated organization writer gate held by the original send admission.
 const begin=options.allowRowLocks===true?'BEGIN':'BEGIN READ ONLY';
 return async function read<T>(work:(client:SqlClient)=>Promise<T>):Promise<T>{
  let physical:SqlClient|undefined,closed=false;const deadline=performance.now()+5000;
  const dispose=(error?:Error)=>{if(closed)return;closed=true;physical?.release(error);};
  const live=()=>{if(closed||performance.now()>=deadline)unavailable();};
  let timer:ReturnType<typeof setTimeout>;
  const stopped=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{dispose(Error('Hosted read retired'));reject(Error('Hosted read unavailable'));},5000);});
  const run=(async()=>{try{
   const acquired=await pool.connect();if(closed){acquired.release(Error('Hosted read retired'));return unavailable();}physical=acquired;
   const query:SqlClient['query']=async(text,values)=>{live();const result=await acquired.query(text,values);live();return result as never;};
   await query(begin);await query('SET LOCAL ROLE acquire_campaign_user');
   const role=(await query('SELECT current_user AS active_role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows;
   if(role.length!==1||role[0].active_role!=='acquire_campaign_user'||role[0].rolsuper!==false||role[0].rolbypassrls!==false)unavailable();
   await query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true),set_config('statement_timeout','5000ms',true),set_config('lock_timeout','1000ms',true)",[scope.tenantId,scope.ownerId]);
   const member=(await query('SELECT true AS allowed FROM public.member WHERE organization_id=$1 AND user_id=$2 LIMIT 1',[scope.tenantId,scope.ownerId])).rows;
   if(member.length!==1||member[0].allowed!==true)unavailable();
   const value=await work({query,release:()=>unavailable()});live();await query('COMMIT');dispose();return value;
  }catch{dispose(Error('Hosted read retired'));return unavailable();}})();
  try{return await Promise.race([run,stopped]);}finally{clearTimeout(timer!);}
 };
}
