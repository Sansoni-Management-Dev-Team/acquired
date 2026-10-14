import 'server-only';
import type {configureAcquireCommunications} from './communications-configuration';
import {createCommunicationsService} from '../../communications/services/api/src/service';
/** This trusted host can be deployed separately; startup checks storage and never creates it. */
export async function createAcquireCommunicationsService(configured:ReturnType<typeof configureAcquireCommunications>){
 if(!await configured.unipile.store.preflight())throw Error('Communications storage is not ready');
 const host=configured.host,unipile=configured.unipile,webhooks=host.createWebhooks();
 const listener=createCommunicationsService({api:host.serverDependencies,setup:unipile,webhook:webhooks.ingress}),server=listener.server;let running=false;
 return {server,async tick(){
  if(running)return;running=true;
  try{
   const authorized=[];for(const scope of await host.currentSubjects()){if(await host.renewScope(scope))authorized.push(scope);}
   for(let i=0;i<20;i++){const result=await webhooks.runOne();if(result.status!=='processed')break;}
   for(const scope of authorized)for(const connection of await unipile.store.list(scope)){if(!connection.active)continue;try{await host.consumePending(connection.binding,20);}catch{/* No local work binding yet: retain original service outbox without ACK. */}}
  }finally{running=false;}
 },close:listener.close};
}
