import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import {readHostedDemoCommunicationsDescriptor} from './hosted-demo-communications-environment';
import {assertSameBinding,type ConnectionBinding} from '../../communications/packages/contracts/src';
import {withCampaignDb,type CampaignActor} from '@/db/campaign-client';
import {runtimeTransaction} from '../../communications/packages/storage-postgres/src/runtime-sql';
import type {SqlPool} from '../../communications/packages/storage-postgres/src/webhook-repository';
import {readTestingCommunicationsDescriptor} from './communications-testing-environment';
export type CommunicationsLane='primary'|'demo'|'testing'|'hosted';
export const DEMO_COMMUNICATIONS_INTEGRATION='sim-agent-real-research-demos';
export const DEMO_COMMUNICATIONS_CONFIGURATION=DEMO_COMMUNICATIONS_INTEGRATION+'-v1';
export function communicationsLaneForMetadata(row:{integrationId:string;configurationReference:string},env:Record<string,string|undefined>):CommunicationsLane{
 if(typeof row.integrationId!=='string'||!row.integrationId||typeof row.configurationReference!=='string'||!row.configurationReference)throw Error('Recorded communications configuration unavailable');
 if(env.AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED==='true'){const descriptor=readHostedDemoCommunicationsDescriptor(env);if(row.integrationId===descriptor.integrationId&&row.configurationReference===descriptor.configurationReference){if(descriptor.phase!=='active')throw Error('Recorded hosted configuration unavailable');return 'hosted';}}
 if(row.integrationId===env.COMMUNICATIONS_INTEGRATION_ID&&row.configurationReference===env.COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE)return 'primary';
 if(env.AGENT_DEMO_COMMUNICATIONS_ENABLED==='true'&&env.NODE_ENV==='development'&&row.integrationId===DEMO_COMMUNICATIONS_INTEGRATION&&row.configurationReference===DEMO_COMMUNICATIONS_CONFIGURATION)return 'demo';
 if(env.AGENT_TESTING_COMMUNICATIONS_ENABLED==='true'){
  const descriptor=readTestingCommunicationsDescriptor(env);
  if(row.integrationId===descriptor.integrationId&&row.configurationReference===descriptor.configurationReference)return 'testing';
 }
 throw Error('Recorded communications configuration unavailable');
}
/** No provider lookup. Historical generations stay pinned to their original
 * immutable configuration; current membership is required even for receipts. */
export async function resolveOwnedCommunicationsLane(actor:CampaignActor,binding:ConnectionBinding,options?:{env?:Record<string,string|undefined>;servicePool?:SqlPool}):Promise<CommunicationsLane>{
 assertSameBinding(binding,binding);
 if(binding.applicationId!=='acquire'||binding.tenantId!==actor.organizationId||binding.ownerId!==actor.userId||binding.backend!=='unipile')throw Error('Recorded communications owner differs');
 const values=[binding.applicationId,binding.tenantId,binding.ownerId,binding.connectionId,binding.accountId,binding.generation,binding.channel,binding.platform,binding.backend];
 await withCampaignDb(actor,async c=>{const r=await c.query("SELECT id FROM public.communication_bindings WHERE application_id=$1 AND organization_id=$2 AND owner_user_id=$3 AND service_connection_id=$4 AND service_account_id=$5 AND generation=$6 AND channel=$7 AND platform=$8 AND backend=$9 AND authority='service'",values);if(r.rows.length!==1)throw Error('Recorded application binding unavailable');},{readOnly:true});
 const selectedEnv=options?.env??process.env;
 if(selectedEnv.AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED==='true'){const descriptor=readHostedDemoCommunicationsDescriptor(selectedEnv,actor);if(descriptor.bindings.some(value=>value.connectionId===binding.connectionId)){if(descriptor.phase!=='active'||!descriptor.bindings.some(value=>isDeepStrictEqual(value,binding)))throw Error('Recorded hosted generation unavailable');return 'hosted';}}
 const pool=options?.servicePool??(await import('./communications-configuration')).configuredAcquireCommunications().options.pool;
 const row=await runtimeTransaction(pool,5000,async c=>{const r=await c.query<{integration_id:string;provider_configuration_reference:string}>(`SELECT g.integration_id,g.provider_configuration_reference FROM communications.connection_generations g JOIN communications.connections c ON c.id=g.connection_id AND c.application_id=g.application_id AND c.tenant_id=g.tenant_id AND c.owner_id=g.owner_id WHERE g.application_id=$1 AND g.tenant_id=$2 AND g.owner_id=$3 AND g.connection_id=$4 AND g.account_id=$5 AND g.generation=$6 AND g.channel=$7 AND g.platform=$8 AND g.backend=$9 AND g.authority='service' AND g.provider_api_version='v1'`,values);if(r.rows.length!==1)throw Error('Recorded service generation unavailable');return r.rows[0];});
 const env=options?.env??process.env,lane=communicationsLaneForMetadata({integrationId:row.integration_id,configurationReference:row.provider_configuration_reference},env);
 if(lane==='testing')readTestingCommunicationsDescriptor(env,actor);
 return lane;
}
