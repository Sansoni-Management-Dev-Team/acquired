import {types} from 'node:util';
import {isIP} from 'node:net';
import {agentDatabaseConfig} from './agent-mode-local-database.mjs';
const required=[
 'UNIPILE_API_URL','UNIPILE_API_KEY','COMMUNICATIONS_APPLICATION_ID','COMMUNICATIONS_INTEGRATION_ID','COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE',
 'COMMUNICATIONS_ACTIVE_KEY_VERSION','COMMUNICATIONS_KEYRING_JSON','COMMUNICATIONS_IDENTITY_KEY','COMMUNICATIONS_IDENTITY_KEY_VERSION',
 'COMMUNICATIONS_SETUP_CALLBACK_KEY','COMMUNICATIONS_SCOPED_AUTH_KEY','COMMUNICATIONS_WEBHOOK_SECRET',
 'ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION','ACQUIRE_COMMUNICATIONS_KEYRING_JSON',
];
const optional=['COMMUNICATIONS_SUBSCRIBER_ID',...['GMAIL','OUTLOOK','LINKEDIN','WHATSAPP'].map(p=>'COMMUNICATIONS_'+p+'_SOURCE_ID')];
const controls=['AGENT_MODE_COMMUNICATIONS_MODE','AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN'];
const allow=new Set([...required,...optional,...controls]);
const quotas=Object.fromEntries(['ACCOUNT_HOURLY','ACCOUNT_DAILY','APPLICATION_HOURLY','APPLICATION_DAILY'].map(k=>['COMMUNICATIONS_'+k+'_LIMIT','0']));
const protectedPattern=/^(?:NEXT_PUBLIC_)?(?:COMMUNICATIONS_|ACQUIRE_COMMUNICATIONS_|UNIPILE_)/;
function record(value){
 if(!value||types.isProxy(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error();
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(descriptors).some(k=>typeof k!=='string'||!('value' in descriptors[k])||typeof descriptors[k].value!=='string'))throw Error();
 return Object.fromEntries(Object.entries(descriptors).map(([k,d])=>[k,d.value]));
}
function version(value){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))throw Error();}
function bytes(value){if(typeof value!=='string'||! /^[A-Za-z0-9+/]{43}=$/.test(value)||Buffer.from(value,'base64').toString('base64')!==value)throw Error();return value;}
function ring(text,active){
 version(active);const rows=JSON.parse(text);if(!Array.isArray(rows)||rows.length<1||rows.length>32)throw Error();
 const versions=new Set(),keys=[];
 for(const row of rows){if(!row||Array.isArray(row)||Object.keys(row).sort().join(',')!=='digestKey,encryptionKey,version')throw Error();version(row.version);if(versions.has(row.version))throw Error();versions.add(row.version);keys.push(bytes(row.encryptionKey),bytes(row.digestKey));}
 if(!versions.has(active))throw Error();return keys;
}
/** Pure local-only builder. Callers supply a PRIVATE local settings snapshot;
 * never pass a main-worktree env file or process.env as privateSettings.
 * Keys are generated/persisted by the caller, never recreated during startup. */
export function buildAgentCommunicationsEnvironment(baseRuntime,privateSettings={}){
 try{
  const base=record(baseRuntime),input=record(privateSettings);
  if(Object.keys(input).some(k=>!allow.has(k)))throw Error();
  const blank=new Set([...required,...optional,'COMMUNICATIONS_DATABASE_URL','COMMUNICATIONS_SERVICE_URL','COMMUNICATIONS_SERVICE_SECRET','COMMUNICATIONS_REDIRECT_ORIGIN','COMMUNICATIONS_SETUP_NOTIFY_URL','UNIPILE_DSN','UNIPILE_BASE_URL','UNIPILE_API_VERSION',...Object.keys(base).filter(k=>protectedPattern.test(k))]);
  const application={...base,...Object.fromEntries([...blank].map(k=>[k,''])),...quotas,COMMUNICATIONS_RUNTIME_ENABLED:'false',AGENT_LOCAL_SIMULATION_ENABLED:'false'};
  if(!Object.keys(input).length)return {enabled:false,application,service:null};
  const simulator=input.AGENT_MODE_COMMUNICATIONS_MODE==='simulator';
  if(base.AGENT_LOCAL_SIMULATION_ENABLED!==undefined&&!['true','false'].includes(base.AGENT_LOCAL_SIMULATION_ENABLED))throw Error();
  if(simulator&&base.AGENT_LOCAL_SIMULATION_ENABLED==='true'&&base.NODE_ENV!=='development')throw Error();
  if(!['connect-only','simulator'].includes(input.AGENT_MODE_COMMUNICATIONS_MODE)||input.COMMUNICATIONS_APPLICATION_ID!=='acquire')throw Error();
  if(simulator){
   if(base.NODE_ENV==='production')throw Error();
   const db=new URL(base.DATABASE_URL),exactTarget=db.hostname==='postgres'&&db.port==='5432'||db.hostname==='127.0.0.1'&&db.port==='5437';
   if(!['postgres:','postgresql:'].includes(db.protocol)||!exactTarget||db.pathname!=='/acquire_agent_mode'||db.search||db.hash)throw Error();
  }
  for(const name of [...required,...controls,...Object.keys(input)]){const value=input[name];if(typeof value!=='string'||!value.length||value.length>131072||value!==value.trim()||/[\r\n\0]/.test(value))throw Error();}
  const origin=input.AGENT_MODE_COMMUNICATIONS_PUBLIC_ORIGIN,url=new URL(origin),host=url.hostname;
  if(simulator){if(!['https://127.0.0.1:5491','https://127.0.0.1:5591','https://127.0.0.1:5691','https://127.0.0.1:5791'].includes(origin))throw Error();}
  else if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password||isIP(host)||host.startsWith('[')||!host.includes('.')||/\.(local|localhost|internal|invalid|test)$/.test(host)||host.endsWith('.'))throw Error();
  const api=new URL(input.UNIPILE_API_URL);if(api.protocol!=='https:'||api.username||api.password||api.search||api.hash||!['/','/api/v1','/api/v1/'].includes(api.pathname))throw Error();
  if(simulator&&((api.origin==='https://127.0.0.1:5490'?'https://127.0.0.1:5491':api.origin==='https://127.0.0.1:5590'?'https://127.0.0.1:5591':api.origin==='https://127.0.0.1:5690'?'https://127.0.0.1:5691':api.origin==='https://127.0.0.1:5790'?'https://127.0.0.1:5791':null)!==origin||!input.COMMUNICATIONS_INTEGRATION_ID.startsWith('sim-')||!input.COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE.startsWith('sim-')))throw Error();
  const materials=[bytes(input.COMMUNICATIONS_IDENTITY_KEY),bytes(input.COMMUNICATIONS_SETUP_CALLBACK_KEY),bytes(input.COMMUNICATIONS_SCOPED_AUTH_KEY),...ring(input.COMMUNICATIONS_KEYRING_JSON,input.COMMUNICATIONS_ACTIVE_KEY_VERSION),...ring(input.ACQUIRE_COMMUNICATIONS_KEYRING_JSON,input.ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION)];
  if(new Set(materials).size!==materials.length)throw Error();version(input.COMMUNICATIONS_IDENTITY_KEY_VERSION);
  if(input.COMMUNICATIONS_WEBHOOK_SECRET.length<16||input.COMMUNICATIONS_WEBHOOK_SECRET.length>4096)throw Error();
  for(const name of ['COMMUNICATIONS_APPLICATION_ID','COMMUNICATIONS_INTEGRATION_ID','COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE',...optional])if(input[name]?.length>2000)throw Error();
  const config={...Object.fromEntries([...required,...optional].filter(k=>input[k]!==undefined&&!(simulator&&k.endsWith('_SOURCE_ID'))).map(k=>[k,input[k]])),...quotas,
   AGENT_MODE_COMMUNICATIONS_MODE:'connect-only',COMMUNICATIONS_RUNTIME_ENABLED:'true',COMMUNICATIONS_DATABASE_URL:agentDatabaseConfig('container').url,
   COMMUNICATIONS_SERVICE_URL:'http://127.0.0.1:5461',COMMUNICATIONS_PORT:'5461',COMMUNICATIONS_LISTEN_HOST:'127.0.0.1',
   COMMUNICATIONS_REDIRECT_ORIGIN:origin,COMMUNICATIONS_SETUP_NOTIFY_URL:origin+'/v1/setup/notify',
   COMMUNICATIONS_SETUP_SUCCESS_PATH:'/setup/returned',COMMUNICATIONS_SETUP_FAILURE_PATH:'/setup/failed',AGENT_NATIVE_EXECUTION_ENABLED:'false',AGENT_LOCAL_SIMULATION_ENABLED:simulator&&base.AGENT_LOCAL_SIMULATION_ENABLED==='true'?'true':'false'};
  if(simulator)Object.assign(config,{AGENT_MODE_COMMUNICATIONS_MODE:'simulator',COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN:api.origin,COMMUNICATIONS_SERVICE_URL:origin,NODE_EXTRA_CA_CERTS:'/workspace/.local-data/agent-mode-orbstack/simulator-tls/localhost.crt',CAMPAIGN_REPLY_MONITOR_MODE:'enforce',...Object.fromEntries(['ACCOUNT','APPLICATION'].flatMap(kind=>[['COMMUNICATIONS_'+kind+'_HOURLY_LIMIT','100'],['COMMUNICATIONS_'+kind+'_DAILY_LIMIT','1000']]))});
  const configuredApplication={...application,...config};
  // Absence, rather than empty optional identities, is required by the runtime parser.
  if(simulator)for(const name of optional.filter(k=>k.endsWith('_SOURCE_ID')))delete configuredApplication[name];
  else delete configuredApplication.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN;
  return {enabled:true,application:configuredApplication,service:{...config,NODE_ENV:'development',LOCAL_DEVELOPMENT:'true',DATABASE_DRIVER:'postgres',DATABASE_URL:agentDatabaseConfig('container').url,DATABASE_SSL_CA:''}};
 }catch{throw new Error('Invalid local agent communications configuration');}
}
