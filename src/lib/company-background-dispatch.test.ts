import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({db:null as unknown,persist:vi.fn(),transaction:vi.fn(),selections:[]as unknown[][]}));
vi.mock('@/db/client',()=>({requireDb:()=>m.db}));
vi.mock('./company-background-research',()=>({COMPANY_BACKGROUND_BUDGET:{maxDurationMs:30000},persistCompanyBackgroundResult:m.persist}));
import {recoverCompanyBackground} from './company-background-dispatch';
beforeEach(()=>{
 vi.resetAllMocks();m.selections=[];m.transaction.mockResolvedValue([]);
 const query=()=>{const rows=m.selections.shift()||[];return{from:()=>({where:()=>({limit:async()=>rows})})};};
 m.db={select:query,selectDistinct:query,transaction:m.transaction};
});
it('retains saved evidence and original stalled-job identities while recording incomplete public fields',async()=>{
 m.selections=[[{id:'original-job',organizationId:'org',config:{companyBackgroundResearch:{fields:['founded']}}}],[]];
 expect(await recoverCompanyBackground()).toBe(0);
 expect(m.persist).toHaveBeenCalledExactlyOnceWith({organizationId:'org',jobId:'original-job',result:{facts:[],fields:{founded:{status:'research_incomplete',reason:'Background execution stopped; prior evidence retained'}},attempts:[],registryContacts:[]}});
});
it('leaves unvisited background jobs untouched when the shared worker pass budget expires',async()=>{
 let elapsed=0;vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
 m.selections=[[{id:'first',organizationId:'org',config:{companyBackgroundResearch:{fields:['founded']}}},{id:'second',organizationId:'org',config:{companyBackgroundResearch:{fields:['founded']}}}],[{organizationId:'org',mandateId:'mandate'}]];
 m.persist.mockImplementation(async()=>{elapsed=200;});
 expect(await recoverCompanyBackground(100)).toBe(0);expect(m.persist).toHaveBeenCalledOnce();expect(m.transaction).not.toHaveBeenCalled();
 vi.mocked(performance.now).mockRestore();
});
it('refills queued work through the existing transaction/dispatch path when the budget remains open',async()=>{
 m.selections=[[],[{organizationId:'org',mandateId:'one'},{organizationId:'org',mandateId:'two'}]];
 expect(await recoverCompanyBackground()).toBe(2);expect(m.transaction).toHaveBeenCalledTimes(2);
});
