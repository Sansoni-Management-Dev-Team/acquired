import{beforeEach,expect,it,vi}from'vitest';
const m=vi.hoisted(()=>({root:vi.fn(),tick:vi.fn()}));
vi.mock('@/db/client',()=>({requireDb:()=>({select:()=>({from:()=>({where:()=>({limit:m.root})})})})}));
vi.mock('./company-people-research',()=>({tickCompanyPeople:m.tick}));
import{continueCompanyPeople}from'./company-people-continuation';
const rootId='00000000-0000-4000-8000-000000000001',targetId='00000000-0000-4000-8000-000000000002';
const run={id:'run',trigger:'discovery',requestKey:`discovery:${rootId}:${targetId}`,targetId,organizationId:'org',actorId:'owner'};
beforeEach(()=>{vi.clearAllMocks();m.root.mockResolvedValue([{id:rootId,organizationId:'org',createdBy:'owner',workflowExecutionId:null,config:{completionPolicy:'work-items',companyPeopleRunIds:['run']}}]);});
it('immediately advances the exact originating queue after a completed company check',async()=>{await continueCompanyPeople(run);expect(m.tick).toHaveBeenCalledOnce();expect(m.tick.mock.calls[0][0].id).toBe(rootId);});
it.each(['native','unlinked','historical','missing'])('cannot transfer a completion into %s work',async kind=>{
 const root=(await m.root())[0];if(kind==='native')root.config.nativeAgent={version:1};if(kind==='unlinked')root.config.companyPeopleRunIds=['other'];if(kind==='historical')delete root.config.completionPolicy;m.root.mockResolvedValue(kind==='missing'?[]:[root]);await continueCompanyPeople(run);expect(m.tick).not.toHaveBeenCalled();
});
it('ignores a changed target and manual refresh before reading a root',async()=>{await continueCompanyPeople({...run,targetId:rootId});await continueCompanyPeople({...run,trigger:'people'});expect(m.root).not.toHaveBeenCalled();expect(m.tick).not.toHaveBeenCalled();});
