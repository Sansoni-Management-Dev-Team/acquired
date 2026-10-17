import {beforeEach,expect,it,vi} from 'vitest';
import type {ResearchRepository} from '@/db/research-repository';
const mock=vi.hoisted(()=>({background:vi.fn(),people:vi.fn(),schedule:vi.fn(),worker:vi.fn(),recover:vi.fn()}));
vi.mock('./company-background-dispatch',()=>({dispatchCompanyBackground:mock.background}));
vi.mock('./company-people-research',()=>({tickCompanyPeople:mock.people}));
vi.mock('./research-scheduler',()=>({scheduleResearchRun:mock.schedule}));
vi.mock('./research-service',()=>({researchWorker:mock.worker}));
import {maintainMandateResearch} from './research-maintenance';
type Jobs=Awaited<ReturnType<ResearchRepository['listReview']>>;
const job=(value:Record<string,unknown>)=>({id:'root',status:'queued',revision:1,pages:0,updatedAt:new Date(),config:{},...value}) as Jobs[number];
beforeEach(()=>{vi.resetAllMocks();mock.background.mockResolvedValue(0);mock.schedule.mockResolvedValue(false);});
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
