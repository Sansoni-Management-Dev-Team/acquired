import {createHash} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {prepareAgentDemoRecipients} from './agent-demo-client';
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={version:1 as const,demoId:uuid(1),mandateId:uuid(1),organizationId:'text-org',userId:'text-user',requestKey:uuid(2),people:[{sourcePersonId:uuid(3),sourceRevision:'42',sourceFingerprint:'a'.repeat(64)}]};
const config={endpoint:'https://127.0.0.1:5890',adminKey:'private-control-test-key'};
function response(){
 const runId='gui-demo-test',mappings=[{...scope.people[0],simulatorLeadId:'lead-001',email:'lead-001@gui-demo-test.leads.acquire.test',phone:'+999000000000001',linkedin:'https://www.linkedin.com/in/sim-gui-demo-test-lead-001',providerId:'ACo_sim_gui-demo-test_lead-001'}];
 const mappingDigest=createHash('sha256').update(JSON.stringify({version:1,runId,demoId:scope.demoId,organizationId:scope.organizationId,userId:scope.userId,mandateId:scope.mandateId,mappings})).digest('hex');
 return {version:1,runId,demoId:scope.demoId,mappingDigest,mappings,accounts:['email','whatsapp','linkedin'].map(channel=>({channel,providerAccountId:`sim-${runId}-${channel}`,sourceId:`sim-source-${channel}`})),limits:{participants:999,modelCalls:300,perPerson:6,perPersonChannel:2},usage:{participants:1,modelCalls:0,remainingModelCalls:300},replayed:false};
}
it('does not call or require a simulator for a real mandate',async()=>{const fetcher=vi.fn();expect(await prepareAgentDemoRecipients('real',scope,null,fetcher)).toEqual({kind:'real'});expect(fetcher).not.toHaveBeenCalled();});
it('sends only bounded source metadata with a distinct admin credential and verifies the returned mock identities',async()=>{
 const fetcher=vi.fn(async()=>Response.json(response()));const result=await prepareAgentDemoRecipients('demo',scope,config,fetcher);
 expect(result).toMatchObject({kind:'demo',result:{runId:'gui-demo-test',mappings:[{sourcePersonId:uuid(3)}]}});
 expect(fetcher).toHaveBeenCalledOnce();const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
 expect(url).toBe('https://127.0.0.1:5890/sim/v1/demo/participants');expect(init).toMatchObject({method:'POST',redirect:'error',headers:{Authorization:`Bearer ${config.adminKey}`}});
 expect(JSON.parse(init.body as string)).toEqual(scope);expect(init.signal).toBeInstanceOf(AbortSignal);
});
it('rejects source contact data and missing or nonlocal control configuration before a request',async()=>{
 const fetcher=vi.fn();for(const bad of [null,{...config,endpoint:'https://provider.example.invalid'},{...config,endpoint:'http://127.0.0.1:5890'},{...config,endpoint:'https://127.0.0.1:5890/other'},{...config,endpoint:'https://user:pass@127.0.0.1:5890'}])await expect(prepareAgentDemoRecipients('demo',scope,bad,fetcher)).rejects.toThrow('Demo recipients are unavailable');
 for(const bad of [{...scope,email:'real@example.com'},{...scope,people:[{...scope.people[0],phone:'+61400000000'}]},{...scope,demoId:uuid(9)},{...scope,people:[scope.people[0],scope.people[0]]}])await expect(prepareAgentDemoRecipients('demo',bad,config,fetcher)).rejects.toThrow('Invalid demo recipient request');
 expect(fetcher).not.toHaveBeenCalled();
});
it('never accepts real contact routes, another run or substituted accounts as simulated recipients',async()=>{
 const changes=[(r:ReturnType<typeof response>)=>{r.mappings[0].email='real@example.com'},(r:ReturnType<typeof response>)=>{r.mappings[0].phone='+61400000000'},(r:ReturnType<typeof response>)=>{r.mappings[0].linkedin='https://www.linkedin.com/in/real-person'},(r:ReturnType<typeof response>)=>{r.mappings[0].sourceRevision='43'},(r:ReturnType<typeof response>)=>{r.demoId=uuid(8)},(r:ReturnType<typeof response>)=>{r.accounts[0].providerAccountId='real-account'},(r:ReturnType<typeof response>)=>{r.mappingDigest='b'.repeat(64)},(r:ReturnType<typeof response>)=>{r.limits.modelCalls=301}];
 for(const change of changes){const r=response();change(r);await expect(prepareAgentDemoRecipients('demo',scope,config,vi.fn(async()=>Response.json(r)))).rejects.toThrow('Demo recipients could not be verified');}
});
it('retains the request key on explicit retry and never retries or exposes remote error bodies itself',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(new Response('private remote error',{status:503})).mockResolvedValueOnce(Response.json({...response(),replayed:true}));
 await expect(prepareAgentDemoRecipients('demo',scope,config,fetcher)).rejects.toThrow('Demo recipients are unavailable');expect(fetcher).toHaveBeenCalledTimes(1);
 expect(await prepareAgentDemoRecipients('demo',scope,config,fetcher)).toMatchObject({kind:'demo',result:{replayed:true}});
 expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
});

it('refuses a valid mapping receipt from a different run than the selected testing descriptor',async()=>{
 const selected={...config,endpoint:'https://127.0.0.1:5990',expectedRunId:'agent-deep-gui-test'};
 await expect(prepareAgentDemoRecipients('demo',scope,selected,vi.fn(async()=>Response.json(response())))).rejects.toThrow('Demo recipients could not be verified');
});

it('returns a safe non-transient error for a refused saved demo source instead of suggesting endless retries',async()=>{
 const failure=prepareAgentDemoRecipients('demo',scope,config,vi.fn(async()=>Response.json({code:'demo_source_changed',private:'must not reach the browser'},{status:409})));
 await expect(failure).rejects.toMatchObject({name:'AgentDemoRecipientError',status:409,reason:'source_conflict'});
 await expect(failure).rejects.not.toThrow(/Retry|private|must not reach/);
});
