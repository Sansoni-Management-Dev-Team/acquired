import {retainAgentTestingConfiguration} from './agent-mode-testing-launcher.mjs';
import {isDeepStrictEqual} from 'node:util';
import {buildAgentDemoCommunicationsEnvironment} from './agent-mode-demo-communications-env.mjs';

/** Compose an explicitly activated lane without changing the primary profile.
 * A normal restart preserves its exact saved authority; it cannot rotate it.
 * This pure plan performs no file, process, provider or database operations. */
export function agentModeDemoLaunch({application,previous={},settings=null,activate=false}) {
  if(typeof activate!=='boolean'||![undefined,'true','false'].includes(previous.AGENT_MODE_ENABLE_DEMOS))throw Error('Invalid saved demo activation');
  const retained=previous.AGENT_MODE_ENABLE_DEMOS==='true';
  if(!activate&&!retained)return {enabled:false,application:retainAgentTestingConfiguration(application,previous),service:null};
  if(!settings)throw Error('Prepare the dedicated private demo configuration before activation');
  const lane=buildAgentDemoCommunicationsEnvironment(application,settings);
  if(retained){
    let saved;
    try{saved=JSON.parse(previous.AGENT_DEMO_COMMUNICATIONS_ENV_JSON);}catch{throw Error('Saved demo runtime is unavailable');}
    if(!isDeepStrictEqual(saved,lane.service))throw Error('Saved demo runtime changed; use a separately reviewed configuration transition');
  }
  const controls={};
  if(previous.AGENT_DEMO_CONTACTS_ENABLED!==undefined){
    if(!['true','false'].includes(previous.AGENT_DEMO_CONTACTS_ENABLED))throw Error('Invalid saved demo control authority');
    controls.AGENT_DEMO_CONTACTS_ENABLED=previous.AGENT_DEMO_CONTACTS_ENABLED;
    if(previous.AGENT_DEMO_CONTACTS_ENABLED==='true'){
      const key=previous.AGENT_DEMO_CONTROL_ADMIN_KEY;
      if(previous.AGENT_DEMO_CONTROL_URL!=='https://127.0.0.1:5890'||typeof key!=='string'||!key||key!==key.trim()||/[\r\n\0]/.test(key))throw Error('Invalid saved demo control authority');
      controls.AGENT_DEMO_CONTROL_URL=previous.AGENT_DEMO_CONTROL_URL;
      controls.AGENT_DEMO_CONTROL_ADMIN_KEY=key;
    }
  }
  return {enabled:true,application:retainAgentTestingConfiguration({...lane.application,...controls,AGENT_MODE_ENABLE_DEMOS:'true'},previous),service:lane.service};
}
