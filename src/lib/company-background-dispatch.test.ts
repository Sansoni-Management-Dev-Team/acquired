import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({db:null as unknown,persist:vi.fn(),transaction:vi.fn(),selections:[]as unknown[][]}));
vi.mock('@/db/client',()=>({requireDb:()=>m.db}));
vi.mock('./company-background-research',()=>({COMPANY_BACKGROUND_BUDGET:{maxDurationMs:30000},persistCompanyBackgroundResult:m.persist}));
import {recoverCompanyBackground} from './company-background-dispatch';
beforeEach(()=>{
 vi.resetAllMocks();m.selections=[];m.transaction.mockImplementation(async(work:(tx:unknown)=>Promise<unknown>,options?:{accessMode?:string})=>options?.accessMode==='read only'?work(m.db):[]);
 const query=()=>{const rows=m.selections.shift()||[];return{from:()=>({where:()=>({limit:async()=>rows})})};};
 m.db={select:query,selectDistinct:query,transaction:m.transaction};
});
it('retains saved evidence and original stalled-job identities while recording incomplete public fields',async()=>{
 m.selections=[[{id:'original-job',organizationId:'org',createdBy:'owner',workflowExecutionId:null,config:{companyBackgroundResearch:{fields:['founded']}}}],[]];
 expect(await recoverCompanyBackground()).toBe(0);
 expect(m.persist).toHaveBeenCalledExactlyOnceWith({organizationId:'org',jobId:'original-job',result:{facts:[],fields:{founded:{status:'research_incomplete',reason:'Background execution stopped; prior evidence retained'}},attempts:[],registryContacts:[]}});
});
it('leaves unvisited background jobs untouched when the shared worker pass budget expires',async()=>{
 let elapsed=0;vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
 m.selections=[[{id:'first',organizationId:'org',createdBy:'owner',workflowExecutionId:null,config:{companyBackgroundResearch:{fields:['founded']}}},{id:'second',organizationId:'org',createdBy:'owner',workflowExecutionId:null,config:{companyBackgroundResearch:{fields:['founded']}}}],[{organizationId:'org',mandateId:'mandate'}]];
 m.persist.mockImplementation(async()=>{elapsed=200;});
 expect(await recoverCompanyBackground(100)).toBe(0);expect(m.persist).toHaveBeenCalledOnce();expect(m.transaction).toHaveBeenCalledTimes(1);
 vi.mocked(performance.now).mockRestore();
});
it('refills queued work through the existing transaction/dispatch path when the budget remains open',async()=>{
 m.selections=[[],[{organizationId:'org',mandateId:'one'},{organizationId:'org',mandateId:'two'}]];
 expect(await recoverCompanyBackground()).toBe(2);expect(m.transaction).toHaveBeenCalledTimes(3);
});
it('identifies stalled persistence failure without logging payloads or changing propagation',async()=>{
 vi.spyOn(console,'info').mockImplementation(()=>{});
 m.selections=[[{id:'original-job',organizationId:'org',createdBy:'owner',workflowExecutionId:null,config:{companyBackgroundResearch:{fields:['founded']}}}]];
 const failure=Object.assign(Error('PRIVATE SQL credential'),{cause:{code:'57014',message:'PRIVATE'}});m.persist.mockRejectedValue(failure);
 await expect(recoverCompanyBackground()).rejects.toBe(failure);
 const logged=JSON.stringify(vi.mocked(console.info).mock.calls);expect(logged).toContain('stalled_persistence');expect(logged).toContain('57014');expect(logged).not.toContain('PRIVATE');
});
it('identifies malformed stalled configuration as TypeError without emitting its contents',async()=>{
 vi.spyOn(console,'info').mockImplementation(()=>{});
 m.selections=[[{id:'original-job',organizationId:'org',createdBy:'owner',workflowExecutionId:null,config:{companyBackgroundResearch:{private:'PRIVATE'}}}]];
 await expect(recoverCompanyBackground()).rejects.toBeInstanceOf(TypeError);
 const logged=JSON.stringify(vi.mocked(console.info).mock.calls);expect(logged).toContain('stalled_persistence');expect(logged).toContain('TypeError');expect(logged).not.toContain('PRIVATE');
});
it('identifies queued dispatch failures without exposing arbitrary error names',async()=>{
 vi.spyOn(console,'info').mockImplementation(()=>{});m.selections=[[],[{organizationId:'org',mandateId:'one'}]];
 const failure=Object.assign(Error('PRIVATE'),{name:'PRIVATE'});m.transaction.mockImplementation(async(work:(tx:unknown)=>Promise<unknown>,options?:{accessMode?:string})=>{if(options?.accessMode==='read only')return work(m.db);throw failure;});
 await expect(recoverCompanyBackground()).rejects.toBe(failure);
 const logged=JSON.stringify(vi.mocked(console.info).mock.calls);expect(logged).toContain('queued_dispatch');expect(logged).not.toContain('PRIVATE');
});

it('captures stalled and queued recovery work in one read-only transaction before any persistence',async()=>{
 let scanning=false;m.transaction.mockImplementation(async(work:(tx:unknown)=>Promise<unknown>,options?:{accessMode?:string})=>{if(options?.accessMode!=='read only')return[];scanning=true;try{return await work(m.db);}finally{scanning=false;}});
 m.selections=[[{id:'original-job',organizationId:'org',createdBy:'owner',workflowExecutionId:null,config:{companyBackgroundResearch:{fields:['founded']}}}],[]];m.persist.mockImplementation(async()=>{expect(scanning).toBe(false);});
 await recoverCompanyBackground();expect(m.transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function),{accessMode:'read only'});expect(m.persist).toHaveBeenCalledOnce();
});
