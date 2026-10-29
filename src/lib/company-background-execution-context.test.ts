import{beforeEach,it,expect,vi}from'vitest';
const m=vi.hoisted(()=>({normalFields:vi.fn(),normalAbn:vi.fn(),persist:vi.fn(),mapTarget:vi.fn(),savedBrief:vi.fn()}));
vi.mock('@/db/client',()=>({requireDb:()=>({select:()=>({from:()=>({where:async()=>[{id:'saved-company',filters:m.savedBrief()}]})})})}));
vi.mock('@/db/target-record-mapper',()=>({targetRecordToRankedTarget:m.mapTarget}));
vi.mock('@/adapters/company-missing-field-research',()=>({researchCompanyMissingFields:m.normalFields}));
vi.mock('@/adapters/abn-identity-resolver',()=>({resolvePublicCompanyAbn:m.normalAbn}));
vi.mock('./company-background-research',()=>({persistCompanyBackgroundResult:m.persist}));
import{executeCompanyBackground}from'./company-background-execution';
import type{ResearchConfig}from'@/domain/research';
const job=(native=false)=>({id:'child',organizationId:'org',mandateId:'mandate',createdBy:'actor',status:'queued',config:{targetId:'saved-company',automaticDeadline:Date.now()+60000,companyBackgroundResearch:{fields:['description'],verifyAbn:true},...(native?{nativeAgent:{version:1}}:{})}})as unknown as Omit<Parameters<typeof executeCompanyBackground>[0],'config'>&{config:ResearchConfig};
const result={facts:[],fields:{description:{status:'not_disclosed'}},attempts:[],registryContacts:[]};
beforeEach(()=>{vi.clearAllMocks();m.savedBrief.mockReturnValue({});m.mapTarget.mockReturnValue({companyName:'Saved company',domain:'company.com',state:'Unknown',headcount:{value:null},revenue:{value:null},establishedYear:{value:null},sourceData:{}});m.normalFields.mockResolvedValue(result);m.normalAbn.mockResolvedValue({status:'not_found'});m.persist.mockResolvedValue({accepted:true});});
it('does not discard finite queued company work when an old aggregate deadline has passed',async()=>{
 const j=job();j.config={...j.config,completionPolicy:'work-items',automaticDeadline:1};
 await executeCompanyBackground(j);expect(m.normalFields).toHaveBeenCalled();expect(m.normalAbn).toHaveBeenCalled();
});
it('keeps the normal workspace on its existing public extraction service and results contract',async()=>{expect(await executeCompanyBackground(job())).toEqual({accepted:true});expect(m.normalFields).toHaveBeenCalledWith(expect.objectContaining({name:'Saved company',website:'https://company.com/',missingFields:['description']}));expect(m.normalAbn).toHaveBeenCalledOnce();expect(m.persist).toHaveBeenCalledWith(expect.objectContaining({result:{...result,abnLookup:{status:'not_found'}}}),undefined,undefined);});
it('executes the same service with caller-owned admission dependencies and a persistence-transaction guard',async()=>{const order:string[]=[],resolveAbn=vi.fn(async()=>{order.push('registry');return{status:'not_found'};}),researchFields=vi.fn(async()=>{order.push('fields');return result;}),beforePersist=vi.fn(),assertCurrent=vi.fn(async()=>{order.push('authority');});await executeCompanyBackground(job(true),false,{assertCurrent,researchFields:researchFields as never,resolveAbn:resolveAbn as never,beforePersist});expect(order).toEqual(['authority','registry','fields']);expect(m.normalFields).not.toHaveBeenCalled();expect(m.normalAbn).not.toHaveBeenCalled();expect(m.persist).toHaveBeenCalledWith(expect.objectContaining({result:{...result,abnLookup:{status:'not_found'}}}),undefined,beforePersist);});
it('fails closed on a native job without its reviewed execution context, before any default provider request',async()=>{await expect(executeCompanyBackground(job(true))).rejects.toThrow(/reviewed execution context/);expect(m.normalFields).not.toHaveBeenCalled();expect(m.normalAbn).not.toHaveBeenCalled();expect(m.persist).not.toHaveBeenCalled();});

it('rechecks a queued field against current provider data and makes no provider requests when it is already present',async()=>{
 const t=m.mapTarget();m.mapTarget.mockReturnValue({...t,abn:'51824753556',sourceData:{firmable:{description:'Current saved provider description',rawResponse:{description:'Current saved provider description'}}}});
 await executeCompanyBackground(job());
 expect(m.normalFields).not.toHaveBeenCalled();expect(m.normalAbn).not.toHaveBeenCalled();
 expect(m.persist).toHaveBeenCalledWith(expect.objectContaining({result:expect.objectContaining({facts:[],attempts:[],fields:{description:{status:'already_available',reason:expect.any(String)}}})}),undefined,undefined);
});
it('retires irrelevant legacy queued optional fields without crawling or altering the saved request',async()=>{
 const j=job(),original=['team_members','accreditations','accreditation_contacts'];
 j.config={...j.config,researchScope:'Commercial refrigeration',companyBackgroundResearch:{...j.config.companyBackgroundResearch!,fields:original as never,verifyAbn:false}};
 await executeCompanyBackground(j);
 expect(m.normalFields).not.toHaveBeenCalled();expect(m.normalAbn).not.toHaveBeenCalled();expect(j.config.companyBackgroundResearch!.fields).toEqual(original);
 const result=m.persist.mock.calls[0][0].result;
 expect(Object.values(result.fields).map((f:unknown)=>(f as {status:string}).status)).toEqual(['not_required','not_required','not_required']);expect(result.attempts).toEqual([]);
});
it('only forwards the still-missing subset and retains available outcomes',async()=>{
 const j=job();j.config.companyBackgroundResearch={...j.config.companyBackgroundResearch!,fields:['description','company_emails'],verifyAbn:false};
 m.mapTarget.mockReturnValue({...m.mapTarget(),sourceData:{firmable:{description:'Saved description'}}});
 m.normalFields.mockResolvedValue({...result,fields:{company_emails:{status:'not_disclosed'}}});
 await executeCompanyBackground(j);
 expect(m.normalFields).toHaveBeenCalledWith(expect.objectContaining({missingFields:['company_emails']}));
 expect(m.persist.mock.calls[0][0].result.fields).toMatchObject({description:{status:'already_available'},company_emails:{status:'not_disclosed'}});
});
it('loads the saved mandate criteria for an older queued job instead of guessing from its sector',async()=>{
 const j=job();j.config={...j.config,researchScope:'Commercial refrigeration',companyBackgroundResearch:{...j.config.companyBackgroundResearch!,fields:['accreditations'],verifyAbn:false}};
 m.savedBrief.mockReturnValue({brief:{criteria:[{state:'specified',value:'ISO 9001 certification'}]}});
 m.normalFields.mockResolvedValue({...result,fields:{accreditations:{status:'not_disclosed'}}});
 await executeCompanyBackground(j);
 expect(m.normalFields).toHaveBeenCalledWith(expect.objectContaining({missingFields:['accreditations'],mandateScope:'ISO 9001 certification; Commercial refrigeration'}));
});
it('preserves explicitly reviewed native fields even when the normal planner would not request them',async()=>{
 const j=job(true);j.config.companyBackgroundResearch={...j.config.companyBackgroundResearch!,fields:['team_members'],verifyAbn:false};
 const researchFields=vi.fn().mockResolvedValue({...result,fields:{team_members:{status:'not_disclosed'}}}),assertCurrent=vi.fn();
 await executeCompanyBackground(j,false,{assertCurrent,researchFields,resolveAbn:m.normalAbn});
 expect(assertCurrent).toHaveBeenCalled();expect(researchFields).toHaveBeenCalledWith(expect.objectContaining({missingFields:['team_members']}));expect(j.config.companyBackgroundResearch.fields).toEqual(['team_members']);
});
