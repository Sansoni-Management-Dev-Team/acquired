const retainedKeys=['AGENT_DEMO_TARGET','AGENT_TESTING_COMMUNICATIONS_ENABLED','AGENT_TESTING_COMMUNICATIONS_ENV_JSON','AGENT_TESTING_COMMUNICATIONS_DESCRIPTOR_JSON','AGENT_TESTING_DEMO_CONTROL_ADMIN_KEY'];
const shared=['COMMUNICATIONS_ACTIVE_KEY_VERSION','COMMUNICATIONS_KEYRING_JSON','COMMUNICATIONS_IDENTITY_KEY','COMMUNICATIONS_IDENTITY_KEY_VERSION','ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION','ACQUIRE_COMMUNICATIONS_KEYRING_JSON'];
/** Preserve an explicitly reviewed testing target across ordinary app restarts.
 * No endpoint, process, database or historical demo binding is changed here. */
export function retainAgentTestingConfiguration(application,previous){
 if(previous.AGENT_DEMO_TARGET===undefined||previous.AGENT_DEMO_TARGET==='demo')return application;
 if(previous.AGENT_DEMO_TARGET!=='testing')throw Error('Unknown saved demo target');
 try{
  if(application.NODE_ENV!=='development'||previous.AGENT_TESTING_COMMUNICATIONS_ENABLED!=='true')throw Error();
  const d=JSON.parse(previous.AGENT_TESTING_COMMUNICATIONS_DESCRIPTOR_JSON),e=JSON.parse(previous.AGENT_TESTING_COMMUNICATIONS_ENV_JSON);
  if(d.version!==1||!/^agent-deep-[a-z0-9][a-z0-9-]{0,36}$/.test(d.runId)||d.providerOrigin!=='https://127.0.0.1:5990'||d.serviceOrigin!=='https://127.0.0.1:5991'||d.integrationId!=='sim-'+d.runId||d.configurationReference!==d.integrationId+'-v1'||d.actor?.applicationId!=='acquire'||!d.actor.tenantId||!d.actor.ownerId||typeof d.capabilities?.dynamicRecipients!=='boolean'||typeof d.capabilities?.recipientContextLookup!=='boolean')throw Error();
  const api=new URL(e.UNIPILE_API_URL);if(api.origin!==d.providerOrigin||!['/','/api/v1','/api/v1/'].includes(api.pathname)||api.username||api.password||api.search||api.hash||e.NODE_ENV!=='development'||e.AGENT_MODE_COMMUNICATIONS_MODE!=='simulator'||e.COMMUNICATIONS_SERVICE_URL!==d.serviceOrigin||e.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN!==d.providerOrigin||e.COMMUNICATIONS_INTEGRATION_ID!==d.integrationId||e.COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE!==d.configurationReference||e.COMMUNICATIONS_DATABASE_URL!==application.COMMUNICATIONS_DATABASE_URL||shared.some(k=>!e[k]||e[k]!==application[k]))throw Error();
  if(typeof previous.AGENT_TESTING_DEMO_CONTROL_ADMIN_KEY!=='string'||!previous.AGENT_TESTING_DEMO_CONTROL_ADMIN_KEY||/[\r\n\0]/.test(previous.AGENT_TESTING_DEMO_CONTROL_ADMIN_KEY))throw Error();
  return {...application,...Object.fromEntries(retainedKeys.map(k=>[k,previous[k]]))};
 }catch{throw Error('Saved testing communications target is unavailable; restore its reviewed configuration');}
}
