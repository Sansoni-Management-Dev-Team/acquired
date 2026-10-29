import{createServer}from'node:http';
import{expect,it,vi}from'vitest';
import{createHostedDemoRequestHandler}from'./hosted-demo-api';
import{createHostedDemoAuthorityRegistry}from'./hosted-demo-authority-registry';
import{readHostedDemoCommunicationsDescriptor}from'./hosted-demo-communications-environment';
import{createRemoteApplicationAuthority}from'../../communications/packages/core/src/remote-application-authority';

/** Disposable real HTTP, actual parser/registry/remote client, synthetic authority.
 * Injected latency, not a claim that shared local PostgreSQL naturally takes six seconds. */
it('opens after six seconds and commits once within the original held window over real HTTP',async()=>{
 const actor={applicationId:'acquire',tenantId:'fixture-org',ownerId:'fixture-owner'};
 const binding={...actor,connectionId:'fixture-connection',accountId:'fixture-account',generation:1,channel:'email',platform:'gmail',backend:'unipile'}as const;
 const raw={version:1,mode:'hosted-demo',phase:'active',runId:'hosted-demo-latency',integrationId:'sim-hosted-demo-latency',configurationReference:'sim-hosted-demo-latency-v1',applicationOrigin:'https://app.example.invalid',serviceOrigin:'https://service.example.invalid',setupOrigin:'https://service.example.invalid',actor,capabilities:{dynamicRecipients:true,recipientContextLookup:true,remoteApplicationAuthority:true,durableEvents:true},bindings:[binding]};
 const descriptor=readHostedDemoCommunicationsDescriptor({NODE_ENV:'production',APP_URL:raw.applicationOrigin,AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED:'true',AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify(raw)});
 const key=Buffer.alloc(32,71).toString('base64url'),snapshot={binding,key:'synthetic-original',operation:'message',payloadDigest:'a'.repeat(64)}as const,recipient={kind:'email',value:'lead-001@hosted-demo-latency.leads.acquire.test'}as const;
 const commit=vi.fn(async()=> 'committed' as const),abort=vi.fn(async()=>{}),open=vi.fn(async()=>{await new Promise(r=>setTimeout(r,6000));return{kind:'held' as const,permit:{permitId:'permit',intentDigest:'b'.repeat(64),coverageScopes:[{binding,recipient,scopeDigest:'c'.repeat(64),requiredSince:'2026-10-01T00:00:00.000Z'}],commit,abort}};});
 const registry=createHostedDemoAuthorityRegistry({scope:actor,openingTimeoutMs:30000,admission:async()=>({open,getPreparedCoverage:async()=>[]})});
 const handler=createHostedDemoRequestHandler({descriptor,key,authorizeCurrent:async()=>true,authority:registry,resolveRecipient:async()=>{throw Error('No recipient access expected');}});
 let requests=0;
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});const response=await handler(new Request(raw.applicationOrigin+'/api/agent/hosted-demo/authority',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key,'X-Acquire-Demo-Run':raw.runId,'X-Acquire-Demo-Audience':'acquire-hosted-demo-v1'},body:Buffer.concat(chunks),signal:controller.signal}));res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('Address');
 const remote=createRemoteApplicationAuthority({scope:actor,timeoutMs:30000,request:async(command,signal)=>{requests++;const response=await fetch(`http://127.0.0.1:${address.port}`,{method:'POST',body:JSON.stringify(command),signal});return response.json();}});
 try{const started=performance.now(),result=await remote.open({record:{snapshot,recipient,state:'claimed'},claimToken:'claim',serviceRevision:'1'},new AbortController().signal);expect(performance.now()-started).toBeGreaterThanOrEqual(5900);expect(result.kind).toBe('held');if(result.kind!=='held')throw Error('Held expected');
 const receipt={permitId:result.permit.permitId,intentDigest:result.permit.intentDigest,journalId:'journal',admissionId:'admission',snapshot,fencingToken:'1',serviceRevision:'1'};
 expect(await result.permit.commit(receipt,new AbortController().signal)).toBe('committed');expect(await result.permit.commit(receipt,new AbortController().signal)).toBe('committed');expect(commit).toHaveBeenCalledOnce();expect(open).toHaveBeenCalledOnce();expect(requests).toBe(2);expect(abort).not.toHaveBeenCalled();
 }finally{await registry.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
},12000);
