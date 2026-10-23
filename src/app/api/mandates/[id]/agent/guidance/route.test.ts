import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({scope:vi.fn(),list:vi.fn(),propose:vi.fn(),decide:vi.fn(),edit:vi.fn(),feedback:vi.fn(),manual:vi.fn(),open:vi.fn()}));
vi.mock('@/lib/agent-request-scope',()=>({agentRequestScope:mocks.scope,agentResponseHeaders:{'Cache-Control':'private, no-store'},agentRequestError:(message:string,status:number)=>Response.json({error:message},{status}),agentRequestFailure:()=>Response.json({error:'Changed'},{status:409})}));
import {GET,POST} from './route';
const id='00000000-0000-4000-8000-000000000001',context={params:Promise.resolve({id})};
const candidate={text:'Prefer recurring maintenance.',category:'qualification',sourceMessageId:id,triggerTerms:[]};
const request=(value:unknown,origin='http://localhost')=>new Request('http://localhost/api/guidance',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('AGENT_GUIDANCE_ENABLED','true');mocks.scope.mockResolvedValue({thread:{id:'owned'},store:{listGuidance:mocks.list,proposeGuidance:mocks.propose,decideGuidance:mocks.decide,editGuidance:mocks.edit,captureFeedback:mocks.feedback,captureManualFeedback:mocks.manual,openThread:mocks.open}});mocks.list.mockResolvedValue([]);});
it('saves a candidate without silently approving it',async()=>{
 expect((await POST(request({action:'propose',requestKey:'key',input:candidate}),context)).status).toBe(200);expect(mocks.propose).toHaveBeenCalledWith('owned','key',candidate);expect(mocks.decide).not.toHaveBeenCalled();
});
it('requires a separate explicit confirmation of the displayed revision',async()=>{
 expect((await POST(request({action:'decide',id,revision:2,decision:'approved'}),context)).status).toBe(400);
 expect((await POST(request({action:'decide',id,revision:2,decision:'approved',confirmed:true}),context)).status).toBe(200);
 expect(mocks.decide).toHaveBeenCalledWith('owned',id,2,'approved');
});
it('has its own flag and rejects injected approvals or cross-origin writes',async()=>{
 expect((await POST(request({action:'propose',requestKey:'key',input:{...candidate,approved:true}}),context)).status).toBe(400);
 expect((await POST(request({},'https://other.invalid'),context)).status).toBe(403);
 vi.stubEnv('AGENT_GUIDANCE_ENABLED','false');expect((await GET(new Request('http://localhost'),context)).status).toBe(404);expect(mocks.propose).not.toHaveBeenCalled();
});
it('does not create a thread just to list guidance',async()=>{
 mocks.scope.mockResolvedValue({thread:undefined});expect(await (await GET(new Request('http://localhost'),context)).json()).toEqual({guidance:[]});expect(mocks.list).not.toHaveBeenCalled();
});

it('captures exact version feedback without accepting client source snapshots or approving guidance',async()=>{
 const input={source:{kind:'operation',id,revision:3},reason:'This draft is too pushy.',preference:'Use a conversational tone.',category:'tone'};
 expect((await POST(request({action:'feedback',requestKey:'feedback-key',input}),context)).status).toBe(200);
 expect(mocks.feedback).toHaveBeenCalledWith('owned','feedback-key',input);expect(mocks.decide).not.toHaveBeenCalled();
 expect((await POST(request({action:'feedback',requestKey:'feedback-key',input:{...input,source:{...input.source,digest:'a'.repeat(64)}}}),context)).status).toBe(400);
});

it('records manual feedback from an exact saved review without starting supervision',async()=>{
 const input={source:{kind:'target_review',targetId:id,revision:2},reason:'Installation work dominates.',preference:'Prefer recurring maintenance.',category:'qualification'};
 expect((await POST(request({action:'manualFeedback',requestKey:'manual-key',input}),context)).status).toBe(200);
 expect(mocks.manual).toHaveBeenCalledWith('owned','manual-key',input);expect(mocks.decide).not.toHaveBeenCalled();
 mocks.scope.mockResolvedValue({thread:undefined,mandate:{id},store:{openThread:mocks.open,captureManualFeedback:mocks.manual}});mocks.open.mockResolvedValue({id:'new-owned'});
 expect((await POST(request({action:'manualFeedback',requestKey:'manual-key',input}),context)).status).toBe(200);expect(mocks.open).toHaveBeenCalledWith(id);expect(mocks.manual).toHaveBeenLastCalledWith('new-owned','manual-key',input);
});
