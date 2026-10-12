// Native characterization: a mocking library can observe rejected promises itself and hide leaks.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const {createOutboxDeliveryWorker}=require(resolve(process.argv[2]??'communications/dist/packages/core/src/outbox-delivery.js'));
const binding={applicationId:'fixture-app',tenantId:'fixture-tenant',ownerId:'fixture-owner',connectionId:'fixture-connection',accountId:'fixture-account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'};
const scope=[binding.applicationId,binding.tenantId,binding.ownerId,binding.connectionId,binding.accountId,binding.generation,binding.channel,binding.platform,binding.backend];
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const event={type:'message',reference:{binding,id:'fixture-message'},direction:'inbound',sender:{kind:'phone',value:'+15550000001'},occurredAt:'2026-10-12T10:00:00.000Z'};
const eventKey=hash(['communications.reply.event.v1',scope,null,event.reference.id]);
const fingerprint=hash(['communications.reply.content.v1',scope,event.reference.id,null,event.direction,event.sender.kind,event.sender.value,event.occurredAt]);
const delivery={binding,subscriberId:'fixture-subscriber',eventId:'1',sourceNamespace:'reply_message/v1',sourceEventKey:eventKey,payload:{outcome:{kind:'event',event,eventKey,fingerprint},fingerprint,receivedAt:'2026-10-12T10:01:00.000Z'},token:'fixture-token'};
let unhandled=false,acknowledged=false,applied=false;
process.on('unhandledRejection',()=>{unhandled=true;});
const worker=createOutboxDeliveryWorker({binding,subscriberId:'fixture-subscriber',timeoutMs:10,outbox:{async claim(){return {kind:'claimed',delivery};},async acknowledge(){acknowledged=true;return {status:'acknowledged'};}},apply(){
  applied=true;const end=performance.now()+25;while(performance.now()<end){}
  return Promise.reject(Error('synthetic late application failure'));
}});
assert.deepEqual(await worker.run(),{status:'retry'});
await new Promise(resolve=>setTimeout(resolve,10));
assert.equal(applied,true);assert.equal(acknowledged,false);assert.equal(unhandled,false,'An application rejection after a synchronous overrun must be observed');
process.stdout.write('Native deadline overrun handled: no late ACK or unhandled rejection.\n');
