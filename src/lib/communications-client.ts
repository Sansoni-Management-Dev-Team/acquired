import 'server-only';
import {readHostedDemoCommunicationsDescriptor} from './hosted-demo-communications-environment';
import {withCampaignDb,type CampaignActor} from '@/db/campaign-client';
import {CommunicationsClient} from '../../communications/packages/sdk/src';
import {createScopedServiceAuth} from '../../communications/packages/core/src/scoped-service-auth';
import {resolveOwnedCommunicationsLane,type CommunicationsLane} from './communications-routing';
import {readDemoCommunicationsEnvironment} from './communications-demo-environment';
import {readTestingCommunicationsEnvironment} from './communications-testing-environment';
import type {ConnectionBinding} from '../../communications/packages/contracts/src';
/** Explicit setup lane is supplied only by a trusted server command which has
 * loaded mandate intent. Every existing binding independently resolves its DB lane. */
export async function actorCommunicationsClient(actor:CampaignActor,options:{setupLane?:CommunicationsLane}={}):Promise<CommunicationsClient>{
 if(options.setupLane!==undefined&&!['primary','demo','testing','hosted'].includes(options.setupLane))throw Error('Unknown communications setup lane');
 if(process.env.COMMUNICATIONS_RUNTIME_ENABLED!=='true')throw Error('Communications runtime unavailable');
 await withCampaignDb(actor,async()=>undefined);
 function construct(lane:CommunicationsLane){
  try{
   if(lane==='hosted'){const descriptor=readHostedDemoCommunicationsDescriptor(process.env,actor),encoded=process.env.AGENT_HOSTED_DEMO_SERVICE_AUTH_KEY??'';if(!/^(?:[A-Za-z0-9_-]{43}|[a-f0-9]{64})$/.test(encoded))throw Error();const key=Buffer.from(encoded,encoded.length===64?'hex':'base64url');if(key.length!==32)throw Error();const signer=createScopedServiceAuth({key,audience:'communications',applicationId:'acquire',authorize:async()=>false});return new CommunicationsClient({baseUrl:descriptor.serviceOrigin,contractVersion:'1',apiKey:signer.issue(descriptor.actor),allowLoopbackHttp:false,timeoutMs:28000,hostedDemo:{capability:'hosted-demo',origin:descriptor.setupOrigin}});}
   const env=lane==='testing'?readTestingCommunicationsEnvironment(process.env,actor):lane==='demo'?readDemoCommunicationsEnvironment(process.env):process.env;
   const encoded=env.COMMUNICATIONS_SCOPED_AUTH_KEY||'';if(!/^[A-Za-z0-9+/]{43}=$/.test(encoded))throw Error();const key=Buffer.from(encoded,'base64');if(key.length!==32||key.toString('base64')!==encoded)throw Error();
   const applicationId=env.COMMUNICATIONS_APPLICATION_ID||'acquire';const signer=createScopedServiceAuth({key,audience:'communications',applicationId,authorize:async()=>false});
   return new CommunicationsClient({baseUrl:env.COMMUNICATIONS_SERVICE_URL||'',contractVersion:'1',apiKey:signer.issue({applicationId,tenantId:actor.organizationId,ownerId:actor.userId}),allowLoopbackHttp:process.env.NODE_ENV!=='production',timeoutMs:28000,...(env.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN?{localSimulatorOrigin:env.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN}:{})});
  }catch{throw Error('Communications runtime unavailable');}
 }
 const initial=options.setupLane??'primary',client=construct(initial);
 // SDK remains unchanged. This trusted application facade selects endpoints
 // from original saved bindings, including historical lookup/retirement.
 const direct=new Set(['connectionStatus','disconnectConnection','setDefaultConnection','ready','inspectRelationship']);
 const snapshot=new Set(['submit','lookup','lookupDetails']);
 return new Proxy(client,{get(target,key){
  if(typeof key==='string'&&(direct.has(key)||snapshot.has(key)||key==='setupConnection'))return async(...args:unknown[])=>{
   const binding=direct.has(key)?args[0]:snapshot.has(key)?(args[0]as{snapshot?:{binding?:unknown}})?.snapshot?.binding:(args[1]as{reconnectBinding?:unknown})?.reconnectBinding;
   if(!binding&&key!=='setupConnection')throw Error('Recorded communications binding required');
   const lane=binding?await resolveOwnedCommunicationsLane(actor,binding as ConnectionBinding):initial;
   const selected=construct(lane),method=Reflect.get(selected,key);return Reflect.apply(method,selected,args);
  };
  const value=Reflect.get(target,key,target);if(typeof value==='function'&&typeof key==='string'&&!['connections','health','constructor'].includes(key))throw Error('Unsupported routed communications method');return typeof value==='function'?value.bind(target):value;
 }});
}
