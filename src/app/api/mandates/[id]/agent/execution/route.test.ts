const workflow=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/acquisition-workflow-research',()=>({findMandateWorkflow:workflow}));
const wake=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/agent-native-wake',()=>({wakeNativeAgentAfterCommit:wake}));
vi.mock('@/lib/agent-start-outreach',()=>({initializeAgentChannelDefaults:vi.fn()}));
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({scope:vi.fn(),state:vi.fn(),open:vi.fn(),control:vi.fn(),begin:vi.fn(),commit:vi.fn(),adopt:vi.fn(),projection:vi.fn()}));
vi.mock('@/lib/agent-request-scope',()=>({agentRequestScope:mock.scope,agentResponseHeaders:{'Cache-Control':'private, no-store'},agentRequestError:(error:string,status:number)=>Response.json({error},{status}),agentRequestFailure:()=>Response.json({error:'Changed or unavailable'},{status:409})}));
vi.mock('@/lib/company-projection-refresh',()=>({refreshCompanyProjectionsBeforeNativeControl:mock.projection}));
vi.mock('@/lib/agent-runtime',()=>({agentPool:()=>({}),nativeAgentEnabled:()=>process.env.AGENT_NATIVE_EXECUTION_ENABLED==='true'}));
import {GET,POST} from './route';
const id='00000000-0000-4000-8000-000000000001',conversationId='00000000-0000-4000-8000-000000000002',requestKey='00000000-0000-4000-8000-000000000003';
const context={params:Promise.resolve({id})},url=`http://localhost/api/mandates/${id}/agent/execution`;
const input={action:'start',requestKey,expectedRevision:0,mandateRevision:'123'};
const request=(body:unknown=input,origin='http://localhost')=>new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const store={executionState:mock.state,openThread:mock.open,controlResponsibility:mock.control,beginConversationHandover:mock.begin,commitConversationHandover:mock.commit,adoptSequenceConversation:mock.adopt};
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('AGENT_NATIVE_EXECUTION_ENABLED','true');mock.scope.mockResolvedValue({actor:{organizationId:'org',userId:'actor'},store,thread:{id:'owned-thread'}});mock.state.mockResolvedValue({mandateRevision:'123',responsibility:null,conversations:[]});mock.control.mockResolvedValue({id,revision:1,status:'ready'});mock.open.mockResolvedValue({id:'new-owned-thread'});});
afterEach(()=>vi.unstubAllEnvs());
it('reads persisted control state without starting work or creating a thread',async()=>{expect((await GET(new Request(url),context)).status).toBe(200);expect(mock.state).toHaveBeenCalledWith('owned-thread');expect(mock.control).not.toHaveBeenCalled();expect(mock.open).not.toHaveBeenCalled();});
it('starts only the session-owned mandate with its exact reviewed revision and replay key',async()=>{const response=await POST(request(),context);expect(response.status).toBe(200);expect(mock.control).toHaveBeenCalledWith('owned-thread',requestKey,{action:'start',expectedRevision:0,mandateRevision:'123'});});
it('creates a thread only for an explicit start after mandate scope is authorised',async()=>{mock.scope.mockResolvedValue({store,thread:undefined});expect((await GET(new Request(url),context)).status).toBe(200);expect(mock.open).not.toHaveBeenCalled();expect((await POST(request({...input,action:'pause'}),context)).status).toBe(404);expect(mock.open).not.toHaveBeenCalled();expect((await POST(request(),context)).status).toBe(200);expect(mock.open).toHaveBeenCalledWith(id);expect(mock.control).toHaveBeenCalledWith('new-owned-thread',requestKey,expect.objectContaining({action:'start'}));});
it('refuses disabled execution, cross-origin requests and caller-supplied actor or send authority',async()=>{vi.stubEnv('AGENT_NATIVE_EXECUTION_ENABLED','false');expect((await POST(request(),context)).status).toBe(404);vi.stubEnv('AGENT_NATIVE_EXECUTION_ENABLED','true');expect((await POST(request(input,'https://foreign.invalid'),context)).status).toBe(403);for(const extra of [{organizationId:'other'},{userId:'other'},{approved:true},{deliveryMode:'communications'},{action:'send'}])expect((await POST(request({...input,...extra}),context)).status).toBe(400);expect(mock.control).not.toHaveBeenCalled();});
it('requires current ownership tokens for explicit handover and never stops an old sequence implicitly',async()=>{const value={conversationId,revision:2,epoch:3,contextRevision:'a'.repeat(64),target:{kind:'human',userId:'owner'},reason:'I will handle this conversation'};expect((await POST(request({action:'handover_begin',requestKey,...value}),context)).status).toBe(200);expect(mock.begin).toHaveBeenCalledWith('owned-thread',requestKey,value);expect(mock.commit).not.toHaveBeenCalled();expect((await POST(request({action:'handover_commit',requestKey,conversationId,revision:3,epoch:4,contextRevision:'b'.repeat(64)}),context)).status).toBe(200);expect(mock.commit).toHaveBeenCalledWith('owned-thread',requestKey,{conversationId,revision:3,epoch:4,contextRevision:'b'.repeat(64)});});
it('preserves scope denials and hides storage errors without claiming completion',async()=>{mock.scope.mockResolvedValue(Response.json({error:'Sign in'},{status:401}));expect((await POST(request(),context)).status).toBe(401);expect(mock.control).not.toHaveBeenCalled();mock.scope.mockResolvedValue({actor:{organizationId:'org',userId:'actor'},store,thread:{id:'owned-thread'}});mock.control.mockRejectedValue(new Error('secret SQL'));const response=await POST(request(),context);expect(response.status).toBe(409);expect(await response.text()).not.toContain('secret');});
it('routes exact human held-resume tokens without treating the command as a mandate-wide resume',async()=>{
 const resume=vi.fn().mockResolvedValue({status:'active'});Object.assign(store,{resumeHeldConversation:resume});const value={conversationId,revision:2,epoch:3,contextRevision:'a'.repeat(64),reason:'I reviewed the resolved email and current history'};expect((await POST(request({action:'resume_held',requestKey,...value}),context)).status).toBe(200);expect(resume).toHaveBeenCalledWith('owned-thread',requestKey,value);expect(mock.control).not.toHaveBeenCalled();expect(mock.begin).not.toHaveBeenCalled();
});
it('queues a separately reviewed person history check and exact fresh reassessment without broad mandate resume',async()=>{const refresh=vi.fn().mockResolvedValue({status:'history_requested'}),reassess=vi.fn().mockResolvedValue({status:'reassessment_requested'});Object.assign(store,{requestConversationReviewHistory:refresh,reassessConversationAfterReview:reassess});const expected={conversationId,revision:4,epoch:5,contextRevision:'c'.repeat(64)};expect((await POST(request({action:'refresh_review_history',requestKey,...expected}),context)).status).toBe(200);expect(refresh).toHaveBeenCalledExactlyOnceWith('owned-thread',requestKey,expected);const reason='I reviewed current history and want a fresh proposal.';expect((await POST(request({action:'reassess_conversation',requestKey,...expected,reason}),context)).status).toBe(200);expect(reassess).toHaveBeenCalledExactlyOnceWith('owned-thread',requestKey,{...expected,reason});for(const value of [{action:'reassess_conversation',requestKey,...expected},{action:'reassess_conversation',requestKey,...expected,reason,approved:true}])expect((await POST(request(value),context)).status).toBe(400);expect(mock.control).not.toHaveBeenCalled();expect(mock.begin).not.toHaveBeenCalled();});

it('refreshes accepted company projections before normal Start/Resume but never during GET or Pause',async()=>{await GET(new Request(url),context);expect(mock.projection).not.toHaveBeenCalled();for(const action of ['start','resume']){await POST(request({...input,action}),context);expect(mock.projection).toHaveBeenLastCalledWith({organizationId:'org',userId:'actor'},id);}expect(mock.projection.mock.invocationCallOrder[0]).toBeLessThan(mock.control.mock.invocationCallOrder[0]);const count=mock.projection.mock.calls.length;await POST(request({...input,action:'pause'}),context);expect(mock.projection).toHaveBeenCalledTimes(count);});
it('blocks Start/Resume if projection preflight fails without invoking scoped control or model/provider work',async()=>{mock.projection.mockRejectedValue(new Error('Source still requires refresh'));expect((await POST(request({...input,action:'resume'}),context)).status).toBe(409);expect(mock.control).not.toHaveBeenCalled();});

it('reports the selected testing service as pending without falling back or starting setup',async()=>{
 vi.stubEnv('AGENT_DEMO_TARGET','testing');mock.state.mockResolvedValue({executionMode:'demo',demoContacts:{prepared:0,stale:0,outreachReady:false},mandateRevision:'123',responsibility:null,conversations:[]});
 const result=await(await GET(new Request(url),context)).json();
 expect(result.demoPreparationEnabled).toBe(false);expect(result.demoService).toMatchObject({communicationsApi:'https://127.0.0.1:5991',ready:false,message:expect.stringContaining('5991')});
 expect(mock.control).not.toHaveBeenCalled();expect(mock.open).not.toHaveBeenCalled();
});
it('does not apply a new demo target to historical prepared recipients',async()=>{
 vi.stubEnv('AGENT_DEMO_TARGET','testing');mock.state.mockResolvedValue({executionMode:'demo',demoContacts:{prepared:50,stale:0,outreachReady:true},mandateRevision:'123',responsibility:null,conversations:[]});
 const result=await(await GET(new Request(url),context)).json();expect(result.demoService).toBeUndefined();
});
it('returns one scoped controls bundle only when requested and never starts work',async()=>{
 const controlsSnapshot=vi.fn().mockResolvedValue({state:{mandateRevision:'123'},inbox:{tasks:[],members:[]},grants:[],targetOptions:{bindings:[]}});
 mock.scope.mockResolvedValue({actor:{organizationId:'org',userId:'actor'},store:{...store,controlsSnapshot},thread:{id:'owned-thread'}});
 const response=await GET(new Request(url,{headers:{'X-Acquire-Control-Snapshot':'1'}}),context);
 expect(response.status).toBe(200);expect(controlsSnapshot).toHaveBeenCalledWith(id,'owned-thread');expect(mock.state).not.toHaveBeenCalled();expect(mock.control).not.toHaveBeenCalled();
 expect(await response.json()).toMatchObject({state:{mandateRevision:'123'},controls:{grants:[],inbox:{tasks:[]}}});
});

it('wakes only after a confirmed control commit, never on rejected or ambiguous failure',async()=>{mock.control.mockRejectedValueOnce(Error('commit response unavailable'));expect((await POST(request(),context)).status).toBe(409);expect(wake).not.toHaveBeenCalled();expect((await POST(request(),context)).status).toBe(200);expect(wake).toHaveBeenCalledOnce();});

it('projects an owned ready demo before a thread exists without creating work',async()=>{
 const controlsSnapshot=vi.fn().mockResolvedValue({state:null,inbox:{tasks:[]},grants:[],targetOptions:{bindings:[]}});
 mock.scope.mockResolvedValue({actor:{organizationId:'org',userId:'actor'},mandate:{revision:'123'},store:{...store,controlsSnapshot},thread:undefined});
 workflow.mockResolvedValue({id:requestKey,mandateId:id,organizationId:'org',ownerUserId:'actor',preset:'demo',presentation:'agent',state:'ready'});
 const result=await(await GET(new Request(url,{headers:{'X-Acquire-Control-Snapshot':'1'}}),context)).json();
 expect(result.state).toMatchObject({executionMode:'demo',workflowPreset:'demo',workflowExecutionId:requestKey,mandateRevision:'123',responsibility:null,conversations:[]});expect(result.controls.state).toEqual(result.state);
 expect(mock.open).not.toHaveBeenCalled();expect(mock.control).not.toHaveBeenCalled();expect(mock.state).not.toHaveBeenCalled();
});
it.each(['missing','foreign','other-mandate'])('does not project %s workflow as an owned demo',async kind=>{
 mock.scope.mockResolvedValue({actor:{organizationId:'org',userId:'actor'},mandate:{revision:'123'},store,thread:undefined});
 workflow.mockResolvedValue(kind==='missing'?undefined:{id:requestKey,mandateId:kind==='other-mandate'?conversationId:id,organizationId:'org',ownerUserId:kind==='foreign'?'other':'actor',preset:'demo',state:'ready'});
 const result=await(await GET(new Request(url),context)).json();expect(result.state).toBeNull();expect(mock.open).not.toHaveBeenCalled();
});

it.each(['accepted','researching','failed','cancelled','uncertain','complete'])('does not offer a pre-thread Start for %s workflow',async state=>{
 mock.scope.mockResolvedValue({actor:{organizationId:'org',userId:'actor'},mandate:{revision:'123'},store,thread:undefined});
 workflow.mockResolvedValue({id:requestKey,mandateId:id,organizationId:'org',ownerUserId:'actor',preset:'demo',state});
 expect((await(await GET(new Request(url),context)).json()).state).toBeNull();expect(mock.open).not.toHaveBeenCalled();
});

it('queues a delivery status check only for the scoped original conversation',async()=>{const recheckDeliveryOutcome=vi.fn().mockResolvedValue({id,revision:2,status:'delivery_check_requested'});mock.scope.mockResolvedValue({store:{...store,recheckDeliveryOutcome},thread:{id:'owned-thread'}});const value={action:'recheck_delivery',requestKey,conversationId,revision:2,epoch:3,contextRevision:'a'.repeat(64)};expect((await POST(request(value),context)).status).toBe(200);expect(recheckDeliveryOutcome).toHaveBeenCalledWith('owned-thread',requestKey,{conversationId,revision:2,epoch:3,contextRevision:'a'.repeat(64)});expect(mock.control).not.toHaveBeenCalled();expect(wake).toHaveBeenCalledOnce();});
it('includes runtime and policy in one authorized controls request without creating work',async()=>{
 vi.stubEnv('AGENT_WORKER_SCOPE_MODE','registered');
 const controlsSnapshot=vi.fn().mockResolvedValue({state:{mandateRevision:'123'},inbox:{tasks:[],members:[]},grants:[],targetOptions:{bindings:[]}}),runtimeReadiness=vi.fn().mockResolvedValue({registered:true,channels:[],budgets:[]}),channelPolicy=vi.fn().mockResolvedValue({policy:{revision:4},accounts:[]});
 mock.scope.mockResolvedValue({actor:{organizationId:'org',userId:'actor'},store:{...store,controlsSnapshot,runtimeReadiness,channelPolicy},thread:{id:'owned-thread'}});
 const response=await GET(new Request(url,{headers:{'X-Acquire-Control-Snapshot':'1'}}),context);
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({controls:{runtime:{readiness:{registered:true},configuration:{scopeMode:'registered'},channelPolicy:{enabled:true,policy:{revision:4}},channelPolicyUnavailable:false}}});
 expect(mock.scope).toHaveBeenCalledExactlyOnceWith(expect.any(Request),context);expect(runtimeReadiness).toHaveBeenCalledExactlyOnceWith('owned-thread');expect(channelPolicy).toHaveBeenCalledExactlyOnceWith('owned-thread');expect(mock.open).not.toHaveBeenCalled();expect(mock.control).not.toHaveBeenCalled();
});


it.each(['accepted','researching','ready','complete','failed','cancelled','uncertain'])('projects read-only research-only status before a thread exists (%s)',async state=>{
 const controlsSnapshot=vi.fn().mockResolvedValue({state:null,inbox:{tasks:[]},grants:[],targetOptions:{bindings:[]}});
 mock.scope.mockResolvedValue({actor:{organizationId:'org',userId:'actor'},mandate:{revision:'123'},store:{...store,controlsSnapshot},thread:undefined});
 workflow.mockResolvedValue({id:requestKey,mandateId:id,organizationId:'org',ownerUserId:'actor',preset:'live-research-test',presentation:'agent',state});
 const result=await(await GET(new Request(url,{headers:{'X-Acquire-Control-Snapshot':'1'}}),context)).json();
 expect(result.state).toMatchObject({executionMode:'real',workflowPreset:'live-research-test',workflowState:state,workflowExecutionId:requestKey,responsibility:null,conversations:[]});
 expect(result.controls.state).toEqual(result.state);expect(mock.open).not.toHaveBeenCalled();expect(mock.control).not.toHaveBeenCalled();expect(wake).not.toHaveBeenCalled();expect(mock.projection).not.toHaveBeenCalled();
});
it.each(['owner','organization','mandate'])('does not expose research-only workflow with mismatched %s',async mismatch=>{
 mock.scope.mockResolvedValue({actor:{organizationId:'org',userId:'actor'},mandate:{revision:'123'},store,thread:undefined});
 workflow.mockResolvedValue({id:requestKey,mandateId:mismatch==='mandate'?conversationId:id,organizationId:mismatch==='organization'?'other':'org',ownerUserId:mismatch==='owner'?'other':'actor',preset:'live-research-test',state:'researching'});
 expect((await(await GET(new Request(url),context)).json()).state).toBeNull();expect(mock.open).not.toHaveBeenCalled();expect(mock.control).not.toHaveBeenCalled();
});
