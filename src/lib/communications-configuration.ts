import type {DispatchDiagnosticPort} from '../../communications/packages/core/src/dispatch-diagnostic';
import type {LocalSyncEventsOptions} from '../../communications/packages/core/src/local-sync-event';
import {captureCommunicationsSubject} from './communications-subject';
import type {AccessScope} from '../../communications/packages/contracts/src';
import {businessNow,type BusinessClock} from '../../communications/packages/core/src/business-clock';
import 'server-only';
import {readDemoCommunicationsEnvironment} from './communications-demo-environment';
import {readTestingCommunicationsEnvironment} from './communications-testing-environment';
import {resolveOwnedCommunicationsLane} from './communications-routing';
import type {CampaignActor} from '@/db/campaign-client';
import type {ConnectionBinding} from '../../communications/packages/contracts/src';
import {localSimulatorTestPolicy} from './agent-simulator-test-policy';
import {Pool} from 'pg';
import {JournalCodec} from '../../communications/packages/core/src/journal-codec';
import {readConfiguredUnipileV1Environment} from '../../communications/packages/adapter-unipile/src/v1-runtime-env';
import {createConfiguredUnipileV1Runtime,type ConfiguredUnipileV1Runtime} from '../../communications/packages/adapter-unipile/src/v1-runtime';
import {campaignSqlPool} from '@/db/campaign-client';
import type {SqlPool} from '../../communications/packages/storage-postgres/src/webhook-repository';
import {createAcquireCommunicationsRuntime} from './communications-runtime';
export function readAcquireCommunicationsKeys(env:Record<string,string|undefined>,reserved:readonly Uint8Array[]):JournalCodec{
 try{
  const activeVersion=env.ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION,raw=JSON.parse(env.ACQUIRE_COMMUNICATIONS_KEYRING_JSON||'null');
  if(typeof activeVersion!=='string'||!Array.isArray(raw)||raw.length<1||raw.length>32)throw Error();
  const forbidden=new Set(reserved.map(k=>Buffer.from(k).toString('base64')));
  const material=(v:unknown)=>{if(typeof v!=='string'||! /^[A-Za-z0-9+/]{43}=$/.test(v))throw Error();const b=Buffer.from(v,'base64');if(b.length!==32||b.toString('base64')!==v||forbidden.has(v))throw Error();return b;};
  const keys=raw.map(r=>{if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join(',')!=='digestKey,encryptionKey,version')throw Error();return {version:r.version,encryptionKey:material(r.encryptionKey),digestKey:material(r.digestKey)};});
  return new JournalCodec({activeVersion,keys});
 }catch{throw Error('Application communications keys unavailable');}
}
export function configureAcquireCommunications(env:Record<string,string|undefined>,pools:{application:SqlPool;service:SqlPool},localRuntime?:{businessClock?:BusinessClock;scope?:AccessScope;localSyncEvents?:LocalSyncEventsOptions;diagnostic?:DispatchDiagnosticPort}){
 const simulatorTestPolicy=localSimulatorTestPolicy(env);
 const configured=readConfiguredUnipileV1Environment(env,pools.service);
 if(localRuntime?.diagnostic!==undefined&&typeof localRuntime.diagnostic!=='function')throw Error('Local dispatch diagnostic unavailable');
 if(localRuntime){if(!configured.options.localSimulatorOrigin||env.NODE_ENV==='production')throw Error('Local business clock requires simulator mode');if(localRuntime.businessClock!==undefined){businessNow(localRuntime.businessClock);configured.options.businessClock=localRuntime.businessClock;}if(localRuntime.localSyncEvents)configured.options.localSyncEvents=localRuntime.localSyncEvents;}
 const reserved=[configured.scopedAuthKey,configured.options.callbackKey,configured.options.vault.identityKey,...configured.options.vault.keys.flatMap(k=>[k.encryptionKey,k.digestKey])];
 if(localRuntime?.localSyncEvents){const signing=Buffer.from(localRuntime.localSyncEvents.signingKey);if(reserved.some(k=>signing.equals(Buffer.from(k))))throw Error('Distinct local sync signing key required');reserved.push(signing);}
 const applicationCodec=readAcquireCommunicationsKeys(env,reserved);
 const limit=(name:string)=>{const raw=env[name]??'0';if(!/^(0|[1-9]\d{0,9})$/.test(raw)||Number(raw)>2147483647)throw Error('Communications quota configuration unavailable');return Number(raw);};
 const unipile:ConfiguredUnipileV1Runtime=createConfiguredUnipileV1Runtime({...configured.options,async historyCapabilities(binding){
  // Construction resolves only the original encrypted account/current grant.
  // Coverage and peer history are still verified separately before dispatch.
  const source=await host.history(binding);
  return {read:typeof source.readAgentConversation==='function',history:typeof source.repository.withCoverage==='function'};
 },async readiness(binding){
  try{
  const stored=await unipile.store.resolve(binding);if(!stored||!stored.active||stored.status!=='connected')return {status:'review',code:'reconnect'};
  const proof=await (await host.history(binding)).repository.coverage({binding,scope:'account',since:new Date(businessNow(configured.options.businessClock)-300000).toISOString(),cursor:null,refresh:true});
  return proof?.complete&&proof.initialSyncComplete&&!proof.invalidated?{status:'ready'}:{status:'waiting',code:'incomplete'};
  }catch{return {status:'waiting',code:'unavailable'};}
 }});
 const host:ReturnType<typeof createAcquireCommunicationsRuntime>=createAcquireCommunicationsRuntime({...(localRuntime?.diagnostic?{diagnostic:localRuntime.diagnostic}:simulatorTestPolicy?{diagnostic:event=>console.warn(JSON.stringify({component:'local-simulator-dispatch-diagnostic',...event}))}:{}),unipile,serviceOptions:configured.options,applicationPool:pools.application,applicationCodec,scopedAuthKey:configured.scopedAuthKey,subscriberId:env.COMMUNICATIONS_SUBSCRIBER_ID||'acquire-replies',quota:{account:{hour:limit('COMMUNICATIONS_ACCOUNT_HOURLY_LIMIT'),day:limit('COMMUNICATIONS_ACCOUNT_DAILY_LIMIT'),rollingDay:limit('COMMUNICATIONS_ACCOUNT_DAILY_LIMIT'),minimumSpacingSeconds:simulatorTestPolicy?1:60},application:{hour:limit('COMMUNICATIONS_APPLICATION_HOURLY_LIMIT'),day:limit('COMMUNICATIONS_APPLICATION_DAILY_LIMIT')}}});
 return {host,unipile,options:configured.options,applicationCodec,...(localRuntime?.scope?{businessScope:captureCommunicationsSubject(localRuntime.scope)}:{})};
}
let singleton:ReturnType<typeof configureAcquireCommunications>|undefined;
/** Explicitly enabled on the trusted server. Construction never runs SQL or migrations. */
export function configuredAcquireCommunications(){
 if(process.env.COMMUNICATIONS_RUNTIME_ENABLED!=='true')throw Error('Communications runtime unavailable');
 if(singleton)return singleton;const dsn=process.env.COMMUNICATIONS_DATABASE_URL;
 if(!dsn)throw Error('Communications database unavailable');
 const pool=new Pool({connectionString:dsn,max:5,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
 const service:SqlPool={async connect(){const c=await pool.connect();return {query:async<Row>(sql:string,values?:unknown[])=>await c.query(sql,values) as unknown as import('../../communications/packages/storage-postgres/src/webhook-repository').SqlResult<Row>,release(error){c.release(error);}};}};
 try{singleton=configureAcquireCommunications({...process.env},{application:campaignSqlPool(),service});return singleton;}catch{void pool.end();throw Error('Communications runtime unavailable');}
}

let demoSingleton:ReturnType<typeof configureAcquireCommunications>|undefined;
function configuredDemoCommunications(){
 const env=readDemoCommunicationsEnvironment(process.env);
 // Both instances read retained durable events. Shared version names must mean
 // identical keys; scoped request and webhook secrets remain lane-specific.
 for(const key of ['COMMUNICATIONS_ACTIVE_KEY_VERSION','COMMUNICATIONS_KEYRING_JSON','COMMUNICATIONS_IDENTITY_KEY','COMMUNICATIONS_IDENTITY_KEY_VERSION','ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION','ACQUIRE_COMMUNICATIONS_KEYRING_JSON'])if(!env[key]||env[key]!==process.env[key])throw Error('Demo durable communications keys differ');
 const primary=configuredAcquireCommunications();
 if(env.COMMUNICATIONS_DATABASE_URL!==process.env.COMMUNICATIONS_DATABASE_URL)throw Error('Demo communications database differs');
 if(demoSingleton)return demoSingleton;
 demoSingleton=configureAcquireCommunications(env,{application:campaignSqlPool(),service:primary.options.pool});return demoSingleton;
}
let testingSingleton:ReturnType<typeof configureAcquireCommunications>|undefined;
function configuredTestingCommunications(actor:CampaignActor){
 const env=readTestingCommunicationsEnvironment(process.env,actor);
 // Retained journals share durable key versions and the same marked database.
 // A separate service endpoint is never permission to reinterpret old bytes.
 for(const key of ['COMMUNICATIONS_ACTIVE_KEY_VERSION','COMMUNICATIONS_KEYRING_JSON','COMMUNICATIONS_IDENTITY_KEY','COMMUNICATIONS_IDENTITY_KEY_VERSION','ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION','ACQUIRE_COMMUNICATIONS_KEYRING_JSON'])if(!env[key]||env[key]!==process.env[key])throw Error('Testing durable communications keys differ');
 if(env.COMMUNICATIONS_DATABASE_URL!==process.env.COMMUNICATIONS_DATABASE_URL)throw Error('Testing communications database differs');
 if(testingSingleton){if(testingSingleton.options.providerConfigurationReference!==env.COMMUNICATIONS_PROVIDER_CONFIGURATION_REFERENCE)throw Error('Testing communications runtime changed');return testingSingleton;}
 const primary=configuredAcquireCommunications();
 testingSingleton=configureAcquireCommunications(env,{application:campaignSqlPool(),service:primary.options.pool});return testingSingleton;
}
export async function configuredAcquireCommunicationsForBinding(actor:CampaignActor,binding:ConnectionBinding){
 // Disabling a lane makes its original bindings unavailable; it never redirects
 // their history, receipts or effects through the primary provider profile.
 const lane=await resolveOwnedCommunicationsLane(actor,binding);
 if(lane==='hosted')throw Error('Hosted bindings require the provider-free application facade');
 return lane==='testing'?configuredTestingCommunications(actor):lane==='demo'?configuredDemoCommunications():configuredAcquireCommunications();
}
