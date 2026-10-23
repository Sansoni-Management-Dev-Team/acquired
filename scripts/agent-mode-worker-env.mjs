const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pilots=['e7da3f8c-8c45-4aef-bac4-392b918e0025','e7da3f8c-8c45-4aef-bac4-392b918e0026'];
/** Server/operator-owned local controls, never sourced from messaging settings. */
export function buildAgentWorkerEnvironment(application,previous={},overrides={},profile='mailbox'){
 if(!['mailbox','simulator','simulator25','simulator50','multichannel'].includes(profile))throw Error('Invalid local worker profile');
 const pick=name=>overrides[name]??previous[name];
 if(profile==='multichannel'){
  for(const key of ['DATABASE_URL','COMMUNICATIONS_DATABASE_URL']){let db;try{db=new URL(application[key]);}catch{throw Error('Exact isolated registered database required');}if(!['postgres:','postgresql:'].includes(db.protocol)||!(db.hostname==='postgres'&&db.port==='5432'||db.hostname==='127.0.0.1'&&db.port==='5437')||db.pathname!=='/acquire_agent_mode'||db.search||db.hash)throw Error('Exact isolated registered database required');}
  if(overrides.AGENT_WORKER_SCOPE_MODE!==undefined&&overrides.AGENT_WORKER_SCOPE_MODE!=='registered'||overrides.AGENT_WORKER_RUNTIME_ID!==undefined&&overrides.AGENT_WORKER_RUNTIME_ID!=='agent-multichannel-20261017')throw Error('Exact registered runtime identity required');
  if(application.NODE_ENV!=='development'||application.AGENT_MODE_COMMUNICATIONS_MODE!=='simulator'||application.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN!=='https://127.0.0.1:5790'||overrides.AGENT_WORKER_MANDATE_ID!==undefined)throw Error('Exact registered local simulator required');
  const enabled=overrides.AGENT_NATIVE_EXECUTION_ENABLED??(previous.AGENT_WORKER_SCOPE_MODE==='registered'?previous.AGENT_NATIVE_EXECUTION_ENABLED:'false')??'false',fast=pick('AGENT_MODE_SIMULATOR_TEST_POLICY')??'false';
  if(!['true','false'].includes(enabled)||!['true','false'].includes(fast))throw Error('Invalid registered runtime flags');
  const out={...application,AGENT_NATIVE_EXECUTION_ENABLED:enabled,AGENT_WORKER_SCOPE_MODE:'registered',AGENT_WORKER_RUNTIME_ID:'agent-multichannel-20261017',AGENT_WORKER_REQUIRE_MANDATE_SCOPE:'true',AGENT_MODE_SIMULATOR_TEST_POLICY:fast};delete out.AGENT_WORKER_MANDATE_ID;return out;
 }
 const enabled=pick('AGENT_NATIVE_EXECUTION_ENABLED')??'false';
 if(!['true','false'].includes(enabled))throw Error('Invalid native execution flag');
 const mandate=pick('AGENT_WORKER_MANDATE_ID');
 if(mandate!==undefined&&!uuid.test(mandate))throw Error('Invalid exact worker mandate');
 const fast=pick('AGENT_MODE_SIMULATOR_TEST_POLICY')??'false';
 if(!['true','false'].includes(fast))throw Error('Invalid local simulator policy flag');
 const output={...application,AGENT_WORKER_SCOPE_MODE:'exact',AGENT_NATIVE_EXECUTION_ENABLED:'false',AGENT_WORKER_REQUIRE_MANDATE_SCOPE:'true',...(mandate?{AGENT_WORKER_MANDATE_ID:mandate}:{}),AGENT_MODE_SIMULATOR_TEST_POLICY:'false'};
 delete output.AGENT_WORKER_RUNTIME_ID;
 if(profile==='mailbox')return output;
 const provider=profile==='simulator50'?'https://127.0.0.1:5690':profile==='simulator25'?'https://127.0.0.1:5590':'https://127.0.0.1:5490';
 if(application.NODE_ENV!=='development'||application.AGENT_MODE_COMMUNICATIONS_MODE!=='simulator'||application.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN!==provider)throw Error('Exact local simulator required');
 if(enabled==='true'&&!mandate)throw Error('Native simulator requires exact mandate scope');
 if(fast==='true'&&!(profile==='simulator25'&&pilots.includes(mandate)||profile==='simulator50'&&mandate==='e7da3f8c-8c45-4aef-bac4-392b918e0050'))throw Error('Local accelerated policy requires exact isolated pilot mandate');
 return {...output,AGENT_NATIVE_EXECUTION_ENABLED:enabled,AGENT_MODE_SIMULATOR_TEST_POLICY:fast};
}
