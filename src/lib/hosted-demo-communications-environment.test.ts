import{expect,it}from'vitest';
import{readHostedDemoCommunicationsDescriptor}from'./hosted-demo-communications-environment';
const binding={applicationId:'acquire',tenantId:'org',ownerId:'owner',connectionId:'hosted-connection',accountId:'hosted-account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'};
const descriptor={version:1,mode:'hosted-demo',runId:'hosted-demo-scenario',integrationId:'sim-hosted-demo-scenario',configurationReference:'sim-hosted-demo-scenario-v1',applicationOrigin:'https://app.example.invalid',serviceOrigin:'https://demo-service.example.invalid',setupOrigin:'https://demo-provider.example.invalid',actor:{applicationId:'acquire',tenantId:'org',ownerId:'owner'},capabilities:{dynamicRecipients:true,recipientContextLookup:true,remoteApplicationAuthority:true,durableEvents:true},bindings:[binding]};
const env={NODE_ENV:'production',AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED:'true',APP_URL:descriptor.applicationOrigin,AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify(descriptor)};
const read=(patch:Record<string,unknown>={})=>readHostedDemoCommunicationsDescriptor({...env,AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify({...descriptor,...patch})});
it('requires an explicit production-only hosted descriptor without altering local flags or needing provider/database credentials',()=>{
 expect(readHostedDemoCommunicationsDescriptor(env,{organizationId:'org',userId:'owner'})).toEqual({...descriptor,phase:'active'});
 for(const patch of[{NODE_ENV:'development'},{AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED:'false'},{APP_URL:'https://foreign.example.invalid'},{AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON:''},{AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON:'null'}])expect(()=>readHostedDemoCommunicationsDescriptor({...env,...patch})).toThrow('Hosted demo communications unavailable');
});
it('rejects arbitrary origins, embedded credentials, local addresses and altered immutable run identities',()=>{
 for(const url of['http://demo.example.invalid','https://localhost','https://127.0.0.1','https://[::1]','https://169.254.169.254','https://10.0.0.1','https://demo.internal','https://user:secret@demo.example.invalid','https://demo.example.invalid:444','https://demo.example.invalid/path','https://demo.example.invalid?secret=value','https://demo.example.invalid/#fragment'])for(const key of['applicationOrigin','serviceOrigin','setupOrigin'])expect(()=>read({[key]:url})).toThrow();
 for(const patch of[{mode:'live'},{version:2},{runId:'local-gui'},{integrationId:'primary'},{configurationReference:'another-v1'},{extra:'private raw profile'},{localSimulatorOrigin:'https://127.0.0.1:5990'}])expect(()=>read(patch)).toThrow();
});
it('shares the remote recipient protocol run-id bound instead of accepting an unresolvable larger run',()=>{
 const runId='hosted-demo-'+'x'.repeat(37);expect(runId).toHaveLength(49);expect(()=>read({runId,integrationId:'sim-'+runId,configurationReference:'sim-'+runId+'-v1'})).toThrow();
});
it('allows empty bindings only during explicit private provisioning and never treats that descriptor as active',()=>{
 expect(read({phase:'provisioning',bindings:[]})).toMatchObject({phase:'provisioning',bindings:[]});expect(()=>read({phase:'active',bindings:[]})).toThrow();expect(()=>read({phase:'unknown'})).toThrow();
});
it('requires the exact actor, declared capabilities and unique complete original bindings, including retained generations',()=>{
 for(const actor of[{organizationId:'other',userId:'owner'},{organizationId:'org',userId:'other'}])expect(()=>readHostedDemoCommunicationsDescriptor(env,actor)).toThrow();
 for(const patch of[{actor:{...descriptor.actor,applicationId:'foreign'}},{bindings:[]},{bindings:[binding,binding]},{bindings:[{...binding,ownerId:'other'}]},{bindings:[{...binding,generation:0}]},{bindings:[{...binding,platform:'gmail'}]},{bindings:[{...binding,secret:'credential'}]},{capabilities:{...descriptor.capabilities,remoteApplicationAuthority:false}},{capabilities:{dynamicRecipients:true}}])expect(()=>read(patch)).toThrow();
 expect(read({bindings:[binding,{...binding,generation:2}]})).toMatchObject({bindings:[{generation:1},{generation:2}]});
});
