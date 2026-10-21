/** Operator support entrypoint retained for private demo/testing account setup.
 * Consumers and cleanup exception: docs/agent-cleanup-retained-entrypoints.md. */
import 'server-only';
import {readHostedDemoCommunicationsDescriptor} from './hosted-demo-communications-environment';
import {readHostedDemoAccountAttestation} from './hosted-demo-account-attestation';
import type {CampaignActor} from '@/db/campaign-client';
import {withCampaignDb} from '@/db/campaign-client';
import {actorCommunicationsClient} from './communications-client';
import {agentDemoPreparationReadiness,agentDemoProvisioningConfiguration} from './agent-demo-configuration';
import {configuredAcquireCommunicationsForBinding} from './communications-configuration';
import {resolveOwnedCommunicationsLane} from './communications-routing';
import {recordedAgentBindingDigest} from '@/db/agent-execution-store';
import {assertSameBinding,type ConnectionBinding} from '../../communications/packages/contracts/src';
import {assertManagedConnection,type ConnectionManagementSnapshot,type ManagedConnection,type ConnectionSetupResponse} from '../../communications/packages/contracts/src/management';
const channels=['email','whatsapp','linkedin']as const;
type Channel=typeof channels[number];
type Client={connections(scope:{applicationId:string;tenantId:string;ownerId:string}):Promise<ConnectionManagementSnapshot>;connectionStatus(binding:ConnectionBinding):Promise<ManagedConnection>;setupConnection(scope:{applicationId:string;tenantId:string;ownerId:string},input:{channel:Channel;platform:'gmail'|'whatsapp'|'linkedin'}):Promise<ConnectionSetupResponse>};
export type VerifiedDemoAccount={binding:ConnectionBinding;bindingId:string;bindingDigest:string;active:boolean;providerAccountId:string;sourceId:string};
export type DemoRegistrySender={channel:Channel;bindingId:string;bindingDigest:string;accountId:string;providerAccountId:string;sourceId:string};
/** Trusted vault-backed metadata port. Never supplied by a browser/model. */
async function recordedAccount(actor:CampaignActor,binding:ConnectionBinding,lane:'demo'|'testing'):Promise<VerifiedDemoAccount>{
 if(await resolveOwnedCommunicationsLane(actor,binding)!==lane)throw Error('Exact demo account required');
 const configured=await configuredAcquireCommunicationsForBinding(actor,binding),r=await configured.unipile.store.resolve(binding,true);if(!r)throw Error('Current demo account unavailable');assertSameBinding(binding,r.binding);
 const saved=await withCampaignDb(actor,async c=>{const rows=await c.query("SELECT * FROM public.communication_bindings WHERE application_id=$1 AND organization_id=$2 AND owner_user_id=$3 AND service_connection_id=$4 AND service_account_id=$5 AND generation=$6 AND channel=$7 AND platform=$8 AND backend=$9 AND authority='service'",[binding.applicationId,binding.tenantId,binding.ownerId,binding.connectionId,binding.accountId,binding.generation,binding.channel,binding.platform,binding.backend]);if(rows.rows.length!==1)throw Error('Owned demo binding unavailable');return rows.rows[0];});
 return{binding:r.binding,bindingId:saved.id,bindingDigest:recordedAgentBindingDigest(saved),active:r.active&&r.status==='connected',providerAccountId:r.owner.providerAccountId,sourceId:r.owner.sourceId};
}
function selectedProfile(actor:CampaignActor):{lane:'demo'|'testing'|'hosted';runId:string}{
 if(process.env.AGENT_DEMO_TARGET==='hosted'){const descriptor=readHostedDemoCommunicationsDescriptor(process.env,actor);return{lane:'hosted',runId:descriptor.runId};}
 if(process.env.AGENT_DEMO_TARGET!=='testing')return{lane:'demo',runId:'agent-real-research-demos'};
 const config=agentDemoProvisioningConfiguration(),readiness=agentDemoPreparationReadiness(config,actor);
 if(!readiness.ready||!config?.testing)throw Error(!readiness.ready?readiness.message:'The testing service on 5991 is not ready for this mandate yet.');
 return{lane:'testing',runId:config.selection.runId};
}
async function hostedAccountEvidence(actor:CampaignActor){
 const runtime=(await import('./hosted-demo-runtime')).configuredHostedDemoRuntime();readHostedDemoCommunicationsDescriptor(process.env,actor);
 return readHostedDemoAccountAttestation({descriptor:runtime.descriptor,request:runtime.serviceRequest,recorded:binding=>withCampaignDb(actor,async c=>{const rows=(await c.query("SELECT * FROM public.communication_bindings WHERE application_id=$1 AND organization_id=$2 AND owner_user_id=$3 AND service_connection_id=$4 AND service_account_id=$5 AND generation=$6 AND channel=$7 AND platform=$8 AND backend=$9 AND authority='service'",[binding.applicationId,binding.tenantId,binding.ownerId,binding.connectionId,binding.accountId,binding.generation,binding.channel,binding.platform,binding.backend])).rows;if(rows.length!==1)throw Error('Owned hosted binding unavailable');return{bindingId:rows[0].id,bindingDigest:recordedAgentBindingDigest(rows[0])};})});
}
/** Owner/operator preparation only. Returns the authenticated attestation and
 * exact registry input; does not insert, register, enable or approve anything. */
export async function verifyHostedDemoAccountRegistration(actor:CampaignActor){
 const profile=selectedProfile(actor);if(profile.lane!=='hosted')throw Error('Hosted profile required');const evidence=await hostedAccountEvidence(actor),client=await actorCommunicationsClient(actor,{setupLane:'hosted'});
 const senders=await verifyDemoAccountBindings(actor,{client,recorded:async binding=>{const match=evidence.senders.find(v=>v.binding.connectionId===binding.connectionId);if(!match)throw Error('Hosted attestation missing');assertSameBinding(binding,match.binding);return match;}});
 return{runId:profile.runId,integrationId:'sim-'+profile.runId,configurationReference:'sim-'+profile.runId+'-v1',senders,attestation:evidence.attestation};
}
/** One explicit normal hosted-setup action. Unknown outcomes are returned for
 * operator reconciliation; never retry, complete auth, set defaults or register. */
export async function prepareDemoAccountConnection(actor:CampaignActor,channel:Channel,client?:Client){
 if(!channels.includes(channel))throw Error('Supported demo channel required');
 const profile=selectedProfile(actor);
 const sdk=client??await actorCommunicationsClient(actor,{setupLane:profile.lane});
 return sdk.setupConnection({applicationId:'acquire',tenantId:actor.organizationId,ownerId:actor.userId},{channel,platform:channel==='email'?'gmail':channel});
}
/** Produces data for a separately authorized registry write, never writes it.
 * Connected describes current owner/source capability; full history is checked
 * later at dispatch. Missing/ambiguous accounts cannot be guessed. */
export async function verifyDemoAccountBindings(actor:CampaignActor,ports?:{client:Client;recorded(binding:ConnectionBinding):Promise<VerifiedDemoAccount>}):Promise<DemoRegistrySender[]>{
 const profile=selectedProfile(actor),client=ports?.client??await actorCommunicationsClient(actor,{setupLane:profile.lane}),scope={applicationId:'acquire',tenantId:actor.organizationId,ownerId:actor.userId},snapshot=await client.connections(scope);if(!snapshot.available)throw Error('Demo account list unavailable');
 const hosted=profile.lane==='hosted'&&!ports?await hostedAccountEvidence(actor):null;
 const output:DemoRegistrySender[]=[];
 for(const candidate of snapshot.connections){assertManagedConnection(candidate,scope);if(candidate.status!=='connected')continue;
  const status=await client.connectionStatus(candidate.binding);assertManagedConnection(status,scope);assertSameBinding(status.binding,candidate.binding);
  // Unipile correctly advertises no durable provider idempotency. Normal
  // service journals/original lookup retain uncertain outcomes without a blind
  // retry; account registration must not invent an extra provider guarantee.
  if(status.status!=='connected'||status.readiness.status==='review'||!status.capabilities.messaging.send||!status.capabilities.messaging.receiptLookup||!status.capabilities.events.read||!status.capabilities.events.history)throw Error('Demo account needs current verification');
  const proof=ports?await ports.recorded(status.binding):hosted?hosted.senders.find(v=>v.binding.connectionId===status.binding.connectionId):await recordedAccount(actor,status.binding,profile.lane as 'demo'|'testing');if(!proof)throw Error('Original hosted attestation unavailable');assertSameBinding(proof.binding,status.binding);
  const channel=status.binding.channel;if(!channels.includes(channel)||!proof.active||!/^[-a-zA-Z0-9]+$/.test(proof.bindingId)||!/^[a-f0-9]{64}$/.test(proof.bindingDigest)||proof.providerAccountId!==`sim-${profile.runId}-${channel}`||proof.sourceId!==`sim-source-${channel}`)throw Error('Verified demo provider identity differs');
  output.push({channel,bindingId:proof.bindingId,bindingDigest:proof.bindingDigest,accountId:status.binding.accountId,providerAccountId:proof.providerAccountId,sourceId:proof.sourceId});
 }
 if(output.length!==3||new Set(output.map(s=>s.channel)).size!==3||new Set(output.map(s=>s.bindingId)).size!==3||new Set(output.map(s=>s.accountId)).size!==3)throw Error('Connect exactly one verified demo account per channel');
 return channels.map(channel=>output.find(s=>s.channel===channel)!);
}
