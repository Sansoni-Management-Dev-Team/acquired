import 'server-only';
import {z} from 'zod';
import {withCampaignDb,type CampaignActor} from '@/db/campaign-client';
import {AgentDemoProvisioningError,AgentDemoProvisioningStore} from '@/db/agent-demo-provisioning-store';
import {loadMandateResearchContext} from './mandate-execution-context';
import {agentDemoPreparationReadiness,agentDemoProvisioningConfiguration} from './agent-demo-configuration';
import {agentPool} from './agent-runtime';
import {prepareAgentDemoRecipients} from './agent-demo-client';
import {provisionAgentDemoContacts,type AgentDemoProvisioningPort} from './agent-demo-provisioning';
export {demoResearchPreparationKey} from './agent-demo-provisioning';
import type {MandateResearchContext} from '@/domain/mandate-execution-context';
type Configuration=NonNullable<ReturnType<typeof agentDemoProvisioningConfiguration>>;
type Ports={
 context(actor:CampaignActor,mandateId:string):Promise<MandateResearchContext>;
 configuration():Configuration|null;
 store(actor:CampaignActor,config:Configuration):AgentDemoProvisioningPort;
 prepare:typeof prepareAgentDemoRecipients;
};
/** Both explicit UI preparation and durable research completion use this same
 * server command. Saved mode is checked before loading any CLI credentials. */
export function createAgentDemoPreparationCommand(ports:Ports){
 return async(actor:CampaignActor,mandateId:string,requestKey:string)=>{
  z.string().uuid().parse(mandateId);z.string().uuid().parse(requestKey);
  const context=await ports.context(actor,mandateId);
  if(context.mandateId!==mandateId)throw new AgentDemoProvisioningError('Mandate preparation scope changed.');
  if(context.mode==='real')return {kind:'real' as const};
  const config=ports.configuration();
  const readiness=agentDemoPreparationReadiness(config,actor);
  if(!readiness.ready)throw new AgentDemoProvisioningError(readiness.message,503);
  if(!config)throw new AgentDemoProvisioningError('Demo preparation is unavailable.',503);
  const result=await provisionAgentDemoContacts(ports.store(actor,config),mandateId,requestKey,manifest=>ports.prepare('demo',manifest,config.control));
  return {kind:'demo' as const,...result};
 };
}
export const prepareMandateDemoContacts=createAgentDemoPreparationCommand({
 context:(actor,mandateId)=>withCampaignDb(actor,c=>loadMandateResearchContext(c,{actor,mandateId})),
 configuration:agentDemoProvisioningConfiguration,
 store:(actor,config)=>new AgentDemoProvisioningStore(agentPool(),actor,config.selection),
 prepare:prepareAgentDemoRecipients,
});
