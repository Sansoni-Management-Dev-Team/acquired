import 'server-only';
import{withCampaignDb,type CampaignActor}from'@/db/campaign-client';
import{actorCommunicationsClient}from'./communications-client';
import{assertSameBinding,type ConnectionBinding}from'../../communications/packages/contracts/src';
import type{AgentRuntimeReadiness}from'./agent-runtime-readiness';
type Channel=AgentRuntimeReadiness['channels'][number];
type Result=Channel&{readiness:'connected'|'setup_required'|'verification_required'|'unavailable'};
/** Status-only observation. Full peer history and send authority remain dispatch checks. */
export function createAgentChannelReadiness(ports:{loadBinding:(actor:CampaignActor,id:string)=>Promise<ConnectionBinding|undefined>;connectionStatus:(actor:CampaignActor,binding:ConnectionBinding)=>Promise<unknown>;now?:()=>number}){
 const cache=new Map<string,{at:number;pending:Promise<{ready:boolean;readiness:Result['readiness'];reason:string|null}>}>(),now=ports.now??Date.now;
 return async(actor:CampaignActor,channels:Channel[]):Promise<Result[]>=>{
  if(channels.length>3)throw Error('Channel readiness scope unavailable');
  return Promise.all(channels.map(async channel=>{
   if(!channel.bindingId)return {...channel,ready:false,readiness:'setup_required' as const,reason:channel.reason==='choose_recorded_account'?'choose_recorded_account':'recorded_account_missing'};
   try{
    const binding=await ports.loadBinding(actor,channel.bindingId);
    if(!binding||binding.tenantId!==actor.organizationId||binding.ownerId!==actor.userId||binding.channel!==channel.channel)return {...channel,ready:false,readiness:'verification_required' as const,reason:'recorded_account_changed'};
    const key=JSON.stringify([actor.organizationId,actor.userId,channel.bindingId,channel.generationDigest,binding]),prior=cache.get(key);
    let entry=prior;if(!entry||now()-entry.at>=30000){
     if(cache.size>=256)cache.delete(cache.keys().next().value!);
     const pending=(async()=>{try{const value=await ports.connectionStatus(actor,binding) as {binding:ConnectionBinding;status:string;capabilities:{messaging:{send:boolean};events:{read:boolean;history:boolean}}};assertSameBinding(binding,value.binding);
       if(value.status==='connected'&&value.capabilities.messaging.send===true&&value.capabilities.events.read===true&&value.capabilities.events.history===true)return {ready:true,readiness:'connected' as const,reason:null};
       return {ready:false,readiness:'verification_required' as const,reason:value.status==='disconnected'||value.status==='failed'?'recorded_account_reconnect':'recorded_account_requires_live_check'};
      }catch{return {ready:false,readiness:'unavailable' as const,reason:'recorded_account_status_unavailable'};}})();
     entry={at:now(),pending};cache.set(key,entry);
    }
    return {...channel,...await entry.pending};
   }catch{return {...channel,ready:false,readiness:'unavailable' as const,reason:'recorded_account_status_unavailable'};}
  }));
 };
}
export const readAgentChannelReadiness=createAgentChannelReadiness({
 async loadBinding(actor,id){return withCampaignDb(actor,async c=>{const row=(await c.query("SELECT * FROM communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 AND backend='unipile' AND authority='service'",[id,actor.organizationId,actor.userId])).rows[0];if(!row)return undefined;return {applicationId:row.application_id,tenantId:row.organization_id,ownerId:row.owner_user_id,connectionId:row.service_connection_id,accountId:row.service_account_id,generation:row.generation,channel:row.channel,platform:row.platform,backend:row.backend} as ConnectionBinding;});},
 async connectionStatus(actor,binding){return(await actorCommunicationsClient(actor)).connectionStatus(binding);},
});
