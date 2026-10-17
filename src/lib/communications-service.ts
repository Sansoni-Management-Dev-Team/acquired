import 'server-only';
import {assertSameBinding,type ConnectionBinding,type Coverage} from '../../communications/packages/contracts/src';
import type {configureAcquireCommunications} from './communications-configuration';
import {createCommunicationsService} from '../../communications/services/api/src/service';
/** This trusted host can be deployed separately; startup checks storage and never creates it. */
export async function createAcquireCommunicationsService(configured:ReturnType<typeof configureAcquireCommunications>){
 if(!await configured.unipile.store.preflight())throw Error('Communications storage is not ready');
 const host=configured.host,unipile=configured.unipile,webhooks=host.createWebhooks();
 const historyCooldown=new Map<string,number>();
 const key=(b:ConnectionBinding)=>JSON.stringify([b.applicationId,b.tenantId,b.ownerId,b.connectionId,b.generation,b.accountId,b.channel,b.platform,b.backend]);
 const listener=createCommunicationsService({api:host.serverDependencies,setup:unipile,webhook:webhooks.ingress}),server=listener.server;let running=false;
 return {server,async tick(){
  if(running)return;running=true;
  try{
   const authorized=[];for(const scope of await host.currentSubjects()){if(await host.renewScope(scope))authorized.push(scope);}
   for(const scope of authorized){try{await host.drainRetainedOutbound(scope,1);}catch{/* Original untracked callback stays blocked on failed proof. */}}
   for(let i=0;i<20;i++){const result=await webhooks.runOne();if(result.status!=='processed')break;}
   // Retained immutable event generations may belong to another integration
   // or a retired account. Drain only authenticated existing outbox work; this
   // path never constructs provider adapters, refreshes history or sends.
   let retainedBound=20;const retained=new Set<string>();
   for(const scope of authorized){if(retainedBound<=0)break;
    try{for(const binding of await host.pendingReplyBindings(scope,Math.min(10,retainedBound))){
     if(retainedBound<=0)break;retainedBound--;
     try{await host.recordPendingReplyBinding(binding);await host.consumePending(binding,20);retained.add(key(binding));}catch{/* Keep original outbox/barriers pending on any authority or receipt failure. */}
    }}catch{/* Revoked or unavailable original scope cannot be consumed. */}
   }
   let attemptedRefresh=false;
   for(const scope of authorized)for(const connection of await unipile.store.list(scope)){
    if(!connection.active)continue;
    const binding=connection.binding,identity=key(binding),now=Date.now();
    // Refresh service-owned history even before a mailbox is selected as an
    // application default. The source persists checkpoints/events atomically;
    // app consumption remains a separate guarded step and may have no binding.
    if(!attemptedRefresh&&binding.channel==='email'&&connection.status==='connected'&&(historyCooldown.get(identity)??0)<=now){
     try{
      const source=await host.history(binding),query={binding,scope:'account',since:new Date(now-300000).toISOString(),cursor:null,refresh:true};
      const proof:Coverage|null=await source.repository.coverage(query);
      if(proof)assertSameBinding(binding,proof.binding);
      const fresh=proof?.scope==='account'&&proof.complete&&proof.initialSyncComplete&&!proof.invalidated&&Date.parse(proof.from)<=Date.parse(query.since)&&Date.parse(proof.through)>=now-300000&&Date.parse(proof.through)<=now&&Date.parse(proof.observedAt)>=now-300000&&Date.parse(proof.observedAt)<=now;
      if(!fresh){attemptedRefresh=true;historyCooldown.set(identity,now+60000);await source.refresh(query,{signal:AbortSignal.timeout(25000)});}
     }catch{historyCooldown.set(identity,now+60000);/* Retain failed/pending history for a later bounded retry. */}
     // Bound process-local retry bookkeeping. Durable source leases remain the
     // duplicate barrier across restarts and other worker processes.
     for(const [saved,until] of historyCooldown)if(until<=now)historyCooldown.delete(saved);
     while(historyCooldown.size>1000)historyCooldown.delete(historyCooldown.keys().next().value!);
    }
    try{if(!retained.has(identity))await host.consumePending(binding,20);}catch{/* No local work binding yet: retain original service outbox without ACK. */}
   }
  }finally{running=false;}
 },close:listener.close};
}
