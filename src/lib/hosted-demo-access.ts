import {traceOperation,updateOperationTrace} from '../../communications/packages/core/src/operation-trace';
import type{HostedDemoCommunicationsDescriptor}from'./hosted-demo-communications-environment';
import type{SqlPool}from'../../communications/packages/storage-postgres/src/webhook-repository';
/** Authentication renewals must not acquire the organization writer gate:
 * this read is called while an original admission transaction may hold it. */
export function createHostedDemoAccessProbe(input:HostedDemoCommunicationsDescriptor,pool:SqlPool){
 const descriptor=structuredClone(input);let inFlight:Promise<boolean>|undefined;
 const check=async()=>{
  let physical:Awaited<ReturnType<SqlPool['connect']>>|undefined,closed=false;const deadline=performance.now()+5000;
  const dispose=(error?:Error)=>{if(closed)return;closed=true;physical?.release(error);};
  const live=()=>{if(closed||performance.now()>=deadline)throw Error('Hosted access unavailable');};
  let timer:ReturnType<typeof setTimeout>;const stopped=new Promise<boolean>((_,reject)=>{timer=setTimeout(()=>{dispose(Error('Hosted access retired'));reject(Error('Hosted access unavailable'));},5000);});
  const run=(async()=>{try{
   const acquired=await traceOperation('acquire.hosted.access.pool',{},()=>pool.connect());if(closed){acquired.release(Error('Hosted access retired'));return false;}physical=acquired;
   const query=async(sql:string,values?:unknown[])=>{live();const stage=sql.includes('FROM public.member')?'membership':sql.includes('FROM public.agent_demo_runs')?'run':sql.includes('access_ready($1')?'registration':sql.startsWith('COMMIT')?'commit':'setup';const result=await traceOperation('acquire.hosted.access.'+stage,{},()=>acquired.query(sql,values));live();return result;};
   await query('BEGIN READ ONLY');await query('SET LOCAL ROLE acquire_campaign_user');
   const role=(await query('SELECT current_user AS active_role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows;if(role.length!==1||role[0].active_role!=='acquire_campaign_user'||role[0].rolsuper!==false||role[0].rolbypassrls!==false)throw Error();
   await query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true),set_config('statement_timeout','5000ms',true),set_config('lock_timeout','1000ms',true)",[descriptor.actor.tenantId,descriptor.actor.ownerId]);
   const member=(await query('SELECT true AS allowed FROM public.member WHERE organization_id=$1 AND user_id=$2 LIMIT 1',[descriptor.actor.tenantId,descriptor.actor.ownerId])).rows;
   let allowed=member.length===1&&member[0].allowed===true;
   if(allowed&&descriptor.phase==='active')allowed=(await query('SELECT id FROM public.agent_demo_runs WHERE organization_id=$1 AND owner_user_id=$2 AND run_id=$3 AND integration_id=$4 AND configuration_ref=$5 LIMIT 2',[descriptor.actor.tenantId,descriptor.actor.ownerId,descriptor.runId,descriptor.integrationId,descriptor.configurationReference])).rows.length===1;
   if(allowed&&descriptor.phase==='active'){
    const installed=(await query("SELECT to_regprocedure('public.agent_hosted_demo_access_ready(text,text,text)') IS NOT NULL AS installed")).rows;
    allowed=installed.length===1&&installed[0].installed===true;
    if(allowed){const registration=(await query('SELECT public.agent_hosted_demo_access_ready($1,$2,$3) AS allowed',[descriptor.runId,descriptor.integrationId,descriptor.configurationReference])).rows;allowed=registration.length===1&&registration[0].allowed===true;}
   }
   await query('COMMIT');dispose();updateOperationTrace({allowed});return allowed;
  }catch{dispose(Error('Hosted access retired'));throw Error('Hosted access unavailable');}})();
  try{return await Promise.race([run,stopped]);}finally{clearTimeout(timer!);}
 };
 // Concurrent callbacks share this pending read only. Never cache an allowed
 // result: the next callback after settlement rechecks membership/registration.
 return()=>{if(inFlight)return inFlight;const work=check();inFlight=work;const clear=()=>{if(inFlight===work)inFlight=undefined;};void work.then(clear,clear);return work;};
}
