import {z} from 'zod';
const identity=z.string().min(1).max(200).refine(value=>value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value));
const descriptorSchema=z.object({
 version:z.literal(1),runId:z.string().regex(/^agent-deep-[a-z0-9][a-z0-9-]{0,36}$/),
 integrationId:identity,configurationReference:identity,
 providerOrigin:z.literal('https://127.0.0.1:5990'),serviceOrigin:z.literal('https://127.0.0.1:5991'),
 actor:z.object({applicationId:z.literal('acquire'),tenantId:identity,ownerId:identity}).strict(),
 capabilities:z.object({dynamicRecipients:z.boolean(),recipientContextLookup:z.boolean()}).strict(),
}).strict().refine(value=>value.integrationId==='sim-'+value.runId&&value.configurationReference===value.integrationId+'-v1');
export type TestingCommunicationsDescriptor=z.infer<typeof descriptorSchema>;
type Actor={organizationId:string;userId:string};
function configuration(env:Record<string,string|undefined>,actor?:Actor){
 try{
  if(env.NODE_ENV!=='development'||env.AGENT_TESTING_COMMUNICATIONS_ENABLED!=='true')throw Error();
  const descriptor=descriptorSchema.parse(JSON.parse(env.AGENT_TESTING_COMMUNICATIONS_DESCRIPTOR_JSON||'null'));
  const environment=z.record(z.string(),z.string()).parse(JSON.parse(env.AGENT_TESTING_COMMUNICATIONS_ENV_JSON||'null'));
  const api=new URL(environment.UNIPILE_API_URL||'');
  if(environment.NODE_ENV!=='development'||environment.COMMUNICATIONS_RUNTIME_ENABLED!=='true'||environment.AGENT_MODE_COMMUNICATIONS_MODE!=='simulator'||environment.COMMUNICATIONS_APPLICATION_ID!=='acquire'
   ||api.origin!==descriptor.providerOrigin||!['/','/api/v1','/api/v1/'].includes(api.pathname)||api.username||api.password||api.search||api.hash
   ||environment.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN!==descriptor.providerOrigin||environment.COMMUNICATIONS_SERVICE_URL!==descriptor.serviceOrigin
   ||environment.COMMUNICATIONS_INTEGRATION_ID!==descriptor.integrationId||environment.COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE!==descriptor.configurationReference
   ||environment.COMMUNICATIONS_REDIRECT_ORIGIN!==undefined&&environment.COMMUNICATIONS_REDIRECT_ORIGIN!==descriptor.serviceOrigin
   ||environment.COMMUNICATIONS_SETUP_NOTIFY_URL!==undefined&&environment.COMMUNICATIONS_SETUP_NOTIFY_URL!==descriptor.serviceOrigin+'/v1/setup/notify')throw Error();
  if(actor&&(descriptor.actor.tenantId!==actor.organizationId||descriptor.actor.ownerId!==actor.userId))throw Error();
  return {descriptor,environment};
 }catch{throw Error('Testing communications configuration unavailable');}
}
/** Trusted private server descriptor only. Capabilities are explicit evidence;
 * a healthy endpoint never supplies missing actor or recipient authority. */
export function readTestingCommunicationsDescriptor(env:Record<string,string|undefined>,actor?:Actor){return configuration(env,actor).descriptor;}
export function readTestingCommunicationsEnvironment(env:Record<string,string|undefined>,actor?:Actor){return configuration(env,actor).environment;}
