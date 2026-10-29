import {beforeEach,expect,it,vi} from 'vitest';
import type {ResearchRepository} from '@/db/research-repository';
const mock=vi.hoisted(()=>({background:vi.fn(),people:vi.fn(),schedule:vi.fn(),worker:vi.fn(),recover:vi.fn()}));
vi.mock('./company-background-dispatch',()=>({dispatchCompanyBackground:mock.background}));
vi.mock('./company-people-research',()=>({tickCompanyPeople:mock.people}));
vi.mock('./research-scheduler',()=>({scheduleResearchRun:mock.schedule}));
vi.mock('./research-service',()=>({researchWorker:mock.worker}));
import {maintainMandateResearch} from './research-maintenance';
type Jobs=Awaited<ReturnType<ResearchRepository['listReview']>>;
const job=(value:Record<string,unknown>)=>({organizationId:'org',createdBy:'owner',workflowExecutionId:null,id:'root',status:'queued',revision:1,pages:0,updatedAt:new Date(),config:{},...value}) as Jobs[number];
beforeEach(()=>{vi.resetAllMocks();mock.background.mockResolvedValue(0);mock.schedule.mockResolvedValue(false);});
it('never terminates an owned finite workload merely because its last update is old',async()=>{
 mock.worker.mockResolvedValue({status:'waiting'});
 await maintainMandateResearch('org','mandate',[job({updatedAt:new Date(0),config:{completionPolicy:'work-items',mode:'automatic',researchRunId:'root',automaticDeadline:1}})],{recoverStopped:mock.recover});
 expect(mock.worker.mock.calls.every(([,method])=>method==='GET')).toBe(true);expect(mock.recover).not.toHaveBeenCalled();
});
it('resumes the existing checkpoint only when ownership reports a recoverable stopped workflow',async()=>{
 mock.worker.mockResolvedValueOnce({status:'errored',recoverable:true}).mockResolvedValueOnce({recovered:true});
 await maintainMandateResearch('org','mandate',[job({updatedAt:new Date(0),config:{completionPolicy:'work-items'}})],{recoverStopped:mock.recover});
 expect(mock.worker).toHaveBeenCalledWith('/jobs/root','POST',{action:'resume'},expect.any(Number));expect(mock.recover).not.toHaveBeenCalled();
});
it('awaits persisted background dispatch when invoked without a browser defer callback',async()=>{
 let release!:()=>void;mock.background.mockReturnValue(new Promise<void>(resolve=>{release=resolve;}));
 let complete=false;const work=maintainMandateResearch('owned-org','owned-mandate',[job({config:{companyBackgroundResearch:{}}})],{recoverStopped:mock.recover}).then(()=>{complete=true;});
 await Promise.resolve();expect(mock.background).toHaveBeenCalledWith('owned-org','owned-mandate');expect(complete).toBe(false);
 release();await work;expect(complete).toBe(true);
});
it('preserves deferred browser dispatch and never treats an unavailable status endpoint as a stopped job',async()=>{
 const tasks:(()=>Promise<unknown>)[]=[];mock.worker.mockRejectedValue(new Error('Unavailable'));
 expect(await maintainMandateResearch('org','mandate',[job({id:'background',config:{companyBackgroundResearch:{}}}),job({updatedAt:new Date(Date.now()-120000)})],{recoverStopped:mock.recover},task=>{tasks.push(task);})).toBe(false);
 expect(mock.background).not.toHaveBeenCalled();expect(mock.recover).not.toHaveBeenCalled();expect(tasks).toHaveLength(1);
 await tasks[0]();expect(mock.background).toHaveBeenCalledOnce();
});
it.each(['errored','terminated','complete'])('reconciles a stopped worker once with its original revision/pages (%s)',async status=>{
 mock.worker.mockResolvedValue({status});
 expect(await maintainMandateResearch('org','mandate',[job({revision:7,pages:3,updatedAt:new Date(Date.now()-120000)})],{recoverStopped:mock.recover})).toBe(true);
 expect(mock.recover).toHaveBeenCalledExactlyOnceWith('root',7,3);
});
it('does not stop a running worker from a transient status read, and recovers only an explicitly recovered stalled worker',async()=>{
 const stalled=job({updatedAt:new Date(Date.now()-660000)});
 mock.worker.mockResolvedValueOnce({status:'waiting'}).mockResolvedValueOnce({recovered:false});
 await maintainMandateResearch('org','mandate',[stalled],{recoverStopped:mock.recover});expect(mock.recover).not.toHaveBeenCalled();
 mock.worker.mockResolvedValueOnce({status:'running'}).mockResolvedValueOnce({recovered:true});
 await maintainMandateResearch('org','mandate',[stalled],{recoverStopped:mock.recover});expect(mock.recover).toHaveBeenCalledExactlyOnceWith('root',1,0);
});
it.each([undefined,'root'])('recovers both legacy and self-referencing automatic roots (%s)',async researchRunId=>{
 await maintainMandateResearch('org','mandate',[job({config:{mode:'automatic',researchRunId,automaticDeadline:Date.now()+60000}})],{recoverStopped:mock.recover});
 expect(mock.schedule).toHaveBeenCalledExactlyOnceWith('org','root',{recovery:true});
});
it('does not reschedule a settled parallel run or independently schedule its children',async()=>{
 await maintainMandateResearch('org','mandate',[job({status:'partial',config:{mode:'automatic',researchRunId:'root',automaticDeadline:Date.now()+60000,parallelBusinessResearch:true,parallelResearchSettled:true,parallelResearchPendingTasks:0}}),job({id:'child',status:'complete',config:{mode:'automatic',researchRunId:'root'}})],{recoverStopped:mock.recover});
 expect(mock.schedule).not.toHaveBeenCalled();expect(mock.recover).not.toHaveBeenCalled();
});
it.each(['failed','cancelled'])('never revives or queues People for a %s parent, including late active children',async status=>{
 await maintainMandateResearch('org','mandate',[job({status,config:{mode:'automatic',researchRunId:'root',automaticDeadline:Date.now()+60000,includeCompanyPeople:true}}),job({id:'child',config:{mode:'automatic',researchRunId:'root'}})],{recoverStopped:mock.recover});
 expect(mock.schedule).not.toHaveBeenCalled();expect(mock.people).not.toHaveBeenCalled();
});
it.each([undefined,'root'])('continues unfinished People for an already complete legacy/current parent (%s)',async researchRunId=>{
 const parent=job({status:'complete',config:{mode:'automatic',researchRunId,includeCompanyPeople:true,companyPeopleProgress:{settled:false}}});
 await maintainMandateResearch('org','mandate',[parent],{recoverStopped:mock.recover});
 expect(mock.people).toHaveBeenCalledExactlyOnceWith(parent);
});
it('does not dispatch or recover native reviewed work inside a mixed ordinary mandate',async()=>{
 const config={mode:'automatic',researchRunId:'native',includeCompanyPeople:true,automaticDeadline:Date.now()+60000,nativeAgent:{operationId:'exact-reviewed-operation'}};
 await maintainMandateResearch('org','mandate',[job({id:'native',updatedAt:new Date(Date.now()-660000),config}),job({id:'native-complete',status:'complete',config:{...config,researchRunId:'native-complete'}}),job({id:'native-fields',config:{companyBackgroundResearch:{},nativeAgent:config.nativeAgent}})],{recoverStopped:mock.recover});
 expect(mock.worker).not.toHaveBeenCalled();expect(mock.background).not.toHaveBeenCalled();expect(mock.schedule).not.toHaveBeenCalled();expect(mock.people).not.toHaveBeenCalled();expect(mock.recover).not.toHaveBeenCalled();
});
it('does not reschedule an automatic root it just recovered as stopped using a stale snapshot',async()=>{
 mock.worker.mockResolvedValue({status:'complete'});
 await maintainMandateResearch('org','mandate',[job({updatedAt:new Date(Date.now()-120000),config:{mode:'automatic',researchRunId:'root',automaticDeadline:Date.now()+60000}})],{recoverStopped:mock.recover});
 expect(mock.recover).toHaveBeenCalledOnce();expect(mock.schedule).not.toHaveBeenCalled();
});

it('does not recover an old root while its exact company child is making progress',async()=>{
 const now=Date.parse('2026-10-26T02:05:00Z');mock.worker.mockResolvedValue({status:'running',recovered:true});
 await maintainMandateResearch('org','mandate',[job({mandateId:'mandate',status:'extracting',updatedAt:new Date(now-14*60000)}),job({id:'child',mandateId:'mandate',status:'complete',updatedAt:new Date(now-30000),config:{researchTask:'company',parentJobId:'root'}})],{recoverStopped:mock.recover},undefined,now);
 expect(mock.worker).not.toHaveBeenCalled();expect(mock.recover).not.toHaveBeenCalled();
});
it.each(['other-org','other-mandate','other-owner','unrelated','people'])('does not borrow liveness from a %s child',async variation=>{
 const now=Date.parse('2026-10-26T02:05:00Z');mock.worker.mockResolvedValueOnce({status:'running'}).mockResolvedValueOnce({recovered:true});
 const child=job({id:'child',organizationId:variation==='other-org'?'other':'org',createdBy:variation==='other-owner'?'other':'owner',mandateId:variation==='other-mandate'?'other':'mandate',status:'complete',updatedAt:new Date(now-30000),config:{researchTask:variation==='people'?'field':'company',parentJobId:variation==='unrelated'?'other':'root'}});
 await maintainMandateResearch('org','mandate',[job({mandateId:'mandate',status:'extracting',updatedAt:new Date(now-14*60000)}),child],{recoverStopped:mock.recover},undefined,now);
 expect(mock.worker).toHaveBeenCalledWith('/jobs/root','POST',{action:'recover-stalled'},expect.any(Number));expect(mock.recover).toHaveBeenCalledExactlyOnceWith('root',1,0);
});

it('leaves a genuine active people-only research phase healthy',async()=>{
 const now=Date.parse('2026-10-26T02:05:00Z');
 await maintainMandateResearch('org','mandate',[job({status:'extracting',updatedAt:new Date(now-30000),config:{purpose:'people'}})],{recoverStopped:mock.recover},undefined,now);
 expect(mock.worker).not.toHaveBeenCalled();expect(mock.recover).not.toHaveBeenCalled();
});
it('requests recovery after company callbacks stop even though saved company and People counts are positive',async()=>{
 const now=Date.parse('2026-10-26T02:05:00Z');mock.worker.mockResolvedValueOnce({status:'running'}).mockResolvedValueOnce({recovered:true});
 const root=job({mandateId:'mandate',status:'extracting',updatedAt:new Date(now-14*60000),config:{includeCompanyPeople:true,companyPeopleProgress:{saved:100,settled:true},newBusinessIds:['saved-company']}});
 await maintainMandateResearch('org','mandate',[root,job({id:'child',mandateId:'mandate',status:'partial',updatedAt:new Date(now-11*60000),config:{parentJobId:'root',researchTask:'company'}})],{recoverStopped:mock.recover},undefined,now);
 expect(mock.worker).toHaveBeenCalledWith('/jobs/root','POST',{action:'recover-stalled'},expect.any(Number));expect(mock.recover).toHaveBeenCalledExactlyOnceWith('root',1,0);
});
