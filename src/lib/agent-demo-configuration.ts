import type {AgentDemoControlConfiguration} from './agent-demo-client';
import type {AgentDemoRunSelection} from '@/db/agent-demo-provisioning-store';
import type {CampaignActor} from '@/db/campaign-client';
import {readTestingCommunicationsDescriptor} from './communications-testing-environment';

type TestingDescriptor=NonNullable<ReturnType<typeof readTestingCommunicationsDescriptor>>;
export type AgentDemoProvisioningConfiguration={control:AgentDemoControlConfiguration;selection:AgentDemoRunSelection;testing?:Pick<TestingDescriptor,'actor'|'capabilities'|'serviceOrigin'>};
const testingPending='The testing service on 5991 is not ready for this mandate yet. Your saved companies and people are available; simulated outreach has not started.';
/** Capability advertisement is only a prerequisite. The existing provisioning
 * store still verifies current owned accounts, source revisions and receipts. */
export function agentDemoPreparationReadiness(config:AgentDemoProvisioningConfiguration|null,actor:CampaignActor):{ready:true}|{ready:false;message:string}{
 if(!config)return{ready:false,message:'The separate demo channel service is not ready. Your research results are still available.'};
 const t=config.testing;
 if(t&&(t.actor.applicationId!=='acquire'||t.actor.tenantId!==actor.organizationId||t.actor.ownerId!==actor.userId||!t.capabilities.dynamicRecipients||!t.capabilities.recipientContextLookup))return{ready:false,message:testingPending};
 return{ready:true};
}
function validKey(key:string|undefined):key is string{return Boolean(key&&key.trim()===key&&!/[\r\n]/.test(key));}
/** Explicit server-only selection. Testing configuration never falls back to
 * the historical demo lane, and its admin key is separate from SDK authority. */
export function agentDemoProvisioningConfiguration(env:Record<string,string|undefined>=process.env):AgentDemoProvisioningConfiguration|null{
 if(env.AGENT_DEMO_CONTACTS_ENABLED!=='true'||env.AGENT_DEMO_COMMUNICATIONS_ENABLED!=='true')return null;
 if(env.AGENT_DEMO_TARGET==='testing'){
  try{
  const descriptor=readTestingCommunicationsDescriptor(env),adminKey=env.AGENT_TESTING_DEMO_CONTROL_ADMIN_KEY;
  if(!descriptor||!validKey(adminKey))return null;
  const {runId,integrationId,configurationReference,providerOrigin,actor,capabilities,serviceOrigin}=descriptor;
  return{control:{endpoint:providerOrigin,adminKey,expectedRunId:runId},selection:{runId,integrationId,configurationReference},testing:{actor,capabilities,serviceOrigin}};
  }catch{return null;}
 }
 if(env.AGENT_DEMO_TARGET&&env.AGENT_DEMO_TARGET!=='demo')return null;
 const endpoint=env.AGENT_DEMO_CONTROL_URL,adminKey=env.AGENT_DEMO_CONTROL_ADMIN_KEY;
 if(!endpoint||!validKey(adminKey))return null;
 try{const u=new URL(endpoint);if(u.protocol!=='https:'||u.hostname!=='127.0.0.1'||u.port!=='5890'||u.pathname!=='/'||u.search||u.hash||u.username||u.password)return null;}catch{return null;}
 return {control:{endpoint,adminKey},selection:{runId:'agent-real-research-demos',integrationId:'sim-agent-real-research-demos',configurationReference:'sim-agent-real-research-demos-v1'}};
}
