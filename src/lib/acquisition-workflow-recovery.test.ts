import {afterEach,expect,it,vi} from 'vitest';
vi.mock('./acquisition-workflow',()=>({resumeAcquisitionWorkflow:vi.fn()}));
vi.mock('./background-workload',()=>({backgroundRemaining:()=>10000}));
import {recoverAcquisitionWorkflows} from './acquisition-workflow-recovery';
afterEach(()=>vi.unstubAllEnvs());
it('does no schema/provider work before schema readiness',async()=>{vi.stubEnv('ACQUISITION_WORKFLOW_ENABLED','false');vi.stubEnv('ACQUISITION_WORKFLOW_SCHEMA_READY','false');const query=vi.fn();expect(await recoverAcquisitionWorkflows({query} as never)).toBe(0);expect(query).not.toHaveBeenCalled();});
it('recovers original persisted identities after creation is disabled, without a new source selection',async()=>{
 vi.stubEnv('ACQUISITION_WORKFLOW_ENABLED','false');vi.stubEnv('ACQUISITION_WORKFLOW_SCHEMA_READY','true');
 const query=vi.fn(async()=>({rows:[{id:'first',organization_id:'org',owner_user_id:'owner'},{id:'second',organization_id:'other',owner_user_id:'other-owner'}]}));
 const resume=vi.fn().mockRejectedValueOnce(Error('PRIVATE')).mockResolvedValueOnce(null);const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 try{expect(await recoverAcquisitionWorkflows({query} as never,60000,resume)).toBe(1);expect(query).toHaveBeenCalledWith(expect.stringContaining('LIMIT 2'),[1]);expect(resume.mock.calls.map(c=>[c[1],c[2]])).toEqual([[{organizationId:'org',userId:'owner'},'first'],[{organizationId:'other',userId:'other-owner'},'second']]);expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE');}finally{log.mockRestore();}
});
