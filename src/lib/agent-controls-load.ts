import type {AgentControlsData} from '@/components/agent-controls-panel';

/** These endpoints share an organization gate. Fan-out increases queue wait,
 * not throughput, and used to make each page poll compete with itself. Keep
 * required reads authoritative and preserve unavailable optional capabilities. */
export async function loadAgentControls(read:(kind:string)=>Promise<Record<string,unknown>>):Promise<AgentControlsData>{
 const execution=await read('execution');
 const bundled=execution.controls as Pick<AgentControlsData,'inbox'|'grants'|'targetOptions'>&{runtime?:Pick<AgentControlsData,'readiness'|'configuration'|'readinessUnavailable'|'channelPolicy'|'channelPolicyUnavailable'>}|undefined;
 const inbox=bundled?bundled.inbox:await read('handoffs');
 const authority=bundled?{grants:bundled.grants}:await read('authority');
 const targetOptions=bundled?bundled.targetOptions:await read('targets');
 const core={...execution,inbox,targetOptions,grants:authority.grants};
 if(bundled?.runtime)return {...core,...bundled.runtime} as AgentControlsData;
 // Older server responses retain the sequential fallback during upgrades.
 const runtime=await read('readiness').catch(()=>({readinessUnavailable:true}));
 const channelPolicy=await read('channel-policy').catch(()=>({enabled:false,policy:null,accounts:[],unavailable:true}));
 return {...core,...runtime,channelPolicy,channelPolicyUnavailable:channelPolicy.unavailable===true} as AgentControlsData;
}
