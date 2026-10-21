import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({session:vi.fn(),execute:vi.fn()}));
vi.mock('@/lib/auth',()=>({auth:{api:{getSession:m.session}}}));
vi.mock('@/lib/acquire-commands',()=>({acquireCommands:{execute:m.execute}}));
import {AcquireCommandError} from '@/domain/acquire-commands';
import {GET,POST} from './route';
const mandateId='00000000-0000-4000-8000-000000000001',reviewId='00000000-0000-4000-8000-000000000002',targetId='00000000-0000-4000-8000-000000000003';
const actor={organizationId:'signed-in-org',userId:'signed-in-user'},context={params:Promise.resolve({id:mandateId})};
const decision={requestKey:'00000000-0000-4000-8000-000000000004',reviewId,expectedRevision:1,previewDigest:'a'.repeat(64),decision:'adopt',selectedTargetId:targetId};
const request=(value:unknown=decision,origin='http://localhost')=>new Request(`http://localhost/api/mandates/${mandateId}/company-identities`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({session:{activeOrganizationId:actor.organizationId},user:{id:actor.userId}});});
it('lists identity reviews through the shared manual/agent boundary using the signed-in actor',async()=>{
 m.execute.mockResolvedValueOnce({name:'company.identity.list',status:'observed',value:{reviews:[]}});
 const response=await GET(new Request(`http://localhost/api/mandates/${mandateId}/company-identities`),context);
 expect(response.status).toBe(200);expect(await response.json()).toEqual({reviews:[]});expect(response.headers.get('Cache-Control')).toContain('no-store');
 expect(m.execute).toHaveBeenCalledWith(actor,{name:'company.identity.list',input:{mandateId}});
});
it('records only the exact displayed human choice with its stable retry key, without accepting source facts',async()=>{
 m.execute.mockResolvedValue({name:'company.identity.decide',status:'completed',value:{reviewId,status:'adopted',targetId}});
 for(let attempt=0;attempt<2;attempt++){const response=await POST(request(),context);expect(response.status).toBe(200);expect(await response.json()).toEqual({decision:{reviewId,status:'adopted',targetId}});}
 expect(m.execute.mock.calls).toEqual([[actor,{name:'company.identity.decide',input:{mandateId,decision}}],[actor,{name:'company.identity.decide',input:{mandateId,decision}}]]);
});
it('blocks foreign origins, forged scope, missing choices and oversized requests before the command',async()=>{
 expect((await POST(request(decision,'https://foreign.invalid'),context)).status).toBe(403);
 for(const extra of [{organizationId:'foreign'},{mandateId:reviewId},{source:{}},{contacts:[]},{approved:true},{mode:'demo'},{send:true}])expect((await POST(request({...decision,...extra}),context)).status).toBe(400);
 const {selectedTargetId:omitted,...noChoice}=decision;void omitted;expect((await POST(request(noChoice),context)).status).toBe(400);
 expect((await POST(request({...decision,extra:'x'.repeat(5000)}),context)).status).toBe(413);
 expect(m.execute).not.toHaveBeenCalled();
});
it('uses the same access gate with native mode disabled and never accepts unauthenticated requests',async()=>{
 m.session.mockResolvedValueOnce(null);expect((await GET(new Request('http://localhost'),context)).status).toBe(401);
 m.session.mockResolvedValueOnce(null);expect((await POST(request(),context)).status).toBe(401);expect(m.execute).not.toHaveBeenCalled();
 m.execute.mockRejectedValueOnce(new AcquireCommandError('Mandate not found',404));expect((await GET(new Request('http://localhost'),context)).status).toBe(404);
});
it('preserves current-CAS denials and hides unexpected storage details',async()=>{
 m.execute.mockRejectedValueOnce(new AcquireCommandError('This identity review changed. Refresh it.',409));const stale=await POST(request(),context);expect(stale.status).toBe(409);expect(await stale.text()).toContain('review changed');
 m.execute.mockRejectedValueOnce(Error('private connection or SQL details'));const unavailable=await POST(request(),context);expect(unavailable.status).toBe(503);expect(await unavailable.text()).not.toContain('private connection');
});

it('consolidates only server-proven duplicates through the shared authenticated command and returns its confirmed count',async()=>{
 m.execute.mockResolvedValue({name:'company.identity.reconcile',status:'completed',value:{resolved:3}});
 const response=await POST(request({action:'reconcile_duplicates'}),context);
 expect(response.status).toBe(200);expect(await response.json()).toEqual({resolved:3});expect(response.headers.get('Cache-Control')).toContain('no-store');
 expect(m.execute).toHaveBeenCalledExactlyOnceWith(actor,{name:'company.identity.reconcile',input:{mandateId}});
});
it('rejects forged duplicate scope/choices and retains auth, origin and storage-failure boundaries',async()=>{
 for(const extra of [{targetId},{organizationId:'foreign'},{mandateId:reviewId},{approved:true},{decision:'adopt'}])expect((await POST(request({action:'reconcile_duplicates',...extra}),context)).status).toBe(400);
 expect((await POST(request({action:'reconcile_duplicates'},'https://foreign.invalid'),context)).status).toBe(403);expect(m.execute).not.toHaveBeenCalled();
 m.session.mockResolvedValueOnce(null);expect((await POST(request({action:'reconcile_duplicates'}),context)).status).toBe(401);expect(m.execute).not.toHaveBeenCalled();
 m.execute.mockRejectedValueOnce(Error('private SQL trace'));const failed=await POST(request({action:'reconcile_duplicates'}),context);expect(failed.status).toBe(503);expect(await failed.text()).not.toContain('private SQL');
});
