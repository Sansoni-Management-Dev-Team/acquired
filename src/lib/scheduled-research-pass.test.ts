import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({workflow:vi.fn(),observation:vi.fn(),maintenance:vi.fn()}));
vi.mock('./agent-initial-research-observer',()=>({observeScheduledInitialResearch:m.observation}));
vi.mock('./research-maintenance',()=>({maintainScheduledResearch:m.maintenance}));
vi.mock('./acquisition-workflow-recovery',()=>({recoverAcquisitionWorkflows:m.workflow}));
vi.mock('./agent-runtime',()=>({agentPool:()=>({})}));
import {scheduledResearchPass} from './scheduled-research-pass';
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('ACQUISITION_WORKFLOW_ENABLED','true');});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
it('gives every existing phase first access across passes even if the first phase always fails',async()=>{
 const starts:string[]=[];
 for(const [phase,call]of Object.entries(m))call.mockImplementation(async()=>{starts.push(phase);throw Error('unavailable');});
 const clock=vi.spyOn(Date,'now');
 for(let minute=0;minute<3;minute++){clock.mockReturnValue(minute*60000);await expect(scheduledResearchPass()).rejects.toThrow('unavailable');}
 expect(new Set(starts)).toEqual(new Set(['workflow','observation','maintenance']));expect(starts).toHaveLength(3);
});
it('runs each available phase once under the existing pass when work succeeds',async()=>{
 m.maintenance.mockResolvedValue(3);vi.spyOn(Date,'now').mockReturnValue(60000);
 expect(await scheduledResearchPass()).toBe(3);expect(m.workflow).toHaveBeenCalledOnce();expect(m.observation).toHaveBeenCalledOnce();expect(m.maintenance).toHaveBeenCalledOnce();
});
