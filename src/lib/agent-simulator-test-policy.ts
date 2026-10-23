/** Server configuration only. SQL admission independently requires an unexpired operator policy. */
export function localSimulatorTestPolicy(env:Record<string,string|undefined>):boolean{
 const flag=env.AGENT_MODE_SIMULATOR_TEST_POLICY;if(flag===undefined||flag==='false')return false;
 try{
  if(env.AGENT_WORKER_SCOPE_MODE!==undefined&&!['exact','registered'].includes(env.AGENT_WORKER_SCOPE_MODE))throw Error();
  const registered=env.AGENT_WORKER_SCOPE_MODE==='registered';
  if(registered&&(env.AGENT_WORKER_RUNTIME_ID!=='agent-multichannel-20261017'||env.AGENT_WORKER_MANDATE_ID!==undefined))throw Error();
  const demo=registered&&env.COMMUNICATIONS_INTEGRATION_ID==='sim-agent-real-research-demos';
  const fifty=env.AGENT_WORKER_MANDATE_ID==='e7da3f8c-8c45-4aef-bac4-392b918e0050',size=fifty?'50':'25',port=registered?(demo?'589':'579'):fifty?'569':'559';
  const exact:Record<string,string>={AGENT_MODE_SIMULATOR_TEST_POLICY:'true',NODE_ENV:'development',AGENT_MODE_COMMUNICATIONS_MODE:'simulator',AGENT_WORKER_REQUIRE_MANDATE_SCOPE:'true',COMMUNICATIONS_INTEGRATION_ID:registered?(demo?'sim-agent-real-research-demos':'sim-agent-multichannel-20261017'):`sim-agent-conversations-${size}-20261017`,COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE:registered?(demo?'sim-agent-real-research-demos-v1':'sim-agent-multichannel-20261017-v1'):`sim-agent-conversations-${size}-20261017-v1`,COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:`https://127.0.0.1:${port}0`,COMMUNICATIONS_SERVICE_URL:`https://127.0.0.1:${port}1`,COMMUNICATIONS_REDIRECT_ORIGIN:`https://127.0.0.1:${port}1`,COMMUNICATIONS_SETUP_NOTIFY_URL:`https://127.0.0.1:${port}1/v1/setup/notify`};
  if(!registered&&!['e7da3f8c-8c45-4aef-bac4-392b918e0025','e7da3f8c-8c45-4aef-bac4-392b918e0026','e7da3f8c-8c45-4aef-bac4-392b918e0050'].includes(env.AGENT_WORKER_MANDATE_ID??''))throw Error();
  for(const [key,value] of Object.entries(exact))if(env[key]!==value)throw Error();
  if(![`https://127.0.0.1:${port}0`,`https://127.0.0.1:${port}0/`,`https://127.0.0.1:${port}0/api/v1`,`https://127.0.0.1:${port}0/api/v1/`].includes(env.UNIPILE_API_URL??''))throw Error();
  for(const key of ['DATABASE_URL','COMMUNICATIONS_DATABASE_URL']){const db=new URL(env[key]??'');if(!['postgres:','postgresql:'].includes(db.protocol)||!(db.hostname==='postgres'&&db.port==='5432'||db.hostname==='127.0.0.1'&&db.port==='5437')||db.pathname!=='/acquire_agent_mode'||db.search||db.hash)throw Error();}
  return true;
 }catch{throw Error('Isolated simulator test policy unavailable');}
}
