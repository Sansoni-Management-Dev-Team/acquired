import {DEMO_COMMUNICATIONS_INTEGRATION,DEMO_COMMUNICATIONS_CONFIGURATION} from './communications-routing';
/** Private server configuration only; never accepts browser lane URLs. */
export function readDemoCommunicationsEnvironment(env:Record<string,string|undefined>):Record<string,string>{
 try{
  if(env.NODE_ENV!=='development'||env.AGENT_DEMO_COMMUNICATIONS_ENABLED!=='true')throw Error();
  const d:unknown=JSON.parse(env.AGENT_DEMO_COMMUNICATIONS_ENV_JSON||'null');
  if(!d||typeof d!=='object'||Array.isArray(d)||Object.values(d).some(v=>typeof v!=='string'))throw Error();
  const r=d as Record<string,string>;
  if(r.NODE_ENV!=='development'||r.AGENT_MODE_COMMUNICATIONS_MODE!=='simulator'||r.UNIPILE_API_URL!=='https://127.0.0.1:5890'||r.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN!==r.UNIPILE_API_URL||r.COMMUNICATIONS_SERVICE_URL!=='https://127.0.0.1:5891'||r.COMMUNICATIONS_PORT!=='5463'||r.COMMUNICATIONS_INTEGRATION_ID!==DEMO_COMMUNICATIONS_INTEGRATION||r.COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE!==DEMO_COMMUNICATIONS_CONFIGURATION)throw Error();
  return r;
 }catch{throw Error('Demo communications configuration unavailable');}
}
