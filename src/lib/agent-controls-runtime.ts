import 'server-only';
import type {CampaignActor} from '@/db/campaign-client';
import type {AgentInvitationStore} from '@/db/agent-invitation-store';
import {readAgentChannelReadiness} from './agent-runtime-channel-readiness';
import {agentRuntimeConfiguration} from './agent-runtime-readiness';

type Scope={actor?:CampaignActor;thread?:{id:string};store:Pick<AgentInvitationStore,'runtimeReadiness'|'channelPolicy'|'channelPolicyForMandate'>};
/** Shared read projections for standalone endpoints and the combined controls
 * response. Provider status is read after database transactions have released. */
export async function readAgentRuntimeStatus(scoped:Pick<Scope,'actor'|'thread'|'store'>){
 const recorded=scoped.thread?await scoped.store.runtimeReadiness(scoped.thread.id):{registered:false,runtimeId:null,responsibilityRevision:null,reason:'Start agent to register this mandate and configure bounded budgets.',budgets:[],channels:[],defaults:{calls:100,sends:30,usd_micro:'10000000',windowHours:24}};
 const readiness={...recorded,channels:scoped.actor?await readAgentChannelReadiness(scoped.actor,recorded.channels):recorded.channels};
 return {readiness,configuration:agentRuntimeConfiguration(process.env)};
}
export async function readAgentSavedChannelPolicy(scoped:Pick<Scope,'thread'|'store'>,mandateId:string){
 if(process.env.AGENT_WORKER_SCOPE_MODE!=='registered')return {enabled:false,policy:null,accounts:[]};
 const value=scoped.thread?await scoped.store.channelPolicy(scoped.thread.id):await scoped.store.channelPolicyForMandate(mandateId);
 return {enabled:true,...value};
}
/** Optional status failures cannot discard the authoritative execution snapshot
 * or fabricate permission to auto-approve. Reads remain sequential for the gate. */
export async function readAgentControlsRuntime(scoped:Scope,mandateId:string){
 const runtime=await readAgentRuntimeStatus(scoped).catch(()=>({readinessUnavailable:true as const}));
 const channelPolicy=await readAgentSavedChannelPolicy(scoped,mandateId).catch(()=>({enabled:false,policy:null,accounts:[],unavailable:true as const}));
 return {...runtime,channelPolicy,channelPolicyUnavailable:'unavailable' in channelPolicy&&channelPolicy.unavailable===true};
}
