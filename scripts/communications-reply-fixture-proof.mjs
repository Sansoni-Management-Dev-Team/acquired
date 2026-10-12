// Synthetic in-container integration. Required storage ports are memory fixtures, not PostgreSQL.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
const require=createRequire(import.meta.url);
const {createReplyWebhookIngress,createReplyProcessor,createReplyWebhookServer,createUnipileV1ReplyEnricher,UnipileV1Transport,verifyUnipileV1Webhook}=require('/fixture/src/index.js');
const now=Date.now(),at=new Date(now-1000).toISOString(),received=new Date(now).toISOString();
const tenant={applicationId:'fixture-app',tenantId:'fixture-tenant',ownerId:'fixture-owner'};
const secret='synthetic-webhook-secret';
const holds=new Set(),outbox=[];
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
  // Explicit test-only memory ports. Restart would lose records; no storage durability is claimed.
  const records=new Map(),semantic=new Map();let lastKey;
  const ingress=createReplyWebhookIngress({binding,now:()=>now,authenticate:headers=>verifyUnipileV1Webhook({rawHeaders:headers,headerName:'Unipile-Auth',secret}).verified,
    validateEnvelope:r=>r.account_id===account?'valid':'forbidden',journal:{async capture(input){
      if(!storageAvailable)throw new Error('synthetic storage failure');lastKey=input.key;
      if(records.has(input.key)){duplicates++;return {binding,key:input.key,status:'duplicate'};}
      captureWrites++;records.set(input.key,{...structuredClone(input),token:'fixture-lease',state:'pending'});return {binding,key:input.key,status:'accepted'};
    }}});
  const worker=createReplyProcessor({binding,normalize:enricher.normalize,resolve:async e=>[{scope:tenant,personId:'shared-person',identity:e.sender,since:new Date(now-60000).toISOString()}],journal:{
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
  }finally{server.closeAllConnections();provider.closeAllConnections();await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>provider.close(resolve))]);}
}
assert.equal(holds.size,1);assert.equal(outbox.length,3);
process.stdout.write(JSON.stringify({allThreeChannels:true,nativeWebhookHttp:true,nativeReadOnlyEnrichment:true,providerReads,authenticatedAccountBinding:true,noAcknowledgementOnCaptureFailure:true,duplicateWebhookAndSemanticEventHandling:true,ambiguousIdentityReview:true,onePersonAcrossChannels:true,syntheticOutboxEvents:outbox.length,captureWrites,duplicateCaptures:duplicates,persistentStorageVerified:false,coverageAdvanced:false,realProviderWrites:0,migrationsApplied:0}));
