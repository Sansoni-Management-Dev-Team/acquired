// Synthetic in-container integration. Required storage ports are memory fixtures, not PostgreSQL.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {createReplyWebhookIngress,createReplyProcessor,createReplyWebhookServer,normalizeV1ReplyEvent,verifyUnipileV1Webhook}=require('/fixture/src/index.js');
const now=Date.now(),at=new Date(now-1000).toISOString(),received=new Date(now).toISOString();
const tenant={applicationId:'fixture-app',tenantId:'fixture-tenant',ownerId:'fixture-owner'};
const secret='synthetic-webhook-secret';
const holds=new Set(),outbox=[];
let captureWrites=0,duplicates=0,storageAvailable=true;
for(const channel of ['email','whatsapp','linkedin']) {
  const binding={...tenant,connectionId:`fixture-${channel}`,accountId:`fixture-account-${channel}`,generation:1,channel,platform:channel==='email'?'gmail':channel,backend:'unipile'};
  const account=`provider-${channel}`,owner='provider-owner',peer='provider-peer';
  const sender=channel==='email'?{kind:'email',value:'peer@example.com'}:channel==='whatsapp'?{kind:'phone',value:'+61400000002'}:{kind:'linkedin_profile',value:'https://www.linkedin.com/in/fixture-peer'};
  const scopes={binding,providerAccountId:account};
  const mail={object:'Email',id:'email1',account_id:account,date:at,from_attendee:{identifier:'peer@example.com',identifier_type:'EMAIL_ADDRESS'},to_attendees:[{identifier:'owner@example.com',identifier_type:'EMAIL_ADDRESS'}],cc_attendees:[],bcc_attendees:[],role:'inbox',headers:[{name:'Auto-Submitted',value:'no'}],is_complete:true};
  const context=channel==='email'?{...scopes,channel,ownerAddresses:['owner@example.com'],timestampBounds:{from:new Date(now-60000).toISOString(),through:received},email:{...scopes,id:'email1',complete:true,headersComplete:true,mail}}:
    {...scopes,channel,ownerProviderId:owner,product:channel==='linkedin'?'classic':'whatsapp',timestampBounds:{from:new Date(now-60000).toISOString(),through:received},chat:{...scopes,id:'chat1',type:'direct',participantProviderIds:[owner,peer]},sender:{...scopes,providerId:peer,identity:sender}};
  const raw=channel==='email'?{event:'mail_received',account_id:account,email_id:'email1',date:at,from_attendee:mail.from_attendee}:
    {event:'message_received',account_id:account,account_type:channel.toUpperCase(),account_info:{type:channel.toUpperCase(),user_id:owner,...(channel==='linkedin'?{feature:'classic'}:{})},chat_id:'chat1',message_id:'message1',timestamp:at,sender:{attendee_provider_id:peer}};
  // Explicit test-only memory ports. Restart would lose records; no storage durability is claimed.
  const records=new Map(),semantic=new Map();let lastKey;
  const ingress=createReplyWebhookIngress({binding,now:()=>now,authenticate:headers=>verifyUnipileV1Webhook({rawHeaders:headers,headerName:'Unipile-Auth',secret}).verified,
    validateEnvelope:r=>r.account_id===account?'valid':'forbidden',journal:{async capture(input){
      if(!storageAvailable)throw new Error('synthetic storage failure');lastKey=input.key;
      if(records.has(input.key)){duplicates++;return {binding,key:input.key,status:'duplicate'};}
      captureWrites++;records.set(input.key,{...structuredClone(input),token:'fixture-lease',state:'pending'});return {binding,key:input.key,status:'accepted'};
    }}});
  const worker=createReplyProcessor({binding,normalize:async r=>normalizeV1ReplyEvent(r,context),resolve:async e=>[{scope:tenant,personId:'shared-person',identity:e.sender,since:new Date(now-60000).toISOString()}],journal:{
    async claim({key}) {const r=records.get(key);if(!r)return {kind:'busy'};if(r.state==='completed')return {kind:'completed'};return {kind:'claimed',record:structuredClone({binding:r.binding,key:r.key,rawBody:r.rawBody,receivedAt:r.receivedAt,token:r.token})};},
    async finish(input){
      const previous=input.eventKey?semantic.get(input.eventKey):null;
      if(previous && previous!==input.eventFingerprint)return {binding,key:input.record.key,committed:false};
      if(input.eventKey)semantic.set(input.eventKey,input.eventFingerprint);
      if(input.decision.action==='stop' && !previous){holds.add(input.decision.personId);outbox.push({personId:input.decision.personId,channel});}
      records.get(input.record.key).state='completed';return {binding,key:input.record.key,committed:true};
    }
  }});
  const server=createReplyWebhookServer({ingress});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/v1/webhook`;
  const post=async(payload,token=secret)=>fetch(url,{method:'POST',headers:{'content-type':'application/json','Unipile-Auth':token},body:JSON.stringify(payload)});
  try {
    assert.equal((await post(raw,'wrong')).status,401);assert.equal(records.size,0);
    assert.equal((await post({...raw,account_id:'foreign'})).status,403);assert.equal(records.size,0);
    storageAvailable=false;assert.equal((await post(raw)).status,503);storageAvailable=true;
    assert.equal((await post(raw)).status,200);
    assert.deepEqual(await worker.process(lastKey),{status:'processed',decision:{action:'stop',personId:'shared-person'}});
    assert.deepEqual(await worker.process(lastKey),{status:'duplicate'});
    assert.equal((await post(raw)).status,200);assert.equal(records.size,1);
    // Different encoded deliveries of the same event deduplicate at the semantic event boundary.
    const reordered=Object.fromEntries(Object.entries(raw).reverse());assert.equal((await post(reordered)).status,200);
    assert.equal((await worker.process(lastKey)).status,'processed');assert.equal(outbox.filter(e=>e.channel===channel).length,1);
    const nonreply={...raw,event:channel==='email'?'mail_moved':'message_read'};assert.equal((await post(nonreply)).status,200);
    assert.deepEqual(await worker.process(lastKey),{status:'processed',decision:{action:'ignore',reason:'non_reply_event'}});
    assert.equal(outbox.filter(e=>e.channel===channel).length,1);
    if(channel!=='email') {
      const old=context.sender;context.sender=undefined;assert.equal((await post({...raw,message_id:'unresolved'})).status,200);
      assert.deepEqual(await worker.process(lastKey),{status:'processed',decision:{action:'review',code:'identity_pending'}});context.sender=old;
      assert.equal(outbox.filter(e=>e.channel===channel).length,1);
    }
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
assert.equal(holds.size,1);assert.equal(outbox.length,3);
process.stdout.write(JSON.stringify({allThreeChannels:true,nativeWebhookHttp:true,authenticatedAccountBinding:true,noAcknowledgementOnCaptureFailure:true,duplicateWebhookAndSemanticEventHandling:true,ambiguousIdentityReview:true,onePersonAcrossChannels:true,syntheticOutboxEvents:outbox.length,captureWrites,duplicateCaptures:duplicates,persistentStorageVerified:false,coverageAdvanced:false,realProviderWrites:0,migrationsApplied:0}));
