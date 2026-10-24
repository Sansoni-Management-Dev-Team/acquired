import{afterEach,expect,it,vi}from'vitest';
vi.mock('server-only',()=>({}));
const db=vi.hoisted(()=>({work:vi.fn()}));
vi.mock('@/db/campaign-client',()=>({withCampaignDb:db.work,campaignSqlPool:vi.fn()}));
import{hostedDemoRequest,createHostedDemoServiceRequest}from'./hosted-demo-runtime';
import{readHostedDemoCommunicationsDescriptor}from'./hosted-demo-communications-environment';
import{createScopedServiceAuth}from'../../communications/packages/core/src/scoped-service-auth';
const d={version:1,mode:'hosted-demo',runId:'hosted-demo-example',integrationId:'sim-hosted-demo-example',configurationReference:'sim-hosted-demo-example-v1',applicationOrigin:'https://app.example.invalid',serviceOrigin:'https://demo.example.invalid',setupOrigin:'https://demo.example.invalid',actor:{applicationId:'acquire',tenantId:'org',ownerId:'owner'},capabilities:{dynamicRecipients:true,recipientContextLookup:true,remoteApplicationAuthority:true,durableEvents:true},bindings:[{applicationId:'acquire',tenantId:'org',ownerId:'owner',connectionId:'connection',accountId:'account',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'}]};
const descriptor=readHostedDemoCommunicationsDescriptor({NODE_ENV:'production',APP_URL:d.applicationOrigin,AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED:'true',AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify(d)}),key=Buffer.alloc(32,7);
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
it('bounds the whole service RPC even when an injected transport ignores cancellation',async()=>{
 vi.useFakeTimers();const call=createHostedDemoServiceRequest(descriptor,key,vi.fn(()=>new Promise<Response>(()=>{})));let settled=false;
 void call('/v1/hosted-demo/admissions/verify',{receipt:{}},new AbortController().signal).catch(()=>{settled=true;});await vi.advanceTimersByTimeAsync(5001);expect(settled).toBe(true);
});
it('leaves every hosted route unavailable before loading data or authority when its explicit flag is off',async()=>{
 vi.stubEnv('AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED','false');for(const path of['access','authority','recipient','coverage','events'])expect((await hostedDemoRequest(new Request(d.applicationOrigin+'/api/agent/hosted-demo/'+path,{method:'POST'}))).status).toBe(404);expect(db.work).not.toHaveBeenCalled();
});
it('uses the fixed HTTPS service origin and fresh exact-actor scoped authentication without redirects or retries',async()=>{
 const fetcher=vi.fn(async()=>Response.json({verified:true})),call=createHostedDemoServiceRequest(descriptor,key,fetcher);
 expect(await call('/v1/hosted-demo/admissions/verify',{receipt:{}},new AbortController().signal)).toEqual({verified:true});expect(fetcher).toHaveBeenCalledOnce();
 const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe(d.serviceOrigin+'/v1/hosted-demo/admissions/verify');expect(init).toMatchObject({method:'POST',redirect:'error',credentials:'omit'});expect(new Headers(init.headers).get('X-Communications-Contract-Version')).toBe('1');
 const verifier=createScopedServiceAuth({key,applicationId:'acquire',audience:'communications',authorize:async()=>true});expect(await verifier.verify(new Headers(init.headers).get('authorization')!)).toEqual(d.actor);
 await expect(call('/admin',{key:'PRIVATE'},new AbortController().signal)).rejects.toThrow('Hosted demo runtime unavailable');expect(fetcher).toHaveBeenCalledOnce();
});
it('rejects oversized, invalid and unavailable service responses without exposing private errors',async()=>{
 for(const response of[new Response('PRIVATE failure',{status:500}),Response.json({private:'x'.repeat(65537)}),new Response('PRIVATE json',{headers:{'Content-Type':'application/json'}})]){
  const fetcher=vi.fn(async()=>response);await expect(createHostedDemoServiceRequest(descriptor,key,fetcher)('/v1/hosted-demo/admissions/verify',{},new AbortController().signal)).rejects.toThrow('Hosted demo runtime unavailable');expect(fetcher).toHaveBeenCalledOnce();
 }
});

it('allows a complete six-second hosted history or coverage round trip, while retaining bounded cancellation',async()=>{
 vi.useFakeTimers();for(const path of ['/v1/hosted-demo/history/read','/v1/hosted-demo/coverage/project']){
  const fetcher=vi.fn(async()=>{await new Promise(resolve=>setTimeout(resolve,6000));return Response.json({complete:true});}),call=createHostedDemoServiceRequest(descriptor,key,fetcher);const result=call(path,{},new AbortController().signal).then(()=>true,()=>false);await vi.advanceTimersByTimeAsync(6000);expect(await result).toBe(true);expect(fetcher).toHaveBeenCalledOnce();
  const never=createHostedDemoServiceRequest(descriptor,key,vi.fn(()=>new Promise<Response>(()=>{})));let stopped=false;void never(path,{},new AbortController().signal).catch(()=>{stopped=true;});await vi.advanceTimersByTimeAsync(24001);expect(stopped).toBe(true);
  const parent=new AbortController();let aborted=false;void never(path,{},parent.signal).catch(()=>{aborted=true;});parent.abort();await vi.advanceTimersByTimeAsync(0);expect(aborted).toBe(true);
 }
});

it.each(['/v1/hosted-demo/coverage/revalidate','/v1/hosted-demo/events/revalidate'])('allows a six-second live proof revalidation on %s within its unchanged parent lifetime',async path=>{
 vi.useFakeTimers();const fetcher=vi.fn(async()=>{await new Promise(resolve=>setTimeout(resolve,6000));return Response.json({verified:true});}),call=createHostedDemoServiceRequest(descriptor,key,fetcher);
 const result=call(path,{},new AbortController().signal).then(value=>value,()=>null);await vi.advanceTimersByTimeAsync(6000);expect(await result).toEqual({verified:true});expect(fetcher).toHaveBeenCalledOnce();
 const never=createHostedDemoServiceRequest(descriptor,key,vi.fn(()=>new Promise<Response>(()=>{}))),parent=new AbortController();let stopped=false;
 void never(path,{},parent.signal).catch(()=>{stopped=true;});await vi.advanceTimersByTimeAsync(1000);parent.abort();await vi.advanceTimersByTimeAsync(0);expect(stopped).toBe(true);
 let expired=false;void never(path,{},new AbortController().signal).catch(()=>{expired=true;});await vi.advanceTimersByTimeAsync(20001);expect(expired).toBe(true);
});
it.each([401,503])('reports coverage revalidation HTTP %s without response or authentication data',async status=>{
 vi.stubEnv('AGENT_VERBOSE_LOGGING','true');const log=vi.spyOn(console,'warn').mockImplementation(()=>{});
 try{const call=createHostedDemoServiceRequest(descriptor,key,vi.fn(async()=>new Response('PRIVATE response',{status})));
 await expect(call('/v1/hosted-demo/coverage/revalidate',{private:'PRIVATE payload'},new AbortController().signal)).rejects.toThrow('Hosted demo runtime unavailable');
 expect(log).toHaveBeenCalledWith('hosted-demo-revalidation',JSON.stringify({boundary:'coverage.revalidate',outcome:'http_error',httpStatus:status}));expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|Bearer|scope-v1/);
 }finally{log.mockRestore();}
});
it('backdates only outgoing hosted scoped issuance so a slightly slower service clock accepts it',async()=>{
 vi.useFakeTimers();vi.setSystemTime(100010);const verifier=createScopedServiceAuth({key,applicationId:'acquire',audience:'communications',authorize:async()=>true,now:()=>100000});
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{const header=new Headers(init?.headers).get('authorization')!;expect(await verifier.verify(header)).toEqual(d.actor);const claims=JSON.parse(Buffer.from(header.slice(7).split('.')[0],'base64url').toString());expect(claims.exp).toBe(159010);return Response.json({verified:false});});
 expect(await createHostedDemoServiceRequest(descriptor,key,fetcher)('/v1/hosted-demo/coverage/revalidate',{},new AbortController().signal)).toEqual({verified:false});
});
