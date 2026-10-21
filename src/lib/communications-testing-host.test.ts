import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const f=vi.hoisted(()=>({read:vi.fn(),route:vi.fn(),connect:vi.fn(),end:vi.fn()}));
vi.mock('pg',()=>({Pool:class{connect=f.connect;end=f.end;}}));
vi.mock('@/db/campaign-client',()=>({campaignSqlPool:()=>({connect:f.connect})}));
vi.mock('./communications-routing',async original=>({...await original<object>(),resolveOwnedCommunicationsLane:f.route}));
vi.mock('../../communications/packages/adapter-unipile/src/v1-runtime',()=>({createConfiguredUnipileV1Runtime:()=>({})}));
vi.mock('../../communications/packages/adapter-unipile/src/v1-runtime-env',()=>({readConfiguredUnipileV1Environment:f.read}));
vi.mock('./communications-runtime',()=>({createAcquireCommunicationsRuntime:()=>({})}));
const key=(n:number)=>Buffer.alloc(32,n).toString('base64'),actor={organizationId:'org',userId:'owner'},binding={applicationId:'acquire',tenantId:'org',ownerId:'owner',connectionId:'original',accountId:'account',generation:1,channel:'email' as const,platform:'gmail' as const,backend:'unipile' as const};
const durable={COMMUNICATIONS_ACTIVE_KEY_VERSION:'v1',COMMUNICATIONS_KEYRING_JSON:'retained synthetic service keys',COMMUNICATIONS_IDENTITY_KEY:key(13),COMMUNICATIONS_IDENTITY_KEY_VERSION:'v1',ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION:'a1',ACQUIRE_COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:'a1',encryptionKey:key(21),digestKey:key(22)}])};
function setup(){
 const runId='agent-deep-gui-test',descriptor={version:1,runId,integrationId:'sim-'+runId,configurationReference:'sim-'+runId+'-v1',providerOrigin:'https://127.0.0.1:5990',serviceOrigin:'https://127.0.0.1:5991',actor:{applicationId:'acquire',tenantId:'org',ownerId:'owner'},capabilities:{dynamicRecipients:false,recipientContextLookup:false}};
 const env={...durable,NODE_ENV:'development',COMMUNICATIONS_RUNTIME_ENABLED:'true',COMMUNICATIONS_DATABASE_URL:'postgresql://synthetic.invalid/unchanged',AGENT_MODE_COMMUNICATIONS_MODE:'simulator',COMMUNICATIONS_APPLICATION_ID:'acquire',UNIPILE_API_URL:descriptor.providerOrigin,COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:descriptor.providerOrigin,COMMUNICATIONS_SERVICE_URL:descriptor.serviceOrigin,COMMUNICATIONS_INTEGRATION_ID:descriptor.integrationId,COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE:descriptor.configurationReference};
 for(const[k,v]of Object.entries({...durable,NODE_ENV:'development',COMMUNICATIONS_RUNTIME_ENABLED:'true',COMMUNICATIONS_DATABASE_URL:env.COMMUNICATIONS_DATABASE_URL,COMMUNICATIONS_INTEGRATION_ID:'primary',COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE:'primary-v1',AGENT_DEMO_COMMUNICATIONS_ENABLED:'true',AGENT_TESTING_COMMUNICATIONS_ENABLED:'true',AGENT_TESTING_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify(descriptor),AGENT_TESTING_COMMUNICATIONS_ENV_JSON:JSON.stringify(env),AGENT_DEMO_COMMUNICATIONS_ENV_JSON:JSON.stringify({...env,UNIPILE_API_URL:'https://127.0.0.1:5890',COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:'https://127.0.0.1:5890',COMMUNICATIONS_SERVICE_URL:'https://127.0.0.1:5891',COMMUNICATIONS_PORT:'5463',COMMUNICATIONS_INTEGRATION_ID:'sim-agent-real-research-demos',COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE:'sim-agent-real-research-demos-v1'})}))vi.stubEnv(k,v);
 f.read.mockImplementation((e,pool)=>({scopedAuthKey:Buffer.alloc(32,8),options:{applicationId:'acquire',pool,providerConfigurationReference:e.COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE,callbackKey:Buffer.alloc(32,7),vault:{identityKey:Buffer.alloc(32,13),activeVersion:'v1',keys:[{version:'v1',encryptionKey:Buffer.alloc(32,11),digestKey:Buffer.alloc(32,12)}]}}}));
 return env;
}
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();});afterEach(()=>vi.unstubAllEnvs());
it('selects only the original testing host without replacing primary or historical demo instances',async()=>{
 setup();const {configuredAcquireCommunicationsForBinding:select}=await import('./communications-configuration');
 for(const [lane,configuration]of [['testing','sim-agent-deep-gui-test-v1'],['demo','sim-agent-real-research-demos-v1'],['primary','primary-v1']]){f.route.mockResolvedValueOnce(lane);expect((await select(actor,binding)).options.providerConfigurationReference).toBe(configuration);}
 expect(f.connect).not.toHaveBeenCalled();
});
it.each(['keyring','database','actor'])('fails closed on testing %s mismatch without constructing a replacement host',async kind=>{
 const env=setup();if(kind==='keyring')vi.stubEnv('AGENT_TESTING_COMMUNICATIONS_ENV_JSON',JSON.stringify({...env,COMMUNICATIONS_KEYRING_JSON:'another key version'}));if(kind==='database')vi.stubEnv('AGENT_TESTING_COMMUNICATIONS_ENV_JSON',JSON.stringify({...env,COMMUNICATIONS_DATABASE_URL:'postgresql://synthetic.invalid/other'}));
 f.route.mockResolvedValueOnce('testing');const {configuredAcquireCommunicationsForBinding:select}=await import('./communications-configuration');await expect(select(kind==='actor'?{...actor,userId:'foreign'}:actor,binding)).rejects.toThrow();expect(f.read).not.toHaveBeenCalled();expect(f.connect).not.toHaveBeenCalled();
});
it('never replaces a disabled historical testing binding with the primary host',async()=>{
 setup();vi.stubEnv('AGENT_DEMO_COMMUNICATIONS_ENABLED','false');vi.stubEnv('AGENT_TESTING_COMMUNICATIONS_ENABLED','false');f.route.mockRejectedValueOnce(Error('Original testing configuration unavailable'));
 const {configuredAcquireCommunicationsForBinding:select}=await import('./communications-configuration');await expect(select(actor,binding)).rejects.toThrow('Original testing configuration unavailable');expect(f.read).not.toHaveBeenCalled();
});
