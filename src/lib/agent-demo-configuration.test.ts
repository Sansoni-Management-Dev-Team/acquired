import {expect,it} from 'vitest';
import {agentDemoPreparationReadiness,agentDemoProvisioningConfiguration} from './agent-demo-configuration';
const env={AGENT_DEMO_CONTACTS_ENABLED:'true',AGENT_DEMO_COMMUNICATIONS_ENABLED:'true',AGENT_DEMO_CONTROL_URL:'https://127.0.0.1:5890',AGENT_DEMO_CONTROL_ADMIN_KEY:'test-private-control-key'};
it('requires both independent demo flags and the exact local control origin',()=>{
 expect(agentDemoProvisioningConfiguration(env)).toMatchObject({selection:{runId:'agent-real-research-demos',integrationId:'sim-agent-real-research-demos'}});
 for(const overrides of [{AGENT_DEMO_CONTACTS_ENABLED:'false'},{AGENT_DEMO_COMMUNICATIONS_ENABLED:'false'},{AGENT_DEMO_CONTROL_URL:'https://127.0.0.1:5790'},{AGENT_DEMO_CONTROL_URL:'https://real.example.com'},{AGENT_DEMO_CONTROL_URL:'https://user:secret@127.0.0.1:5890'},{AGENT_DEMO_CONTROL_ADMIN_KEY:''}])expect(agentDemoProvisioningConfiguration({...env,...overrides})).toBeNull();
 expect(agentDemoProvisioningConfiguration({})).toBeNull();
});

const testingDescriptor={version:1,runId:'agent-deep-gui-test',integrationId:'sim-agent-deep-gui-test',configurationReference:'sim-agent-deep-gui-test-v1',providerOrigin:'https://127.0.0.1:5990',serviceOrigin:'https://127.0.0.1:5991',actor:{applicationId:'acquire',tenantId:'org',ownerId:'user'},capabilities:{dynamicRecipients:false,recipientContextLookup:false}};
const testingTransport={NODE_ENV:'development',COMMUNICATIONS_RUNTIME_ENABLED:'true',AGENT_MODE_COMMUNICATIONS_MODE:'simulator',COMMUNICATIONS_APPLICATION_ID:'acquire',UNIPILE_API_URL:'https://127.0.0.1:5990',COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:'https://127.0.0.1:5990',COMMUNICATIONS_SERVICE_URL:'https://127.0.0.1:5991',COMMUNICATIONS_INTEGRATION_ID:testingDescriptor.integrationId,COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE:testingDescriptor.configurationReference};
const testingEnv={...env,NODE_ENV:'development',AGENT_TESTING_COMMUNICATIONS_ENV_JSON:JSON.stringify(testingTransport),AGENT_DEMO_TARGET:'testing',AGENT_TESTING_COMMUNICATIONS_ENABLED:'true',AGENT_TESTING_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify(testingDescriptor),AGENT_TESTING_DEMO_CONTROL_ADMIN_KEY:'separate-testing-control-key'};
it('selects the explicit testing descriptor without reusing legacy authority or claiming recipient readiness',()=>{
 expect(agentDemoProvisioningConfiguration(testingEnv)).toMatchObject({control:{endpoint:'https://127.0.0.1:5990',adminKey:'separate-testing-control-key',expectedRunId:'agent-deep-gui-test'},selection:{runId:'agent-deep-gui-test',integrationId:'sim-agent-deep-gui-test',configurationReference:'sim-agent-deep-gui-test-v1'},testing:{actor:testingDescriptor.actor,capabilities:testingDescriptor.capabilities,serviceOrigin:'https://127.0.0.1:5991'}});
});
it('never falls back to the old demo service after explicit testing selection fails validation',()=>{
 for(const changes of [{AGENT_TESTING_COMMUNICATIONS_DESCRIPTOR_JSON:undefined},{AGENT_TESTING_COMMUNICATIONS_ENABLED:'false'},{AGENT_TESTING_DEMO_CONTROL_ADMIN_KEY:undefined},{AGENT_TESTING_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify({...testingDescriptor,serviceOrigin:'https://127.0.0.1:5891'})}])expect(agentDemoProvisioningConfiguration({...testingEnv,...changes})).toBeNull();
 expect(agentDemoProvisioningConfiguration({...env,AGENT_DEMO_TARGET:'unknown'})).toBeNull();
});

it('requires exact GUI ownership and both capabilities before enabling contact preparation',()=>{
 const actor={organizationId:'org',userId:'user'};
 expect(agentDemoPreparationReadiness(agentDemoProvisioningConfiguration(testingEnv),actor)).toMatchObject({ready:false,message:expect.stringMatching(/5991.*not ready/)});
 const readyEnv={...testingEnv,AGENT_TESTING_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify({...testingDescriptor,capabilities:{dynamicRecipients:true,recipientContextLookup:true}})};
 const config=agentDemoProvisioningConfiguration(readyEnv);expect(config).not.toBeNull();
 expect(agentDemoPreparationReadiness(config,actor)).toEqual({ready:true});
 expect(agentDemoPreparationReadiness(config,{...actor,userId:'foreign-user'})).toMatchObject({ready:false});
 expect(agentDemoPreparationReadiness(config,{...actor,organizationId:'foreign-org'})).toMatchObject({ready:false});
 expect(agentDemoPreparationReadiness(agentDemoProvisioningConfiguration(env),actor)).toEqual({ready:true});
});

it('selects hosted participant preparation only from an active private production descriptor without a local admin credential',()=>{
 const runId='hosted-demo-example',descriptor={version:1,mode:'hosted-demo',phase:'active',runId,integrationId:'sim-'+runId,configurationReference:'sim-'+runId+'-v1',applicationOrigin:'https://acquire.example.invalid',serviceOrigin:'https://simulator.example.invalid',setupOrigin:'https://simulator.example.invalid',actor:{applicationId:'acquire',tenantId:'org',ownerId:'user'},capabilities:{dynamicRecipients:true,recipientContextLookup:true,remoteApplicationAuthority:true,durableEvents:true},bindings:[{applicationId:'acquire',tenantId:'org',ownerId:'user',connectionId:'original',accountId:'account',generation:1,channel:'email',platform:'gmail',backend:'unipile'}]},hosted={AGENT_DEMO_CONTACTS_ENABLED:'true',AGENT_DEMO_COMMUNICATIONS_ENABLED:'true',AGENT_DEMO_TARGET:'hosted',NODE_ENV:'production',APP_URL:descriptor.applicationOrigin,AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED:'true',AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify(descriptor)};
 const configured=agentDemoProvisioningConfiguration(hosted);expect(configured).toMatchObject({control:{transport:'hosted',expectedRunId:runId,request:expect.any(Function)},selection:{runId,integrationId:descriptor.integrationId,configurationReference:descriptor.configurationReference}});expect(configured?.control).not.toHaveProperty('adminKey');expect(agentDemoPreparationReadiness(configured,{organizationId:'org',userId:'user'})).toEqual({ready:true});expect(agentDemoPreparationReadiness(configured,{organizationId:'org',userId:'foreign'})).toMatchObject({ready:false});
 for(const patch of[{NODE_ENV:'development'},{AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED:'false'},{AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify({...descriptor,phase:'provisioning',bindings:[]})}])expect(agentDemoProvisioningConfiguration({...hosted,...patch})).toBeNull();
});
