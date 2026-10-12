// Synthetic in-container integration: encrypted wire capture, reusable service normalization,
// separate application receipt/hold transaction and service acknowledgement. All storage ports
// remain memory fixtures; this verifies composition, not PostgreSQL durability or atomicity.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
const require=createRequire(import.meta.url);
const {createReplyWebhookIngress,createWebhookEventProcessor,WebhookCodec,createReplyWebhookServer,createUnipileV1ReplyEnricher,UnipileV1Transport,verifyUnipileV1Webhook}=require('/fixture/src/index.js');
const now=Date.now(),at=new Date(now-1000).toISOString(),received=new Date(now).toISOString();
const tenant={applicationId:'fixture-app',tenantId:'fixture-tenant',ownerId:'fixture-owner'};
const secret='synthetic-webhook-secret';
const holds=new Set(),applicationReceipts=new Map(),applicationCommits=[],serviceOutbox=[];
let applicationReplayChecks=0,lostAcknowledgements=0,fingerprintMismatchReviews=0,encryptedRoundTrips=0;
const codec=new WebhookCodec({activeVersion:'fixture-v1',keys:[{version:'fixture-v1',encryptionKey:new Uint8Array(32).fill(7),digestKey:new Uint8Array(32).fill(9)}]});
let captureWrites=0,duplicates=0,storageAvailable=true,providerReads=0;
for(const channel of ['email','whatsapp','linkedin']) {
  const binding={...tenant,connectionId:`fixture-${channel}`,accountId:`fixture-account-${channel}`,generation:1,channel,platform:channel==='email'?'gmail':channel,backend:'unipile'};
  const account=`provider-${channel}`,owner='provider-owner',peer='provider-peer';
  const sender=channel==='email'?{kind:'email',value:'peer@example.com'}:channel==='whatsapp'?{kind:'phone',value:'+61400000002'}:{kind:'linkedin_profile',value:'https://www.linkedin.com/in/fixture-peer'};
  const scopes={binding,providerAccountId:account};
  const mail={object:'Email',kind:'2_full',id:'email1',account_id:account,date:at,from_attendee:{identifier:'peer@example.com',identifier_type:'EMAIL_ADDRESS'},to_attendees:[{identifier:'owner@example.com',identifier_type:'EMAIL_ADDRESS'}],cc_attendees:[],bcc_attendees:[],role:'inbox',headers:[{name:'Auto-Submitted',value:'no'}]};
  const context=channel==='email'?{...scopes,channel,ownerAddresses:['owner@example.com'],timestampBounds:{from:new Date(now-60000).toISOString(),through:received},email:{...scopes,id:'email1',complete:true,headersComplete:true,mail}}:
    {...scopes,channel,ownerProviderId:owner,product:channel==='linkedin'?'classic':'whatsapp',timestampBounds:{from:new Date(now-60000).toISOString(),through:received},chat:{...scopes,id:'chat1',type:'direct',participantProviderIds:[owner,peer]},sender:{...scopes,providerId:peer,identity:sender}};
  const raw=channel==='email'?{event:'mail_received',account_id:account,email_id:'email1',date:at,from_attendee:mail.from_attendee}:
    {event:'message_received',account_id:account,account_type:channel.toUpperCase(),account_info:{type:channel.toUpperCase(),user_id:owner,...(channel==='linkedin'?{feature:'classic'}:{})},chat_id:'chat1',message_id:'message1',timestamp:at,sender:{attendee_provider_id:peer}};
  const accountData={object:'Account',id:account,type:channel==='email'?'GOOGLE_OAUTH':channel.toUpperCase(),sources:[{id:'fixture-source',status:'OK'}],connection_params:channel==='email'?{mail:{username:'owner@example.com'}}:channel==='whatsapp'?{im:{phone_number:'+61400000001'}}:{im:{id:owner}}};
  const provider=createServer((request,response)=>{
    assert.equal(request.method,'GET');assert.equal(request.headers['x-api-key'],'synthetic-unipile-read-key');providerReads++;
    const url=new URL(request.url,'http://fixture.invalid');let data;
    if(url.pathname===`/api/v1/accounts/${account}`)data=accountData;
    else if(url.pathname==='/api/v1/chats/chat1') {assert.equal(url.searchParams.get('account_id'),account);data={object:'Chat',id:'chat1',account_id:account,account_type:channel.toUpperCase(),type:0};}
    else if(url.pathname==='/api/v1/chats/chat1/attendees') {assert.equal(url.search,'');data={object:'ChatAttendeeList',cursor:null,items:[{object:'ChatAttendee',id:'owner-attendee',account_id:account,provider_id:owner,is_self:1},{object:'ChatAttendee',id:'peer-attendee',account_id:account,provider_id:peer,is_self:0}]};}
    else if(url.pathname.startsWith('/api/v1/messages/'))data={object:'Message',id:url.pathname.slice('/api/v1/messages/'.length),account_id:account,chat_id:'chat1',sender_id:peer,sender_attendee_id:'peer-attendee',is_sender:0,is_event:0,hidden:0,deleted:0,timestamp:at,message_type:'MESSAGE'};
    else if(url.pathname==='/api/v1/emails/email1'){assert.equal(url.searchParams.get('account_id'),account);assert.equal(url.searchParams.get('include_headers'),'true');data=mail;}
    else {response.writeHead(404).end();return;}
    response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(data));
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const transport=new UnipileV1Transport({apiVersion:'v1',baseUrl:`http://127.0.0.1:${provider.address().port}/api/v1`,apiKey:'synthetic-unipile-read-key',allowLoopbackHttp:true});
  const enricher=createUnipileV1ReplyEnricher({binding,providerAccountId:account,sourceId:'fixture-source',eventsFrom:new Date(now-60000).toISOString(),now:()=>now,transport,
    ...(channel==='email'?{channel,ownerAddresses:['owner@example.com']}:{channel,ownerProviderId:owner,product:channel==='linkedin'?'classic':'whatsapp'}),
    verifyOwner:async({account:observed})=>channel==='email'?observed.connection_params.mail.username==='owner@example.com':channel==='whatsapp'?observed.connection_params.im.phone_number==='+61400000001':observed.connection_params.im.id===owner,
    resolveAlias:async()=>context.sender?{...context.sender,sourceId:'fixture-source',product:channel==='linkedin'?'classic':'whatsapp'}:null,
  });
  // Explicit test-only memory ports: encrypted rows survive neither process/container restart.
  // The service fixture stores no application person ID and cannot write an application hold.
  const records=new Map(),semantic=new Map();let lastKey;
  const ingress=createReplyWebhookIngress({binding,now:()=>now,authenticate:headers=>verifyUnipileV1Webhook({rawHeaders:headers,headerName:'Unipile-Auth',secret}).verified,
    validateEnvelope:r=>r.account_id===account?'valid':'forbidden',journal:{async capture(input){
      if(!storageAvailable)throw new Error('synthetic storage failure');lastKey=input.key;
      const external={binding:input.binding,key:input.key},previous=records.get(input.key);
      if(previous){
        assert.equal(previous.digest,codec.digest(external,input.rawBody,previous.payload.keyVersion));
        const decoded=codec.decode(external,previous.payload);assert.deepEqual(decoded.rawBody,input.rawBody);assert.equal(decoded.receivedAt,previous.receivedAt);
        duplicates++;return {binding,key:input.key,status:'duplicate'};
      }
      const payload=codec.encode(input),roundTrip=codec.decode(external,payload);
      assert.deepEqual(roundTrip,input);encryptedRoundTrips++;
      assert.equal(JSON.stringify(payload).includes(JSON.stringify(raw)),false);
      captureWrites++;records.set(input.key,{binding:structuredClone(binding),key:input.key,receivedAt:input.receivedAt,payload,digest:codec.digest(external,input.rawBody,payload.keyVersion),token:'fixture-lease',state:'pending'});
      return {binding,key:input.key,status:'accepted'};
    }}});
  const worker=createWebhookEventProcessor({binding,normalize:enricher.normalize,journal:{
    async claim({key}) {
      const row=records.get(key);if(!row)return {kind:'busy'};if(row.state==='completed')return {kind:'completed'};
      const decoded=codec.decode({binding,key},row.payload);assert.equal(decoded.receivedAt,row.receivedAt);
      return {kind:'claimed',record:{...decoded,token:row.token}};
    },
    async finish(input){
      const previous=input.outcome.kind==='event'?semantic.get(input.outcome.eventKey):null;
      if(previous && previous!==input.outcome.fingerprint)return {binding,key:input.record.key,committed:false};
      if(input.outcome.kind==='event') {
        if(!previous)serviceOutbox.push({binding:structuredClone(binding),key:input.record.key,outcome:structuredClone(input.outcome),acknowledged:false,channel});
        semantic.set(input.outcome.eventKey,input.outcome.fingerprint);
      }else if(input.outcome.kind==='review')serviceOutbox.push({binding:structuredClone(binding),key:input.record.key,outcome:structuredClone(input.outcome),acknowledged:false,channel});
      records.get(input.record.key).state='completed';return {binding,key:input.record.key,committed:true};
    }
  }});
  // Synthetic Acquire consumer. This separate synchronous memory transaction models a required
  // application receipt + person-wide hold commit; it is not a real database transaction proof.
  function commitApplication(entry) {
    assert.deepEqual(entry.binding,binding);assert.equal(entry.outcome.kind,'event');
    const {eventKey,fingerprint,event}=entry.outcome;
    assert.equal(event.type,'message');assert.equal(event.direction,'inbound');assert.deepEqual(event.reference.binding,binding);assert.deepEqual(event.sender,sender);
    const previous=applicationReceipts.get(eventKey);
    if(previous){
      applicationReplayChecks++;
      if(previous.fingerprint!==fingerprint){fingerprintMismatchReviews++;return {status:'review',code:'protocol'};}
      assert.deepEqual(previous.binding,entry.binding);return {status:'duplicate'};
    }
    const receipt={binding:structuredClone(binding),fingerprint,personId:'shared-person'};
    holds.add(receipt.personId);applicationReceipts.set(eventKey,receipt);applicationCommits.push({personId:receipt.personId,channel});return {status:'committed'};
  }
  function acknowledgeService(entry) {
    const recorded=serviceOutbox.find(item=>item.channel===channel && item.key===entry.key);
    assert.ok(recorded);assert.deepEqual(recorded.binding,entry.binding);assert.equal(recorded.outcome.fingerprint,entry.outcome.fingerprint);
    recorded.acknowledged=true;
  }
  function consumeApplication(entry,{crashBeforeAck=false}={}) {
    const result=commitApplication(entry);if(result.status==='review')return result;
    if(crashBeforeAck){lostAcknowledgements++;return {status:'retry'};}
    acknowledgeService(entry);return result;
  }
  const server=createReplyWebhookServer({ingress});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/v1/webhook`;
  const post=async(payload,token=secret)=>fetch(url,{method:'POST',headers:{'content-type':'application/json','Unipile-Auth':token},body:JSON.stringify(payload)});
  try {
    assert.equal((await post(raw,'wrong')).status,401);assert.equal(records.size,0);
    assert.equal((await post({...raw,account_id:'foreign'})).status,403);assert.equal(records.size,0);
    storageAvailable=false;assert.equal((await post(raw)).status,503);storageAvailable=true;
    const beforeApplication=applicationCommits.length,beforeOutbox=serviceOutbox.length;
    assert.equal((await post(raw)).status,200);
    assert.equal(records.get(lastKey).payload?.format,'communications-webhook-v1');assert.equal('rawBody' in records.get(lastKey),false);
    const encrypted=records.get(lastKey).payload;
    assert.throws(()=>codec.decode({binding:{...binding,tenantId:'foreign'},key:lastKey},encrypted),{message:'Invalid webhook data'});
    assert.throws(()=>codec.decode({binding,key:'other-key'},encrypted),{message:'Invalid webhook data'});
    assert.deepEqual(await worker.process(lastKey),{status:'processed'});
    assert.equal(applicationCommits.length,beforeApplication,'Reusable service normalization must not commit an application hold');
    assert.equal(applicationReceipts.size,beforeApplication);assert.equal(serviceOutbox.length,beforeOutbox+1);
    const delivery=serviceOutbox.at(-1);assert.equal(delivery.acknowledged,false);
    assert.deepEqual(await worker.process(lastKey),{status:'duplicate'});
    // Crash after the application receipt+hold commit and before service ACK; delivery remains pending.
    assert.deepEqual(consumeApplication(delivery,{crashBeforeAck:true}),{status:'retry'});
    assert.equal(applicationCommits.length,beforeApplication+1);assert.equal(delivery.acknowledged,false);
    const changed=structuredClone(delivery);changed.outcome.fingerprint='f'.repeat(64);
    assert.deepEqual(consumeApplication(changed),{status:'review',code:'protocol'});
    assert.equal(delivery.acknowledged,false);assert.equal(applicationCommits.length,beforeApplication+1);
    assert.deepEqual(consumeApplication(structuredClone(delivery)),{status:'duplicate'});
    assert.equal(delivery.acknowledged,true);assert.equal(applicationCommits.length,beforeApplication+1);
    assert.equal((await post(raw)).status,200);assert.equal(records.size,1);
    // Different encoded deliveries of the same event deduplicate before subscriber outbox creation.
    const reordered=Object.fromEntries(Object.entries(raw).reverse());assert.equal((await post(reordered)).status,200);
    assert.equal((await worker.process(lastKey)).status,'processed');assert.equal(applicationCommits.filter(e=>e.channel===channel).length,1);assert.equal(serviceOutbox.length,beforeOutbox+1);
    const nonreply={...raw,event:channel==='email'?'mail_moved':'message_read'};assert.equal((await post(nonreply)).status,200);
    assert.deepEqual(await worker.process(lastKey),{status:'processed'});assert.equal(serviceOutbox.length,beforeOutbox+1);
    assert.equal(applicationCommits.filter(e=>e.channel===channel).length,1);
    if(channel!=='email') {
      const old=context.sender;context.sender=undefined;assert.equal((await post({...raw,message_id:'unresolved'})).status,200);
      assert.deepEqual(await worker.process(lastKey),{status:'processed'});context.sender=old;
      assert.deepEqual(serviceOutbox.at(-1).outcome,{kind:'review',code:'identity_pending'});
      assert.equal(applicationCommits.filter(e=>e.channel===channel).length,1);assert.equal(serviceOutbox.at(-1).acknowledged,false);
    }
  }finally{server.closeAllConnections();provider.closeAllConnections();await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>provider.close(resolve))]);}
}
assert.equal(holds.size,1);assert.equal(applicationCommits.length,3);assert.equal(applicationReceipts.size,3);
assert.equal(serviceOutbox.filter(row=>row.outcome.kind==='event' && row.acknowledged).length,3);
assert.equal(lostAcknowledgements,3);assert.equal(fingerprintMismatchReviews,3);assert.equal(applicationReplayChecks,6);
process.stdout.write(JSON.stringify({allThreeChannels:true,nativeWebhookHttp:true,nativeReadOnlyEnrichment:true,providerReads,authenticatedAccountBinding:true,noAcknowledgementOnCaptureFailure:true,encryptedWebhookCapture:true,exactWirePayloadRoundTrips:encryptedRoundTrips,scopedCiphertextRejects:true,reusableServiceNormalization:true,serviceOutboxWithoutApplicationPolicy:true,separateApplicationHoldAndReceiptCommit:true,applicationCommitBeforeServiceAcknowledgement:true,applicationReceiptReplayFingerprintChecks:applicationReplayChecks,lostAcknowledgementReplays:lostAcknowledgements,fingerprintMismatchReviews,duplicateWebhookAndSemanticEventHandling:true,ambiguousIdentityReview:true,onePersonAcrossChannels:true,syntheticApplicationCommits:applicationCommits.length,syntheticServiceOutboxEvents:serviceOutbox.length,captureWrites,duplicateCaptures:duplicates,persistentStorageVerified:false,databaseTransactionsVerified:false,coverageAdvanced:false,realProviderWrites:0,migrationsApplied:0}));
