import {buildAgentCommunicationsEnvironment} from './agent-mode-communications-env.mjs';
const shared=['COMMUNICATIONS_ACTIVE_KEY_VERSION','COMMUNICATIONS_KEYRING_JSON','COMMUNICATIONS_IDENTITY_KEY','COMMUNICATIONS_IDENTITY_KEY_VERSION','ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION','ACQUIRE_COMMUNICATIONS_KEYRING_JSON'];
/** Add a second lane, never replace the saved primary provider/profile. */
export function buildAgentDemoCommunicationsEnvironment(primary,settings){
 if(primary.COMMUNICATIONS_RUNTIME_ENABLED!=='true'||primary.NODE_ENV!=='development')throw Error('Primary local communications required');
 const demo=buildAgentCommunicationsEnvironment(primary,settings);
 if(settings.UNIPILE_API_URL!=='https://127.0.0.1:5890'||settings.AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN!=='https://127.0.0.1:5891'||settings.COMMUNICATIONS_INTEGRATION_ID!=='sim-agent-real-research-demos'||settings.COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE!=='sim-agent-real-research-demos-v1')throw Error('Exact demo profile required');
 for(const k of shared)if(!primary[k]||settings[k]!==primary[k])throw Error('Shared durable keyring required');
 if(settings.COMMUNICATIONS_SCOPED_AUTH_KEY===primary.COMMUNICATIONS_SCOPED_AUTH_KEY||settings.COMMUNICATIONS_SETUP_CALLBACK_KEY===primary.COMMUNICATIONS_SETUP_CALLBACK_KEY||settings.COMMUNICATIONS_WEBHOOK_SECRET===primary.COMMUNICATIONS_WEBHOOK_SECRET)throw Error('Distinct demo request and callback secrets required');
 const context={};
 if(primary.AGENT_LOCAL_SIMULATION_ENABLED==='true'){
  const exact={AGENT_MODE_SIMULATOR_TEST_POLICY:'true',AGENT_WORKER_SCOPE_MODE:'registered',AGENT_WORKER_RUNTIME_ID:'agent-multichannel-20261017',AGENT_WORKER_REQUIRE_MANDATE_SCOPE:'true'};
  if(primary.AGENT_WORKER_MANDATE_ID!==undefined||Object.entries(exact).some(([key,value])=>primary[key]!==value))throw Error('Exact registered local admission context required');
  Object.assign(context,exact);
 }
 const service={...demo.service,...context,COMMUNICATIONS_PORT:'5463',AGENT_NATIVE_EXECUTION_ENABLED:'false'};
 return{application:{...primary,AGENT_DEMO_COMMUNICATIONS_ENABLED:'true',AGENT_DEMO_COMMUNICATIONS_ENV_JSON:JSON.stringify(service)},service};
}
