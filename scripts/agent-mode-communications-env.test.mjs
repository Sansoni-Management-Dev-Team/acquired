import test from 'node:test';import assert from 'node:assert/strict';
import {buildAgentCommunicationsEnvironment} from './agent-mode-communications-env.mjs';
const key=n=>Buffer.alloc(32,n).toString('base64');
const base={APP_URL:'http://acquire-agent.orb.local',NEXT_PUBLIC_APP_URL:'http://acquire-agent.orb.local',DATABASE_URL:'postgresql://project_acquire:agent-local-only@postgres:5432/acquire_agent_mode',CAMPAIGN_N8N_ENABLED:'false',AGENT_NATIVE_EXECUTION_ENABLED:'false',RESEARCH_ENABLED:'true',TARGET_DATA_PROVIDER:'fixture',OPENAI_API_KEY:'synthetic-research-only',UNIPILE_API_KEY:'must-not-inherit',COMMUNICATIONS_FUTURE_SECRET:'must-not-inherit',ACQUIRE_COMMUNICATIONS_KEYRING_JSON:'must-not-inherit'};
function settings(){return {AGENT_MODE_COMMUNICATIONS_MODE:'connect-only',AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN:'https://synthetic-local.trycloudflare.com',UNIPILE_API_URL:'https://synthetic-unipile.example.invalid:13579/api/v1',UNIPILE_API_KEY:'synthetic-unipile-private',COMMUNICATIONS_APPLICATION_ID:'acquire',COMMUNICATIONS_INTEGRATION_ID:'agent-local-unipile',COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE:'agent-local-unipile-v1',COMMUNICATIONS_ACTIVE_KEY_VERSION:'s1',COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:'s1',encryptionKey:key(1),digestKey:key(2)}]),COMMUNICATIONS_IDENTITY_KEY:key(3),COMMUNICATIONS_IDENTITY_KEY_VERSION:'i1',COMMUNICATIONS_SETUP_CALLBACK_KEY:key(4),COMMUNICATIONS_SCOPED_AUTH_KEY:key(5),COMMUNICATIONS_WEBHOOK_SECRET:'synthetic-webhook-secret',ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION:'a1',ACQUIRE_COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:'a1',encryptionKey:key(6),digestKey:key(7)}])};}
test('absent explicit private settings stays disabled and cannot inherit provider credentials and preserves existing native execution setting',()=>{
 const out=buildAgentCommunicationsEnvironment({...base,AGENT_NATIVE_EXECUTION_ENABLED:'true'});
 assert.equal(out.enabled,false);assert.equal(out.service,null);assert.equal(out.application.COMMUNICATIONS_RUNTIME_ENABLED,'false');assert.equal(out.application.UNIPILE_API_KEY,'');assert.equal(out.application.COMMUNICATIONS_FUTURE_SECRET,'');assert.equal(out.application.ACQUIRE_COMMUNICATIONS_KEYRING_JSON,'');assert.equal(out.application.AGENT_NATIVE_EXECUTION_ENABLED,'true');assert.equal(out.application.APP_URL,base.APP_URL);
});
test('connect-only builds fixed loopback service and zero-send application without mutating input',()=>{
 const privateSettings=settings(),original=structuredClone(privateSettings),out=buildAgentCommunicationsEnvironment(base,privateSettings);
 assert.equal(out.enabled,true);assert.equal(out.application.COMMUNICATIONS_SERVICE_URL,'http://127.0.0.1:5461');assert.equal(out.application.COMMUNICATIONS_RUNTIME_ENABLED,'true');assert.equal(out.application.AGENT_MODE_COMMUNICATIONS_MODE,'connect-only');
 for(const env of [out.application,out.service]){
  assert.equal(env.COMMUNICATIONS_DATABASE_URL,base.DATABASE_URL);assert.equal(env.COMMUNICATIONS_PORT,'5461');assert.equal(env.COMMUNICATIONS_LISTEN_HOST,'127.0.0.1');assert.equal(env.AGENT_NATIVE_EXECUTION_ENABLED,'false');
  for(const k of ['ACCOUNT_HOURLY','ACCOUNT_DAILY','APPLICATION_HOURLY','APPLICATION_DAILY'])assert.equal(env['COMMUNICATIONS_'+k+'_LIMIT'],'0');
  assert.equal(env.COMMUNICATIONS_SETUP_NOTIFY_URL,privateSettings.AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN+'/v1/setup/notify');assert.equal(env.COMMUNICATIONS_REDIRECT_ORIGIN,privateSettings.AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN);assert.equal(env.COMMUNICATIONS_SETUP_SUCCESS_PATH,'/setup/returned');assert.equal(env.COMMUNICATIONS_SETUP_FAILURE_PATH,'/setup/failed');
 }
 for(const k of ['APP_URL','NEXT_PUBLIC_APP_URL','DATABASE_URL','CAMPAIGN_N8N_ENABLED','RESEARCH_ENABLED','TARGET_DATA_PROVIDER','OPENAI_API_KEY'])assert.equal(out.application[k],base[k]);
 assert.equal(out.service.OPENAI_API_KEY,undefined);assert.equal(out.service.DATABASE_URL,base.DATABASE_URL);assert.deepEqual(privateSettings,original);assert.equal(base.UNIPILE_API_KEY,'must-not-inherit');
});
test('rejects unknown overrides including DB, app, native worker, provider, quota and callback overrides',()=>{
 for(const [k,v] of Object.entries({DATABASE_URL:'postgresql://production.invalid/main',APP_URL:'https://prod.invalid',AGENT_NATIVE_EXECUTION_ENABLED:'true',RESEARCH_ENABLED:'false',COMMUNICATIONS_RUNTIME_ENABLED:'true',COMMUNICATIONS_ACCOUNT_DAILY_LIMIT:'100',COMMUNICATIONS_SETUP_NOTIFY_URL:'https://other.invalid',UNIPILE_DSN:'inherit',COMMUNICATIONS_LISTEN_HOST:'0.0.0.0'}))assert.throws(()=>buildAgentCommunicationsEnvironment(base,{...settings(),[k]:v}),/configuration/);
});
test('requires explicit mode and canonical HTTPS public origin with no credentials/path/query or local address',()=>{
 for(const mode of [undefined,'','send','true'])assert.throws(()=>buildAgentCommunicationsEnvironment(base,{...settings(),AGENT_MODE_COMMUNICATIONS_MODE:mode}),/configuration/);
 for(const origin of ['http://public.example.invalid','https://public.example.invalid/','https://u:p@public.example.invalid','https://public.example.invalid/a','https://public.example.invalid?x=1','https://127.0.0.1','https://localhost','https://acquire-agent.orb.local','https://192.168.1.1','https://[::1]'])assert.throws(()=>buildAgentCommunicationsEnvironment(base,{...settings(),AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN:origin}),/configuration/);
});
test('requires explicit complete independent keys and supported HTTPS Unipile API URL; errors redact values',()=>{
 for(const k of ['UNIPILE_API_KEY','COMMUNICATIONS_IDENTITY_KEY','COMMUNICATIONS_APPLICATION_ID','ACQUIRE_COMMUNICATIONS_KEYRING_JSON']){const value=settings();delete value[k];assert.throws(()=>buildAgentCommunicationsEnvironment(base,value),/configuration/);}
 for(const url of ['http://api.example.invalid','https://api.example.invalid/other','https://u:p@api.example.invalid','https://api.example.invalid?token=secret'])assert.throws(()=>buildAgentCommunicationsEnvironment(base,{...settings(),UNIPILE_API_URL:url}),/configuration/);
 for(const v of [{COMMUNICATIONS_APPLICATION_ID:'other-application'},{COMMUNICATIONS_IDENTITY_KEY:'not-a-key'},{COMMUNICATIONS_IDENTITY_KEY:key(1)},{ACQUIRE_COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:'a1',encryptionKey:key(1),digestKey:key(7)}])},{COMMUNICATIONS_ACTIVE_KEY_VERSION:'missing'},{COMMUNICATIONS_KEYRING_JSON:JSON.stringify([{version:1,encryptionKey:key(1),digestKey:key(2)}])}])assert.throws(()=>buildAgentCommunicationsEnvironment(base,{...settings(),...v}),/configuration/);
 assert.throws(()=>buildAgentCommunicationsEnvironment(base,{...settings(),UNIPILE_API_KEY:' synthetic-secret '}),error=>!error.message.includes('synthetic-secret'));
});
test('rejects executable descriptors/proxies and non-string settings without evaluating accessors',()=>{
 let read=false;const value=settings();Object.defineProperty(value,'UNIPILE_API_KEY',{enumerable:true,get(){read=true;return 'hidden';}});assert.throws(()=>buildAgentCommunicationsEnvironment(base,value));assert.equal(read,false);
 assert.throws(()=>buildAgentCommunicationsEnvironment(base,new Proxy(settings(),{})));assert.throws(()=>buildAgentCommunicationsEnvironment(base,{...settings(),UNIPILE_API_KEY:123}));
});
function simulatorSettings(){return {...settings(),AGENT_MODE_COMMUNICATIONS_MODE:'simulator',AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN:'https://127.0.0.1:5491',UNIPILE_API_URL:'https://127.0.0.1:5490',COMMUNICATIONS_INTEGRATION_ID:'sim-agent-mode-local',COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE:'sim-agent-mode-local-v1',COMMUNICATIONS_GMAIL_SOURCE_ID:'must-not-transfer-live-owner'};}
test('simulator keeps retained keys but isolates provider identity, TLS, quotas and native startup',()=>{
 const input=simulatorSettings(),out=buildAgentCommunicationsEnvironment({...base,AGENT_NATIVE_EXECUTION_ENABLED:'true'},input);
 for(const env of [out.application,out.service]){
  assert.equal(env.AGENT_MODE_COMMUNICATIONS_MODE,'simulator');assert.equal(env.UNIPILE_API_URL,'https://127.0.0.1:5490');assert.equal(env.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN,env.UNIPILE_API_URL);assert.equal(env.COMMUNICATIONS_SERVICE_URL,'https://127.0.0.1:5491');assert.equal(env.COMMUNICATIONS_SETUP_NOTIFY_URL,'https://127.0.0.1:5491/v1/setup/notify');assert.equal(env.COMMUNICATIONS_REDIRECT_ORIGIN,'https://127.0.0.1:5491');assert.equal(env.AGENT_NATIVE_EXECUTION_ENABLED,'false');assert.equal(env.CAMPAIGN_REPLY_MONITOR_MODE,'enforce');assert.equal(env.NODE_EXTRA_CA_CERTS,'/workspace/.local-data/agent-mode-orbstack/simulator-tls/localhost.crt');
  for(const kind of ['ACCOUNT','APPLICATION']){assert.equal(env['COMMUNICATIONS_'+kind+'_HOURLY_LIMIT'],'100');assert.equal(env['COMMUNICATIONS_'+kind+'_DAILY_LIMIT'],'1000');}
  for(const name of ['COMMUNICATIONS_IDENTITY_KEY','COMMUNICATIONS_KEYRING_JSON','COMMUNICATIONS_SCOPED_AUTH_KEY','ACQUIRE_COMMUNICATIONS_KEYRING_JSON'])assert.equal(env[name],input[name]);
  for(const platform of ['GMAIL','OUTLOOK','WHATSAPP','LINKEDIN'])assert.equal(Object.hasOwn(env,'COMMUNICATIONS_'+platform+'_SOURCE_ID'),false);assert.equal(env.COMMUNICATIONS_DATABASE_URL,base.DATABASE_URL);
 }
 assert.equal(input.COMMUNICATIONS_GMAIL_SOURCE_ID,'must-not-transfer-live-owner');
});
test('simulator rejects wrong origin, provider, integration, production or application DB',()=>{
 for(const patch of [{AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN:'https://localhost:5491'},{UNIPILE_API_URL:'https://remote.example'},{UNIPILE_API_URL:'https://127.0.0.1:5499'},{COMMUNICATIONS_INTEGRATION_ID:'acquire-agent-mode-local'},{COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE:'acquire-agent-mode-local-v1'}])assert.throws(()=>buildAgentCommunicationsEnvironment(base,{...simulatorSettings(),...patch}));
 for(const patch of [{NODE_ENV:'production'},{DATABASE_URL:'postgresql://project_acquire:agent-local-only@postgres:5432/other'},{DATABASE_URL:'postgresql://project_acquire:agent-local-only@remote.example:5432/acquire_agent_mode'}])assert.throws(()=>buildAgentCommunicationsEnvironment({...base,...patch},simulatorSettings()));
});

test('connect-only clears previous simulator opt-in rather than inheriting an empty explicit marker',()=>{
 const out=buildAgentCommunicationsEnvironment({...base,COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:'https://127.0.0.1:5490'},settings());
 assert.equal(Object.hasOwn(out.application,'COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN'),false);assert.equal(Object.hasOwn(out.service,'COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN'),false);
});

test('separate25lead profile accepts only matching fixed provider/callback pair',()=>{
 const input={...simulatorSettings(),UNIPILE_API_URL:'https://127.0.0.1:5590',AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN:'https://127.0.0.1:5591'};
 const out=buildAgentCommunicationsEnvironment(base,input);
 assert.equal(out.application.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN,input.UNIPILE_API_URL);assert.equal(out.application.COMMUNICATIONS_SERVICE_URL,input.AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN);
 for(const patch of [{UNIPILE_API_URL:'https://127.0.0.1:5490'},{AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN:'https://127.0.0.1:5491'},{UNIPILE_API_URL:'https://127.0.0.1:5592'}])assert.throws(()=>buildAgentCommunicationsEnvironment(base,{...input,...patch}));
});
test('50lead service uses only matching fixed5690/5691 pair and keeps safety quotas',()=>{
 const input={...simulatorSettings(),UNIPILE_API_URL:'https://127.0.0.1:5690',AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN:'https://127.0.0.1:5691'};
 const out=buildAgentCommunicationsEnvironment(base,input);
 assert.equal(out.application.COMMUNICATIONS_SERVICE_URL,input.AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN);
 assert.equal(out.service.COMMUNICATIONS_ACCOUNT_HOURLY_LIMIT,'100');assert.equal(out.service.COMMUNICATIONS_APPLICATION_HOURLY_LIMIT,'100');
 for(const patch of [{UNIPILE_API_URL:'https://127.0.0.1:5590'},{AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN:'https://127.0.0.1:5591'}])assert.throws(()=>buildAgentCommunicationsEnvironment(base,{...input,...patch}));
});
test('multichannel profile accepts5790/5791 only as a matching pair and preserves quotas',()=>{
 const input={...simulatorSettings(),UNIPILE_API_URL:'https://127.0.0.1:5790',AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN:'https://127.0.0.1:5791'};const out=buildAgentCommunicationsEnvironment(base,input);assert.equal(out.application.COMMUNICATIONS_SERVICE_URL,input.AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN);assert.equal(out.service.COMMUNICATIONS_ACCOUNT_HOURLY_LIMIT,'100');for(const patch of [{UNIPILE_API_URL:'https://127.0.0.1:5690'},{AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN:'https://127.0.0.1:5691'}])assert.throws(()=>buildAgentCommunicationsEnvironment(base,{...input,...patch}));
});
test('propagates explicit validated local simulation marker to the independent service without native execution',()=>{const input={...simulatorSettings(),UNIPILE_API_URL:'https://127.0.0.1:5790',AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN:'https://127.0.0.1:5791',COMMUNICATIONS_INTEGRATION_ID:'sim-agent-multichannel-20261017',COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE:'sim-agent-multichannel-20261017-v1'};const out=buildAgentCommunicationsEnvironment({...base,NODE_ENV:'development',AGENT_LOCAL_SIMULATION_ENABLED:'true'},input);for(const env of[out.application,out.service])assert.equal(env.AGENT_LOCAL_SIMULATION_ENABLED,'true');assert.equal(out.service.AGENT_NATIVE_EXECUTION_ENABLED,'false');assert.equal(out.service.COMMUNICATIONS_DATABASE_URL,base.DATABASE_URL);});
test('never transfers a simulator marker into connect-only/disabled service or accepts invalid local flags',()=>{const real=buildAgentCommunicationsEnvironment({...base,NODE_ENV:'production',AGENT_LOCAL_SIMULATION_ENABLED:'true'},settings());assert.equal(real.application.AGENT_LOCAL_SIMULATION_ENABLED,'false');assert.equal(real.service.AGENT_LOCAL_SIMULATION_ENABLED,'false');const disabled=buildAgentCommunicationsEnvironment({...base,AGENT_LOCAL_SIMULATION_ENABLED:'true'});assert.equal(disabled.application.AGENT_LOCAL_SIMULATION_ENABLED,'false');const unselected=buildAgentCommunicationsEnvironment({...base,NODE_ENV:'development'},simulatorSettings());assert.equal(unselected.service.AGENT_LOCAL_SIMULATION_ENABLED,'false');for(const patch of[{AGENT_LOCAL_SIMULATION_ENABLED:'TRUE'},{NODE_ENV:'production',AGENT_LOCAL_SIMULATION_ENABLED:'true'},{DATABASE_URL:'postgresql://project_acquire:agent-local-only@remote:5432/acquire_agent_mode',AGENT_LOCAL_SIMULATION_ENABLED:'true'}])assert.throws(()=>buildAgentCommunicationsEnvironment({...base,NODE_ENV:'development',...patch},simulatorSettings()));});
