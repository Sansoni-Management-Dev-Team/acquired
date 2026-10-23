import{afterEach,expect,it,vi}from'vitest';

const ports=vi.hoisted(()=>({writerConnect:vi.fn(()=>new Promise<never>(()=>{})),readConnect:vi.fn(),config:[]as Record<string,unknown>[]}));
vi.mock('server-only',()=>({}));
vi.mock('@/db/campaign-client',()=>({campaignSqlPool:()=>({connect:ports.writerConnect}),withCampaignDb:vi.fn()}));
vi.mock('./communications-configuration',()=>({readAcquireCommunicationsKeys:()=>({})}));
vi.mock('@vercel/functions',()=>({attachDatabasePool:vi.fn()}));
vi.mock('pg',()=>({Pool:class{constructor(config:Record<string,unknown>){ports.config.push(config);}connect=ports.readConnect;}}));

afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
it('authorizes a live callback while every campaign writer connection is retained by an outer proof',async()=>{
 vi.useFakeTimers();
 const actor={applicationId:'acquire',tenantId:'org',ownerId:'owner'},runId='hosted-demo-resource-proof',binding={...actor,connectionId:'connection',accountId:'account',generation:1,channel:'email',platform:'gmail',backend:'unipile'},key='a'.repeat(64);
 const descriptor={version:1,mode:'hosted-demo',runId,integrationId:'sim-'+runId,configurationReference:'sim-'+runId+'-v1',applicationOrigin:'https://app.example.invalid',serviceOrigin:'https://demo.example.invalid',setupOrigin:'https://demo.example.invalid',actor,capabilities:{dynamicRecipients:true,recipientContextLookup:true,remoteApplicationAuthority:true,durableEvents:true},bindings:[binding]};
 for(const[k,v]of Object.entries({NODE_ENV:'production',APP_URL:descriptor.applicationOrigin,COMMUNICATIONS_RUNTIME_ENABLED:'true',DATABASE_URL:'postgresql://fixture:fixture@db.example.invalid/postgres',DATABASE_SSL_CA:'fixture-ca',AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED:'true',AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify(descriptor),AGENT_HOSTED_DEMO_APP_AUTH_KEY:key,AGENT_HOSTED_DEMO_SERVICE_AUTH_KEY:'b'.repeat(64)}))vi.stubEnv(k,v);
 const statements:string[]=[],release=vi.fn();
 ports.readConnect.mockResolvedValue({release,query:vi.fn(async(sql:string)=>{statements.push(sql);return{rows:sql.includes('current_user')?[{active_role:'acquire_campaign_user',rolsuper:false,rolbypassrls:false}]:sql.includes('FROM public.member')?[{allowed:true}]:sql.includes('FROM public.agent_demo_runs')?[{id:'run'}]:sql.includes('FROM public.communication_bindings')?[{id:'binding-id'}]:sql.includes('to_regprocedure')?[{installed:true}]:sql.includes('agent_hosted_demo_access_ready')?[{allowed:true}]:[]};})});
 const{hostedDemoRequest,configuredHostedDemoRuntime}=await import('./hosted-demo-runtime');
 const pending=hostedDemoRequest(new Request(descriptor.applicationOrigin+'/api/agent/hosted-demo/access',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json','x-acquire-demo-run':runId,'x-acquire-demo-audience':'acquire-hosted-demo-v1'},body:JSON.stringify({version:1})}));
 await vi.advanceTimersByTimeAsync(5001);
 const response=await pending;expect(response.status).toBe(200);expect((await response.json()).authorized).toBe(true);
 expect(ports.writerConnect).not.toHaveBeenCalled();expect(ports.readConnect).toHaveBeenCalledOnce();
 expect(statements).toContain('BEGIN READ ONLY');expect(statements.join('\n')).not.toMatch(/communications_lock_send_gate|FOR UPDATE/);
 expect(release).toHaveBeenCalledOnce();
 expect(ports.config).toEqual([expect.objectContaining({connectionString:'postgresql://fixture:fixture@db.example.invalid/postgres',max:2,ssl:{ca:'fixture-ca',rejectUnauthorized:true}})]);
 const runtime=configuredHostedDemoRuntime();expect(await runtime.localBinding(binding as never)).toBe('binding-id');
 expect(ports.writerConnect).not.toHaveBeenCalled();expect(ports.readConnect).toHaveBeenCalledTimes(2);
 expect(statements.join('\n')).not.toMatch(/communications_lock_send_gate|FOR UPDATE/);
 await expect(runtime.localBinding({...binding,ownerId:'foreign'}as never)).rejects.toThrow('Hosted demo runtime unavailable');expect(ports.readConnect).toHaveBeenCalledTimes(2);
});
