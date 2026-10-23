import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {emptyBrief} from '@/domain/acquisition';
const mock=vi.hoisted(()=>({session:vi.fn(),create:vi.fn(),start:vi.fn(),cached:vi.fn(),pool:{}}));
vi.mock('@/lib/auth',()=>({auth:{api:{getSession:mock.session}}}));
vi.mock('@/lib/agent-runtime',()=>({nativeAgentEnabled:()=>process.env.AGENT_NATIVE_EXECUTION_ENABLED==='true',agentPool:()=>mock.pool}));
vi.mock('@/lib/agent-native-create',async original=>({...await original<typeof import('@/lib/agent-native-create')>(),createNativeAgentMandate:mock.create}));
vi.mock('@/lib/agent-initial-research',()=>({ensureInitialMandateResearch:mock.start}));
vi.mock('@/lib/create-cached-demo',()=>({createCachedDemo:mock.cached}));
import {POST} from './route';
const requestId='00000000-0000-4000-8000-000000000001',input={requestId,brief:emptyBrief()},url='http://localhost/api/mandates/agent';
const request=(body:unknown=input,origin='http://localhost')=>new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('AGENT_NATIVE_EXECUTION_ENABLED','true');mock.session.mockResolvedValue({session:{activeOrganizationId:'owned-org'},user:{id:'owned-user'}});mock.create.mockResolvedValue({id:requestId,revision:'42',replayed:false});});afterEach(()=>vi.unstubAllEnvs());
it('saves intent and starts the shared research action before returning the chat destination',async()=>{mock.create.mockResolvedValueOnce({id:requestId,revision:'42',replayed:false,initialResearch:{version:1,requestId,creationRevision:'42'}});mock.start.mockResolvedValueOnce({requestId,jobId:requestId,status:'queued'});const response=await POST(request());expect(response.status).toBe(201);expect(await response.json()).toMatchObject({id:requestId,revision:'42',initialResearch:{requestId,jobId:requestId,status:'queued'}});expect(mock.create).toHaveBeenCalledWith(mock.pool,{organizationId:'owned-org',userId:'owned-user'},input,{startResearch:true,startOn:'chat'});expect(mock.start).toHaveBeenCalledWith(mock.pool,{organizationId:'owned-org',userId:'owned-user'},requestId);expect(response.headers.get('Cache-Control')).toContain('no-store');});
it('blocks disabled, foreign-origin, malformed and supplied-actor requests before saving',async()=>{vi.stubEnv('AGENT_NATIVE_EXECUTION_ENABLED','false');expect((await POST(request())).status).toBe(404);vi.stubEnv('AGENT_NATIVE_EXECUTION_ENABLED','true');expect((await POST(request(input,'https://foreign.invalid'))).status).toBe(403);for(const value of [{...input,userId:'other'},{...input,approved:true},{...input,requestId:'no'},{...input,brief:null}])expect((await POST(request(value))).status).toBe(400);expect(mock.create).not.toHaveBeenCalled();});
it('requires a selected signed-in organisation and hides unexpected storage details',async()=>{mock.session.mockResolvedValueOnce(null);expect((await POST(request())).status).toBe(401);mock.create.mockRejectedValue(Error('secret database'));const response=await POST(request());expect(response.status).toBe(503);expect(await response.text()).not.toContain('secret');});

it('accepts explicit demo creation without accepting caller-supplied identities or sender authority',async()=>{
 const demo={...input,executionMode:'demo'};
 mock.cached.mockResolvedValueOnce({id:requestId,revision:'42',replayed:false,initialResearch:{source:'cached',status:'complete'}});
 expect((await POST(request(demo))).status).toBe(201);
 expect(mock.cached).toHaveBeenLastCalledWith(mock.pool,{organizationId:'owned-org',userId:'owned-user'},{requestId},'agent');
 expect(mock.create).not.toHaveBeenCalled();expect(mock.start).not.toHaveBeenCalled();
 for(const body of [{...demo,demoId:requestId},{...demo,bindingId:requestId},{...demo,recipients:[]},{...demo,executionMode:'yolo'}])expect((await POST(request(body))).status).toBe(400);
});

it('reconciles marked creation retries with the same saved handle and leaves historical receipts alone',async()=>{
 mock.create.mockResolvedValueOnce({id:requestId,revision:'42',replayed:true,initialResearch:{version:1,requestId,creationRevision:'42'}});mock.start.mockResolvedValueOnce({requestId,jobId:requestId,status:'running'});
 const response=await POST(request());expect(response.status).toBe(200);expect(await response.json()).toMatchObject({initialResearch:{jobId:requestId,status:'running'}});expect(mock.start).toHaveBeenCalledOnce();
 mock.start.mockClear();mock.create.mockResolvedValueOnce({id:requestId,revision:'42',replayed:true});expect((await POST(request())).status).toBe(200);expect(mock.start).not.toHaveBeenCalled();
});
it('opens the saved chat when launch acknowledgement fails and leaves the same intent for worker recovery',async()=>{
 mock.create.mockResolvedValueOnce({id:requestId,revision:'42',replayed:false,initialResearch:{version:1,requestId,creationRevision:'42'}});mock.start.mockRejectedValueOnce(Error('secret SQL'));
 const response=await POST(request());expect(response.status).toBe(201);const body=await response.json();expect(body).toMatchObject({id:requestId,initialResearch:{requestId,status:'queued'}});expect(body.initialResearch.jobId).toBeUndefined();expect(JSON.stringify(body)).not.toContain('secret');expect(mock.create).toHaveBeenCalledOnce();
});

it('new chat-first mandates wait for Start while keeping their durable research intent',async()=>{
 mock.create.mockResolvedValueOnce({id:requestId,revision:'42',replayed:false,initialResearch:{version:1,requestId,creationRevision:'42',startOn:'chat'}});mock.start.mockResolvedValueOnce({requestId,status:'awaiting_start',source:'live'});
 const r=await POST(request());expect(r.status).toBe(201);expect(await r.json()).toMatchObject({initialResearch:{status:'awaiting_start'}});
});
it('returns JSON503 when session storage is unavailable before native creation',async()=>{mock.session.mockRejectedValueOnce(Error('private session database error'));const r=await POST(request());expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'Sign-in status is temporarily unavailable. Please try again.'});expect(mock.create).not.toHaveBeenCalled();expect(mock.cached).not.toHaveBeenCalled();});
