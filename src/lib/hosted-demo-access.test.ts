import{afterEach,expect,it,vi}from'vitest';
import{createHostedDemoAccessProbe}from'./hosted-demo-access';
import{readHostedDemoCommunicationsDescriptor}from'./hosted-demo-communications-environment';
const descriptor=readHostedDemoCommunicationsDescriptor({NODE_ENV:'production',APP_URL:'https://app.example.invalid',AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED:'true',AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON:JSON.stringify({version:1,mode:'hosted-demo',phase:'provisioning',runId:'hosted-demo-example',integrationId:'sim-hosted-demo-example',configurationReference:'sim-hosted-demo-example-v1',applicationOrigin:'https://app.example.invalid',serviceOrigin:'https://demo.example.invalid',setupOrigin:'https://demo.example.invalid',actor:{applicationId:'acquire',tenantId:'org',ownerId:'owner'},capabilities:{dynamicRecipients:true,recipientContextLookup:true,remoteApplicationAuthority:true,durableEvents:true},bindings:[]})});
afterEach(()=>vi.useRealTimers());
function fixture(member=true,registered=true,enabled=true){const query=vi.fn(async(sql:string,values?:unknown[])=>{void values;return{rows:sql.includes('to_regprocedure')?[{installed:true}]:sql.includes('SELECT public.agent_hosted_demo_access_ready')?[{allowed:enabled}]:sql.includes('current_user')?[{active_role:'acquire_campaign_user',rolsuper:false,rolbypassrls:false}]:sql.includes('FROM public.member')?(member?[{allowed:true}]:[]):sql.includes('agent_demo_runs')?(registered?[{id:'registered'}]:[]):[]};}),release=vi.fn(),pool={connect:vi.fn(async()=>({query,release}))};return{query,release,pool};}
it('renews setup membership under the restricted role without the writer gate held by an in-flight authority transaction',async()=>{
 const f=fixture();expect(await createHostedDemoAccessProbe(descriptor,f.pool as never)()).toBe(true);const sql=f.query.mock.calls.map(([s])=>s);expect(sql).toContain('BEGIN READ ONLY');expect(sql).toContain('SET LOCAL ROLE acquire_campaign_user');expect(sql.join('\n')).not.toMatch(/communications_lock_send_gate|FOR UPDATE|agent_demo_runs/);expect(sql.at(-1)).toBe('COMMIT');expect(f.release).toHaveBeenCalledOnce();
});

it('shares only an in-flight membership check across a callback burst and checks revocation again after settlement',async()=>{
 const f=fixture();let open!:()=>void;const blocked=new Promise<void>(resolve=>{open=resolve;});
 const connect=f.pool.connect.getMockImplementation()!;f.pool.connect.mockImplementation(async()=>{await blocked;return connect();});
 const probe=createHostedDemoAccessProbe(descriptor,f.pool as never),burst=Array.from({length:12},()=>probe());
 await Promise.resolve();expect(f.pool.connect).toHaveBeenCalledTimes(1);open();expect(await Promise.all(burst)).toEqual(Array(12).fill(true));
 f.query.mockImplementation(async sql=>({rows:sql.includes('current_user')?[{active_role:'acquire_campaign_user',rolsuper:false,rolbypassrls:false}]:[]}));
 expect(await probe()).toBe(false);expect(f.pool.connect).toHaveBeenCalledTimes(2);expect(f.release).toHaveBeenCalledTimes(2);
});

it('reports database unavailability as an operational failure, not a membership denial, without exposing driver details',async()=>{
 const f=fixture();f.pool.connect.mockRejectedValueOnce(Error('private database credential'));const probe=createHostedDemoAccessProbe(descriptor,f.pool as never);
 await expect(probe()).rejects.toThrow('Hosted access unavailable');expect(await probe()).toBe(true);
});

it('bounds a stalled pool wait, discards a late connection exactly once and permits a fresh check',async()=>{
 vi.useFakeTimers();const f=fixture();let releaseConnection!:(value:unknown)=>void;
 f.pool.connect.mockImplementationOnce(()=>new Promise(resolve=>{releaseConnection=resolve;}) as never);
 const probe=createHostedDemoAccessProbe(descriptor,f.pool as never),failure=expect(probe()).rejects.toThrow('Hosted access unavailable');
 await vi.advanceTimersByTimeAsync(5000);await failure;releaseConnection({query:f.query,release:f.release});await Promise.resolve();await Promise.resolve();
 expect(f.release).toHaveBeenCalledTimes(1);expect(f.query).not.toHaveBeenCalled();expect(await probe()).toBe(true);expect(f.release).toHaveBeenCalledTimes(2);
});
it('requires current membership and exact registered run for active access but not initial provisioning',async()=>{
 expect(await createHostedDemoAccessProbe(descriptor,fixture(false).pool as never)()).toBe(false);
 const active={...descriptor,phase:'active' as const};expect(await createHostedDemoAccessProbe(active,fixture(true,false).pool as never)()).toBe(false);
 const f=fixture();expect(await createHostedDemoAccessProbe(active,f.pool as never)()).toBe(true);expect(f.query.mock.calls.some(([sql,values])=>sql.includes('agent_demo_runs')&&JSON.stringify(values)===JSON.stringify(['org','owner',descriptor.runId,descriptor.integrationId,descriptor.configurationReference]))).toBe(true);
});

it('revokes active service access when the owner disables hosted registration, even while the original run row still exists',async()=>{
 const active={...descriptor,phase:'active' as const},f=fixture(true,true,false);expect(await createHostedDemoAccessProbe(active,f.pool as never)()).toBe(false);expect(f.query.mock.calls.some(([sql,values])=>sql.includes('SELECT public.agent_hosted_demo_access_ready')&&JSON.stringify(values)===JSON.stringify([descriptor.runId,descriptor.integrationId,descriptor.configurationReference]))).toBe(true);expect(f.query.mock.calls.map(([sql])=>sql).join('\n')).not.toMatch(/communications_lock_send_gate|FOR UPDATE/);
 const absent=fixture();absent.query.mockImplementation(async sql=>({rows:sql.includes('current_user')?[{active_role:'acquire_campaign_user',rolsuper:false,rolbypassrls:false}]:sql.includes('FROM public.member')?[{allowed:true}]:sql.includes('agent_demo_runs')?[{id:'registered'}]:[]}));expect(await createHostedDemoAccessProbe(active,absent.pool as never)()).toBe(false);
});

it('logs only the failed access stage and allowlisted SQLSTATE',async()=>{
 vi.stubEnv('AGENT_VERBOSE_LOGGING','true');const log=vi.spyOn(console,'warn').mockImplementation(()=>{}),f=fixture(),original=f.query.getMockImplementation()!;
 f.query.mockImplementation(async(sql,values)=>{if(sql.includes('FROM public.member'))throw Object.assign(Error('PRIVATE'),{code:'57014'});return original(sql,values);});
 try{await expect(createHostedDemoAccessProbe(descriptor,f.pool as never)()).rejects.toThrow('Hosted access unavailable');expect(log).toHaveBeenCalledWith('hosted-demo-failure',JSON.stringify({boundary:'access.membership',sqlState:'57014'}));expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE');}finally{log.mockRestore();vi.unstubAllEnvs();}
});
it('logs a stalled pool deadline even before a connection arrives',async()=>{
 vi.useFakeTimers();vi.stubEnv('AGENT_VERBOSE_LOGGING','true');const log=vi.spyOn(console,'warn').mockImplementation(()=>{}),f=fixture();f.pool.connect.mockImplementationOnce(()=>new Promise(()=>{}));
 try{const failure=expect(createHostedDemoAccessProbe(descriptor,f.pool as never)()).rejects.toThrow('Hosted access unavailable');await vi.advanceTimersByTimeAsync(5000);await failure;expect(log).toHaveBeenCalledWith('hosted-demo-failure',JSON.stringify({boundary:'access.pool'}));}finally{log.mockRestore();vi.unstubAllEnvs();}
});
