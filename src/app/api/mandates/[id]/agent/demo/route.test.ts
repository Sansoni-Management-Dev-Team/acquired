vi.mock('@/lib/acquisition-workflow-research',()=>({findMandateWorkflow:m.workflow}));
vi.mock('@/lib/company-projection-refresh',()=>({refreshCompanyProjectionsBeforeNativeControl:m.refresh}));
vi.mock('@/lib/agent-native-wake',()=>({wakeNativeAgentAfterCommit:m.wake}));
import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const m=vi.hoisted(()=>({native:true,scope:vi.fn(),command:vi.fn(),start:vi.fn(),workflow:vi.fn(),refresh:vi.fn(),wake:vi.fn()}));
vi.mock('@/lib/agent-start-outreach',async original=>({...await original<typeof import('@/lib/agent-start-outreach')>(),startAgentOutreach:m.start}));
vi.mock('@/lib/agent-runtime',()=>({agentPool:()=>({}),nativeAgentEnabled:()=>m.native}));
vi.mock('@/lib/agent-demo-command',()=>({prepareMandateDemoContacts:m.command}));
vi.mock('@/lib/agent-request-scope',()=>({agentRequestScope:m.scope,agentResponseHeaders:{'Cache-Control':'private, no-store'},agentRequestError:(error:string,status:number)=>Response.json({error},{status,headers:{'Cache-Control':'private, no-store'}})}));
import {AgentDemoProvisioningError} from '@/db/agent-demo-provisioning-store';
import {POST} from './route';
const mandate='00000000-0000-4000-8000-000000000001',requestKey='00000000-0000-4000-8000-000000000002',actor={organizationId:'signed-in-org',userId:'signed-in-user'},context={params:Promise.resolve({id:mandate})};
const config={control:{endpoint:'https://127.0.0.1:5890',adminKey:'test-private-admin-key'},selection:{runId:'agent-real-research-demos',integrationId:'sim-agent-real-research-demos',configurationReference:'sim-agent-real-research-demos-v1'}};
const request=(value:unknown={requestKey},origin='http://localhost')=>new Request(`http://localhost/api/mandates/${mandate}/agent/demo`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
beforeEach(()=>{vi.clearAllMocks();m.native=true;m.scope.mockResolvedValue({actor});m.command.mockResolvedValue({kind:'demo',prepared:4,outreachReady:false,replayed:false});});
it('uses authenticated ownership and server configuration, returning preparation without sending authority',async()=>{
 const r=await POST(request(),context);expect(r.status).toBe(200);expect(await r.json()).toEqual({prepared:4,outreachReady:false,replayed:false});
 expect(m.command).toHaveBeenCalledWith(actor,mandate,requestKey);
 expect(r.headers.get('Cache-Control')).toContain('no-store');
});
it('does not accept browser-supplied source contacts, aliases, mode, actor or service destination',async()=>{
 for(const extra of [{mode:'demo'},{organizationId:'foreign'},{people:[]},{email:'real@example.com'},{endpoint:'https://other.invalid'},{bindingId:mandate}])expect((await POST(request({requestKey,...extra}),context)).status).toBe(400);
 expect(m.command).not.toHaveBeenCalled();expect(m.scope).not.toHaveBeenCalled();
});
it('keeps disabled, foreign-origin and unauthenticated requests away from preparation',async()=>{
 m.native=false;expect((await POST(request(),context)).status).toBe(404);m.native=true;expect((await POST(request({requestKey},'https://foreign.invalid'),context)).status).toBe(403);
 m.scope.mockResolvedValueOnce(new Response('Sign in',{status:401}));expect((await POST(request(),context)).status).toBe(401);expect(m.command).not.toHaveBeenCalled();
});
it('reports a shared command configuration refusal without exposing its private authority',async()=>{m.command.mockRejectedValueOnce(new AgentDemoProvisioningError('The separate demo service is not ready.',503));const r=await POST(request(),context);expect(r.status).toBe(503);expect(await r.text()).not.toContain(config.control.adminKey);});
it('preserves a typed real-mode/CAS refusal and hides unexpected storage details',async()=>{
 m.command.mockResolvedValueOnce({kind:'real'});const denied=await POST(request(),context);expect(denied.status).toBe(409);expect(await denied.text()).toContain('Real mandates');
 m.command.mockRejectedValueOnce(Error('private credentials or SQL'));const unavailable=await POST(request(),context);expect(unavailable.status).toBe(503);expect(await unavailable.text()).not.toContain('private credentials');
});

it('one-click Start passes only owned server state and the request key into the shared preparation command',async()=>{
 vi.stubEnv('AGENT_WORKER_SCOPE_MODE','registered');const store={};m.scope.mockResolvedValueOnce({actor,store,thread:{id:mandate}});m.start.mockResolvedValueOnce({status:'proposed'});
 try{const r=await POST(request({action:'start',requestKey}),context);expect(r.status).toBe(200);expect(await r.json()).toEqual({result:{status:'proposed'}});expect(m.start).toHaveBeenCalledWith({actor,store,threadId:mandate,mandateId:mandate,requestKey,prepare:m.command});expect(m.command).not.toHaveBeenCalled();}finally{vi.unstubAllEnvs();}
});
it('does not start outreach without a registered runtime and owned supervision thread',async()=>{
 for(const mode of ['exact','registered']){vi.stubEnv('AGENT_WORKER_SCOPE_MODE',mode);m.scope.mockResolvedValueOnce({actor,store:{},thread:null});expect((await POST(request({action:'start',requestKey}),context)).status).toBe(409);}expect(m.start).not.toHaveBeenCalled();vi.unstubAllEnvs();
});

it('keeps a safe permanent preparation refusal instead of telling the user to press Start repeatedly',async()=>{
 const {AgentDemoRecipientError}=await import('@/lib/agent-demo-client');
 m.command.mockRejectedValueOnce(new AgentDemoRecipientError('source_conflict'));
 const result=await POST(request(),context);
 expect(result.status).toBe(409);expect(await result.json()).toEqual({error:'This demo could not be prepared. Your saved companies and people are still available; no outreach has started.'});
});

it('bootstraps an owned ready demo and recovers an opened thread with no responsibility using one stable control key',async()=>{
 vi.stubEnv('AGENT_WORKER_SCOPE_MODE','registered');
 const store={openThread:vi.fn().mockResolvedValue({id:mandate}),executionState:vi.fn().mockResolvedValue({executionMode:'demo',workflowExecutionId:requestKey,mandateRevision:'123',responsibility:null}),controlResponsibility:vi.fn()};
 m.workflow.mockResolvedValue({id:requestKey,mandateId:mandate,organizationId:actor.organizationId,ownerUserId:actor.userId,preset:'demo',state:'ready'});
 m.scope.mockResolvedValue({actor,store});expect((await POST(request({requestKey,action:'start'}),context)).status).toBe(200);
 const key=store.controlResponsibility.mock.calls[0][1];expect(key).not.toBe(requestKey);expect(store.controlResponsibility).toHaveBeenCalledWith(mandate,key,{action:'start',expectedRevision:0,mandateRevision:'123'});
 m.scope.mockResolvedValue({actor,store,thread:{id:mandate}});expect((await POST(request({requestKey,action:'start'}),context)).status).toBe(200);expect(store.controlResponsibility.mock.calls[1][1]).toBe(key);expect(store.openThread).toHaveBeenCalledOnce();
 store.executionState.mockResolvedValue({...await store.executionState(),responsibility:{state:'ready'} as never});await POST(request({requestKey,action:'start'}),context);expect(store.controlResponsibility).toHaveBeenCalledTimes(2);
 vi.unstubAllEnvs();
});
it.each(['foreign','failed','live-research-test'])('does not bootstrap %s workflow',async kind=>{
 vi.stubEnv('AGENT_WORKER_SCOPE_MODE','registered');const openThread=vi.fn();m.scope.mockResolvedValue({actor,store:{openThread}});
 m.workflow.mockResolvedValue({id:requestKey,mandateId:mandate,organizationId:actor.organizationId,ownerUserId:kind==='foreign'?'other':actor.userId,preset:kind==='live-research-test'?kind:'demo',state:kind==='failed'?kind:'ready'});
 expect((await POST(request({requestKey,action:'start'}),context)).status).toBe(409);expect(openThread).not.toHaveBeenCalled();vi.unstubAllEnvs();
});
it('does not continue after an uncertain bootstrap control result or auto-resume an existing paused responsibility',async()=>{
 vi.stubEnv('AGENT_WORKER_SCOPE_MODE','registered');
 const state={executionMode:'demo',workflowExecutionId:requestKey,mandateRevision:'123',responsibility:null};
 const store={executionState:vi.fn().mockResolvedValue(state),controlResponsibility:vi.fn().mockRejectedValue(Error('commit response unavailable'))};
 m.workflow.mockResolvedValue({id:requestKey,mandateId:mandate,organizationId:actor.organizationId,ownerUserId:actor.userId,preset:'demo',state:'ready'});m.scope.mockResolvedValue({actor,store,thread:{id:mandate}});
 expect((await POST(request({requestKey,action:'start'}),context)).status).toBe(503);expect(m.start).not.toHaveBeenCalled();expect(m.wake).not.toHaveBeenCalled();
 store.controlResponsibility.mockClear();store.executionState.mockResolvedValue({...state,responsibility:{state:'paused'}});await POST(request({requestKey,action:'start'}),context);expect(store.controlResponsibility).not.toHaveBeenCalled();
 vi.unstubAllEnvs();
});
it('preserves a projection refresh conflict as409 instead of generic503',async()=>{const{AcquireCommandError}=await import('@/domain/acquire-commands');m.command.mockRejectedValueOnce(new AcquireCommandError('Company evidence needs a current refresh before starting or resuming supervision.',409));const r=await POST(request(),context);expect(r.status).toBe(409);expect(await r.json()).toEqual({error:'Company evidence needs a current refresh before starting or resuming supervision.'});});
