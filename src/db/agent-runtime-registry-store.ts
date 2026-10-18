import type {PoolClient} from 'pg';
import {AgentBudgetStore} from './agent-budget-store';
import {agentRecordDigest,type AgentThread} from './agent-store';
export const agentRuntimeDefaultBudgets={calls:100,sends:30,usd_micro:'10000000',windowHours:24} as const;
import {configuredAgentRegisteredRuntime} from '@/lib/agent-runtime-context';
export {configuredAgentRegisteredRuntime} from '@/lib/agent-runtime-context';
export class AgentRuntimeRegistryStore extends AgentBudgetStore{
 protected async registerControlledRuntime(c:PoolClient,t:AgentThread,responsibility:{revision:number}){
  const runtimeId=configuredAgentRegisteredRuntime();if(!runtimeId)return;
  await c.query('SELECT public.agent_register_runtime($1::uuid,$2::integer,$3) AS registration',[t.id,responsibility.revision,runtimeId]);
 }
 async runtimeReadiness(threadId:string){
  return this.transaction(async c=>{
   const t=await this.thread(c,threadId),runtimeId=configuredAgentRegisteredRuntime();
   const installed=(await c.query("SELECT to_regclass('public.agent_runtime_registrations') IS NOT NULL AS installed")).rows[0]?.installed===true;
   const responsibility=(await c.query('SELECT id,revision,state FROM agent_responsibilities WHERE thread_id=$1',[t.id])).rows[0];
   const registration=installed?(await c.query('SELECT * FROM agent_runtime_registrations WHERE thread_id=$1',[t.id])).rows[0]:null;
   const registered=!!(runtimeId&&registration&&registration.runtime_id===runtimeId&&registration.responsibility_id===responsibility?.id&&registration.responsibility_revision===responsibility?.revision&&['ready','waiting'].includes(responsibility?.state));
   const prefixes=['organization','user:'+t.owner_user_id,'mandate:'+t.mandate_id],keys=prefixes.flatMap(prefix=>['calls','sends','usd_micro'].map(unit=>prefix+':'+unit));
   const accounts=(await c.query('SELECT scope_key,unit,(cap-spent-reserved)::text AS available,window_end FROM agent_budget_accounts WHERE organization_id=$1 AND scope_key=ANY($2::text[]) AND window_start<=clock_timestamp() AND window_end>clock_timestamp() ORDER BY scope_key,window_start DESC',[t.organization_id,keys])).rows;
   const budgets=accounts.map(a=>({scope:a.scope_key.startsWith('organization:')?'organization' as const:a.scope_key.startsWith('user:')?'user' as const:'mandate' as const,unit:a.unit as 'calls'|'sends'|'usd_micro',available:a.available as string,windowEnd:new Date(a.window_end).toISOString()}));
   const bindings=(await c.query("SELECT id,channel,application_id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,platform,backend FROM communication_bindings WHERE organization_id=$1 AND owner_user_id=$2 AND application_id='acquire' AND backend='unipile' AND authority='service' ORDER BY created_at DESC,id DESC LIMIT 100",[t.organization_id,t.owner_user_id])).rows;
   // Account rows are immutable historical evidence, not current provider
   // authentication. The channel adapter performs live readiness at use time.
   const policyInstalled=(await c.query("SELECT to_regclass('public.agent_channel_policies') IS NOT NULL AS installed")).rows[0]?.installed===true;
   const policy=policyInstalled?(await c.query('SELECT bindings FROM agent_channel_policies WHERE thread_id=$1',[t.id])).rows[0]:null;
   const channels=(['email','whatsapp','linkedin'] as const).map(channel=>{
    const owned=bindings.filter(b=>b.channel===channel);
    const selected=policy?.bindings?.find((ref:{channel:string;bindingId:string})=>ref.channel===channel);
    const b=selected?owned.find(b=>b.id===selected.bindingId)??null:owned.length===1?owned[0]:null;
    const generationDigest=b?agentRecordDigest({applicationId:b.application_id,tenantId:b.organization_id,ownerId:b.owner_user_id,connectionId:b.service_connection_id,accountId:b.service_account_id,generation:b.generation,channel:b.channel,platform:b.platform,backend:b.backend}):null;
    return {channel,bindingId:b?b.id as string:null,generationDigest,ready:false,reason:b?'recorded_account_requires_live_check':owned.length===0?'recorded_account_missing':owned.length>1?'choose_recorded_account':'recorded_account_requires_live_check'};
   });
   const reason=registered?null:!installed?'runtime_schema_unavailable':responsibility?.state==='paused'?'responsibility_paused':!runtimeId?'registered_runtime_not_configured':'runtime_unregistered';
   return {registered,runtimeId,responsibilityRevision:responsibility?.revision??0,reason,budgets,channels,defaults:agentRuntimeDefaultBudgets};
  });
 }
}
