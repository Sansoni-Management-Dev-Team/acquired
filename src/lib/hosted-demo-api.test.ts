import{expect,it,vi}from'vitest';
import{createHostedDemoRequestHandler}from'./hosted-demo-api';
import{readHostedDemoCommunicationsDescriptor}from'./hosted-demo-communications-environment';
const actor={applicationId:'acquire',tenantId:'org',ownerId:'owner'};
const binding={...actor,connectionId:'connection',accountId:'account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'};
const d={version:1,mode:'hosted-demo',runId:'hosted-demo-example',integrationId:'sim-hosted-demo-example',configurationReference:'sim-hosted-demo-example-v1',applicationOrigin:'https://app.example.invalid',serviceOrigin:'https://demo.example.invalid',setupOrigin:'https://demo.example.invalid',actor,capabilities:{dynamicRecipients:true,recipientContextLookup:true,remoteApplicationAuthority:true,durableEvents:true},bindings:[binding]};
const descriptor=readHostedDemoCommunicationsDescriptor({NODE_ENV:'production',APP_URL:d.applicationOrigin,AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED:'true',AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify(d)}),key=Buffer.alloc(32,7).toString('base64url');
const headers={'Content-Type':'application/json',Authorization:'Bearer '+key,'X-Acquire-Demo-Run':d.runId,'X-Acquire-Demo-Audience':'acquire-hosted-demo-v1'};
const query={accountId:'sim-'+d.runId+'-whatsapp',channel:'whatsapp',kind:'phone',value:'+999123456789012'};
const recipient={version:1,kind:'recipient.resolve',scope:{runId:d.runId,organizationId:'org',userId:'owner'},query};
const projection={scope:recipient.scope,personId:'10000000-0000-4000-8000-000000000001',companyId:null,mandateId:'10000000-0000-4000-8000-000000000002',mappingId:'10000000-0000-4000-8000-000000000003',sourceRevision:'12',sourceFingerprint:'a'.repeat(64),name:'Saved Person',company:'Saved company',facts:{role:'Director'},aliases:{email:'lead-001@'+d.runId+'.leads.acquire.test',phone:query.value,linkedin:'https://www.linkedin.com/in/sim-'+d.runId+'-lead-001',providerId:'ACo_sim_'+d.runId+'_lead-001'}};
function setup(){const authorizeCurrent=vi.fn(async()=>true),execute=vi.fn(async()=>({coverageScopes:[{binding,scopeDigest:'c'.repeat(64)}]})),resolveRecipient=vi.fn(async()=>projection);return{authorizeCurrent,execute,resolveRecipient,handler:createHostedDemoRequestHandler({descriptor,key,authorizeCurrent,authority:{execute},resolveRecipient})};}
const request=(path:string,body:unknown,patch:HeadersInit={})=>new Request(d.applicationOrigin+'/api/agent/hosted-demo/'+path,{method:'POST',headers:{...headers,...patch},body:JSON.stringify(body)});
it('authenticates fixed run/audience/key and current membership before any source or authority access',async()=>{
 const f=setup();for(const patch of([{Authorization:'Bearer wrong'},{'X-Acquire-Demo-Run':'foreign'},{'X-Acquire-Demo-Audience':'communications'}]as Record<string,string>[]))expect((await f.handler(request('recipient',recipient,patch))).status).toBe(403);expect(f.authorizeCurrent).not.toHaveBeenCalled();expect(f.resolveRecipient).not.toHaveBeenCalled();
 f.authorizeCurrent.mockResolvedValue(false);expect((await f.handler(request('recipient',recipient))).status).toBe(403);expect(f.resolveRecipient).not.toHaveBeenCalled();expect(f.execute).not.toHaveBeenCalled();
});
it('resolves exactly one owned recipient on demand and returns only the strict bounded projection',async()=>{
 const f=setup(),r=await f.handler(request('recipient',recipient));expect(r.status).toBe(200);expect(await r.json()).toEqual({version:1,status:'resolved',projection});expect(f.resolveRecipient).toHaveBeenCalledExactlyOnceWith(query);
 expect((await f.handler(request('recipient',{...recipient,scope:{...recipient.scope,userId:'foreign'}}))).status).toBe(400);expect(f.resolveRecipient).toHaveBeenCalledOnce();
 f.resolveRecipient.mockResolvedValue({...projection,personalData:{email:'PRIVATE'}}as never);const invalid=await f.handler(request('recipient',recipient));expect(invalid.status).toBe(503);expect(await invalid.text()).not.toContain('PRIVATE');
});
it('delegates only strict authenticated authority commands and never accepts a caller scope or grant boolean',async()=>{
 const f=setup(),command={method:'prepared.get',snapshot:{binding,key:'original',operation:'message',payloadDigest:'a'.repeat(64)}};
 expect((await f.handler(request('authority',command))).status).toBe(200);expect(f.execute).toHaveBeenCalledExactlyOnceWith(command,expect.any(AbortSignal));
 for(const body of[{...command,authorized:true},{...command,scope:actor},{...command,snapshot:{...command.snapshot,binding:{...binding,ownerId:'foreign'}}}])expect((await f.handler(request('authority',body))).status).toBe(400);expect(f.execute).toHaveBeenCalledOnce();
});
it('offers only current exact-actor access proof and sanitizes unavailable application errors',async()=>{
 const f=setup(),access=await f.handler(request('access',{version:1}));expect(await access.json()).toEqual({version:1,authorized:true,scope:actor,runId:d.runId,phase:'active',authorityReady:true});expect(f.execute).not.toHaveBeenCalled();expect(f.resolveRecipient).not.toHaveBeenCalled();
 f.resolveRecipient.mockRejectedValue(Error('PRIVATE credential or source'));const r=await f.handler(request('recipient',recipient));expect(r.status).toBe(503);expect(await r.text()).not.toContain('PRIVATE');
});
it('permits membership-only setup access during provisioning while refusing all data, proof and authority commands',async()=>{
 const staged=readHostedDemoCommunicationsDescriptor({NODE_ENV:'production',APP_URL:d.applicationOrigin,AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED:'true',AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify({...d,phase:'provisioning',bindings:[]})}),f=setup(),handler=createHostedDemoRequestHandler({descriptor:staged,key,authorizeCurrent:f.authorizeCurrent,authority:{execute:f.execute},resolveRecipient:f.resolveRecipient});
 const access=await handler(request('access',{version:1}));expect(access.status).toBe(200);expect(await access.json()).toEqual({version:1,authorized:true,scope:actor,runId:d.runId,phase:'provisioning',authorityReady:false});
 for(const path of['authority','recipient','coverage','events'])expect((await handler(request(path,recipient))).status).toBe(403);expect(f.execute).not.toHaveBeenCalled();expect(f.resolveRecipient).not.toHaveBeenCalled();
});
it('bounds the body and refuses wrong origin, query, method and content type before source resolution',async()=>{
 const f=setup();expect((await f.handler(new Request(d.applicationOrigin+'/api/agent/hosted-demo/recipient',{method:'GET',headers}))).status).toBe(405);
 expect((await f.handler(new Request('https://foreign.example.invalid/api/agent/hosted-demo/recipient',{method:'POST',headers,body:JSON.stringify(recipient)}))).status).toBe(404);
 expect((await f.handler(request('recipient?unexpected=1',recipient))).status).toBe(404);
 expect((await f.handler(request('recipient',recipient,{'Content-Type':'text/plain'}))).status).toBe(400);
 expect((await f.handler(request('recipient',{...recipient,extra:'x'.repeat(70000)}))).status).toBe(400);expect(f.resolveRecipient).not.toHaveBeenCalled();
});
it('passes only original live held coverage and event proofs to application commits and returns exact acknowledgements',async()=>{
 const f=setup(),now=new Date().toISOString(),subscriberId='acquire-hosted-demo-replies',coverage={coverage:{binding,scope:'account',from:'1970-01-01T00:00:00.000Z',through:now,observedAt:now,complete:true,initialSyncComplete:true,invalidated:false},scopeDigest:'b'.repeat(64),serviceRevision:'3',subscriberId,sessionId:'x'.repeat(43),expiresAt:new Date(Date.now()+15000).toISOString()},event={binding,subscriberId,eventId:'1',sourceNamespace:'reply_review/v1',sourceEventKey:'c'.repeat(64),payload:{outcome:{kind:'review',code:'protocol'},fingerprint:'d'.repeat(64),receivedAt:now},sessionId:'y'.repeat(43),expiresAt:coverage.expiresAt},ack={binding,subscriberId,eventId:'1',fingerprint:'d'.repeat(64),status:'committed'},projectCoverage=vi.fn(async()=>undefined),deliverEvents=vi.fn(async()=>ack),handler=createHostedDemoRequestHandler({descriptor,key,authorizeCurrent:f.authorizeCurrent,authority:{execute:f.execute},resolveRecipient:f.resolveRecipient,projectCoverage,deliverEvents});
 const r=await handler(request('coverage',coverage));expect(r.status).toBe(200);expect(await r.json()).toEqual({status:'projected'});expect(projectCoverage).toHaveBeenCalledExactlyOnceWith(coverage,expect.any(AbortSignal));
 expect(await(await handler(request('events',event))).json()).toEqual(ack);expect(deliverEvents).toHaveBeenCalledExactlyOnceWith(event,expect.any(AbortSignal));
 for(const patch of[{expiresAt:'2000-01-01T00:00:00.000Z'},{expiresAt:new Date(Date.now()+60000).toISOString()},{subscriberId:'primary-subscriber'},{coverage:{...coverage.coverage,binding:{...binding,ownerId:'foreign'}}}])expect((await handler(request('coverage',{...coverage,...patch}))).status).toBe(400);expect(projectCoverage).toHaveBeenCalledOnce();
 deliverEvents.mockResolvedValue({...ack,eventId:'2'});expect((await handler(request('events',event))).status).toBe(503);
});
