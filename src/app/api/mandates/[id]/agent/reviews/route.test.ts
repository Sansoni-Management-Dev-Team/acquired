const wake=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/agent-native-wake',()=>({wakeNativeAgentAfterCommit:wake}));
import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({session:vi.fn(),execute:vi.fn(),store:vi.fn(),find:vi.fn(),list:vi.fn(),decide:vi.fn(),edit:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:{api:{getSession:mocks.session}}}));
vi.mock('@/lib/acquire-commands',()=>({acquireCommands:{execute:mocks.execute}}));
vi.mock('@/lib/agent-runtime',()=>({durableAgentEnabled:()=>true,agentStore:mocks.store}));
import {GET,POST} from './route';
const id='00000000-0000-4000-8000-000000000001',batchId='00000000-0000-4000-8000-000000000002';
const item={operationId:'00000000-0000-4000-8000-000000000003',revision:1,digest:'a'.repeat(64),contextRevision:'context'};
const context={params:Promise.resolve({id})};
const input={action:'decide',batchId,revision:1,items:[item],decision:'approved'};
const request=(body:unknown=input,origin='http://localhost')=>new Request(`http://localhost/api/mandates/${id}/agent/reviews`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('AGENT_MODE_EXPLORATION_ENABLED','true');mocks.session.mockResolvedValue({user:{id:'user'},session:{activeOrganizationId:'org'}});mocks.execute.mockResolvedValue({});mocks.store.mockReturnValue({findThread:mocks.find,listReviewBatches:mocks.list,decideReviewBatch:mocks.decide,editEmailReview:mocks.edit});mocks.find.mockResolvedValue({id:'owned-thread'});mocks.list.mockResolvedValue([]);mocks.decide.mockResolvedValue({id:batchId,state:'approved'});});
it('authorises every request and derives ownership from the current session',async()=>{
 const response=await POST(request(),context);expect(response.status).toBe(200);
 expect(mocks.execute).toHaveBeenCalledWith({organizationId:'org',userId:'user'},{name:'mandate.read',input:{mandateId:id}});
 expect(mocks.decide).toHaveBeenCalledWith('owned-thread',batchId,1,[item],'approved');
});
it('does not read or decide unauthenticated or cross-origin reviews',async()=>{
 expect((await POST(request(input,'https://foreign.invalid'),context)).status).toBe(403);expect(mocks.store).not.toHaveBeenCalled();
 mocks.session.mockResolvedValue(null);expect((await POST(request(),context)).status).toBe(401);expect(mocks.decide).not.toHaveBeenCalled();
});
it('rejects injected authority, tool results and arbitrary mutation fields',async()=>{
 for(const injected of [{organizationId:'other'},{approvedBy:'other'},{grant:{mode:'yolo'}},{action:'send'},{decision:'execute'}])expect((await POST(request({...input,...injected}),context)).status).toBe(400);
 expect(mocks.decide).not.toHaveBeenCalled();
});
it('keeps review refresh read-only and private when there is no saved thread',async()=>{
 mocks.find.mockResolvedValue(undefined);const response=await GET(new Request('http://localhost'),context);
 expect(response.headers.get('Cache-Control')).toContain('no-store');expect(await response.json()).toEqual({batches:[]});expect(mocks.list).not.toHaveBeenCalled();
});
it('applies a bounded edit using the canonical thread and expected operation revision',async()=>{
 const response=await POST(request({action:'edit',batchId,operationId:item.operationId,revision:1,body:'Human edit'}),context);
 expect(response.status).toBe(200);expect(mocks.edit).toHaveBeenCalledWith('owned-thread',batchId,item.operationId,1,'Human edit');expect(mocks.decide).not.toHaveBeenCalled();
});
it('reports stale state as conflict without leaking SQL or claiming a send',async()=>{
 mocks.decide.mockRejectedValue(new Error('secret raw SQL'));const response=await POST(request(),context);
 expect(response.status).toBe(409);expect(await response.text()).not.toContain('secret');
});
it('serves pending review work rather than a recent history page that can hide older approvals',async()=>{mocks.list.mockImplementation(async(_thread,options)=>options?.pendingOnly?[{id:'older-pending',state:'pending'}]:[{id:'new-approved',state:'approved'}]);const response=await GET(new Request('http://localhost'),context);expect(response.status).toBe(200);expect((await response.json()).batches).toEqual([{id:'older-pending',state:'pending'}]);expect(mocks.list).toHaveBeenCalledWith('owned-thread',{pendingOnly:true});expect(response.headers.get('Cache-Control')).toContain('no-store');});
it('records automatic demo approval attribution without changing the exact review manifest',async()=>{
 expect((await POST(request({...input,approvalSource:'automatic_demo'}),context)).status).toBe(200);
 expect(mocks.decide).toHaveBeenCalledWith('owned-thread',batchId,1,[item],'approved','automatic_demo');
 expect((await POST(request({...input,approvalSource:'anything'}),context)).status).toBe(400);
});

it('wakes only after approved review commit, never rejection or uncertain commit response',async()=>{mocks.decide.mockRejectedValueOnce(Error('ambiguous commit response'));expect((await POST(request(),context)).status).toBe(409);expect(wake).not.toHaveBeenCalled();expect((await POST(request({...input,decision:'rejected'}),context)).status).toBe(200);expect(wake).not.toHaveBeenCalled();expect((await POST(request(),context)).status).toBe(200);expect(wake).toHaveBeenCalledOnce();});
