import { expect,it,vi } from 'vitest';
vi.mock('@/db/client',()=>({requireDb:vi.fn()}));
import { mapFirmableProfile } from '@/adapters/firmable-company-mapper';
import { companyBackgroundJobId,planCompanyMissingFields,mergeCompanyBackgroundEvidence,persistCompanyBackgroundResult } from './company-background-research';
import type { CompanyMissingFieldResearchResult } from '@/adapters/company-missing-field-research';
const mandate={sectors:['Industrial cleaning'],states:['VIC'],revenue:{min:0,max:null},ebitda:{min:0,max:null}};
const result:CompanyMissingFieldResearchResult={facts:[{field:'company_emails',value:'office@operator.example.com',sourceUrl:'https://operator.example.com/contact',quote:'Email office@operator.example.com',capturedAt:'2026-10-08T00:00:00Z',scope:'company',evidenceType:'published',reader:'fixture'}],fields:{company_emails:{status:'reported'},company_phones:{status:'not_disclosed',reason:'No corporate phone published'},revenue:{status:'research_incomplete',reason:'Accounts read timed out'}},attempts:[],registryContacts:[]};
it('durably checkpoints an unfinished attempt without finalizing its job or publishing an incomplete canonical observation',async()=>{
 const continuation={version:1 as const,facts:result.facts,attempts:[],registryContacts:[],teamMembers:[],accreditations:[],relatedDomains:[],visited:['https://operator.example.com/'],queue:[],searched:[],readCount:1,queries:0,discoveryComplete:false,identity:{name:'Operator',domain:'operator.example.com'},personEmails:[]};
 const config={completionPolicy:'work-items',targetId:'target',companyIdentityPolicyVersion:1,companyBackgroundResearch:{sourceRootId:'root',fields:['company_emails','year_founded']}},rows=[[{id:'child',organizationId:'org',mandateId:'mandate',status:'extracting',config}],[{status:'complete'}],[{id:'target',domain:'operator.example.com'}]];
 const set=vi.fn(()=>({where:async()=>[]})),insert=vi.fn(),db={execute:vi.fn(),select:()=>({from:()=>({where:()=>({for:async()=>rows.shift()})})}),update:()=>({set}),insert};
 expect(await persistCompanyBackgroundResult({organizationId:'org',jobId:'child',result:{...result,fields:{company_emails:{status:'reported'},year_founded:{status:'research_incomplete'}},continuation}},db as never)).toMatchObject({deferred:true,status:'extracting'});
 expect(set).toHaveBeenCalledWith(expect.objectContaining({status:'extracting',config:expect.objectContaining({companyBackgroundCheckpoint:continuation,companyBackgroundResult:expect.objectContaining({fields:{company_emails:{status:'reported'},year_founded:{status:'queued'}}})})}));expect(insert).not.toHaveBeenCalled();
});
it('does not let an older callback overwrite a newer company checkpoint',async()=>{
 const config={completionPolicy:'work-items',targetId:'target',companyBackgroundCheckpoint:{revision:2},companyBackgroundResearch:{sourceRootId:'root',fields:['company_emails']}},rows=[[{id:'child',organizationId:'org',mandateId:'mandate',status:'extracting',config}],[{status:'complete'}],[{id:'target',domain:'operator.example.com',firmographics:{},identifiers:{}}]],set=vi.fn(()=>({where:async()=>[]}));
 const db={execute:vi.fn(),select:()=>({from:()=>({where:()=>({for:async()=>rows.shift()})})}),update:()=>({set}),insert:()=>({values:()=>({onConflictDoNothing:()=>({returning:async()=>[]})})})};
 expect(await persistCompanyBackgroundResult({organizationId:'org',jobId:'child',result:{...result,resumeRevision:1}},db as never)).toMatchObject({accepted:false,deferred:true});expect(set).not.toHaveBeenCalled();
});
it('plans only public company values missing after normalized full provider mapping; zero workforce is an observation',()=>{
 const t=mapFirmableProfile({id:'synthetic',name:'Synthetic Services',website:'https://operator.example.com',description:'We provide industrial cleaning services.',year_founded:2001,industry_codes:{acn:'123456789'},company_emails:['office@operator.example.com'],company_phones:['+61 300000000'],region:{AU:{employee_count:0,address:{state:'VIC',suburb:'Melbourne'},revenue:'AUD $3M - $6M',revenue_currency:'AUD'}}},mandate,'org');
 expect(planCompanyMissingFields(t)).toEqual([]);
 t.sourceData!.firmable!.companyEmails=[];expect(planCompanyMissingFields(t)).toEqual([]);
 t.sourceData!.firmable!.rawResponse!.company_emails=[];expect(planCompanyMissingFields(t)).toEqual(['company_emails']);
});
it('stable job IDs isolate targets and roots without field-order or callback-dependent identities',()=>{
 expect(companyBackgroundJobId('root','company')).toBe(companyBackgroundJobId('root','company'));expect(companyBackgroundJobId('root','company')).not.toBe(companyBackgroundJobId('root','other'));expect(companyBackgroundJobId('root','company')).not.toBe(companyBackgroundJobId('later-root','company'));expect(companyBackgroundJobId('root','company')).toMatch(/^[a-f0-9-]{36}$/);
});
it('company email observations remain separate from paid provider data and person contacts; undisclosed differs from operation failure',()=>{
 const provider={rawResponse:{id:'paid-company',description:'Provider description'},companyEmails:[]},original={firmable:provider,headcount:{value:25}};
 const merged=mergeCompanyBackgroundEvidence(original,'job',['company_emails','company_phones','revenue'],result,'2026-10-08T00:00:01Z');
 expect(merged.firmable).toEqual(provider);expect(merged.headcount).toEqual({value:25});expect(original).not.toHaveProperty('backgroundResearch');
 expect(merged.backgroundResearch.fields.company_emails).toMatchObject({status:'reported',observations:[{value:'office@operator.example.com',scope:'company',sourceUrl:'https://operator.example.com/contact'}]});expect(merged.backgroundResearch.fields.company_phones).toMatchObject({status:'unavailable',missingReason:'No corporate phone published'});expect(merged.backgroundResearch.fields.revenue).toMatchObject({status:'failed',missingReason:'Accounts read timed out'});
});
it('retains numeric zero, rejects local source/invalid dates/empty values and never merges unrequested facts',()=>{
 const facts=[{...result.facts[0],field:'revenue' as const,value:0,currency:'AUD',scope:'AU'}, {...result.facts[0],sourceUrl:'http://127.0.0.1/private'}, {...result.facts[0],capturedAt:'invalid'}, {...result.facts[0],value:''}];
 const merged=mergeCompanyBackgroundEvidence({},'job',['revenue','company_phones'],{...result,facts},'2026-10-08T00:00:01Z');expect(merged.backgroundResearch.fields.revenue).toMatchObject({status:'reported',observations:[{value:0,currency:'AUD',scope:'AU'}]});expect(merged.backgroundResearch.fields).not.toHaveProperty('company_emails');
});

it('later missing-field attempts retain earlier source-backed facts rather than erasing data when a website is unavailable',()=>{
 const first=mergeCompanyBackgroundEvidence({},'earlier',['company_emails'],result,'2026-10-08T00:00:01Z');
 const later=mergeCompanyBackgroundEvidence(first,'later',['company_emails'],{facts:[],fields:{company_emails:{status:'research_incomplete',reason:'Website temporarily failed'}},attempts:[],registryContacts:[]},'2026-10-08T01:00:00Z');
 expect(later.backgroundResearch.fields.company_emails).toMatchObject({status:'reported',observations:[{value:'office@operator.example.com',sourceUrl:'https://operator.example.com/contact'}]});
});

const completeCompany=()=>mapFirmableProfile({id:'f123',name:'Synthetic Services',website:'https://operator.example.com',description:'Commercial refrigeration',year_founded:2001,industry_codes:{acn:'123456789'},company_emails:['office@operator.example.com'],company_phones:['+61300000000'],company_size:'11-50',revenue:'$3M - $6M',region:{AU:{employee_count:0,address:{state:'VIC'},revenue:'AUD $3M - $6M',revenue_currency:'AUD'}}},mandate,'org');
it('requires optional web fields only when the saved mandate asks for them',()=>{
 const t=completeCompany();
 expect(planCompanyMissingFields(t,'Commercial refrigeration')).toEqual([]);
 expect(planCompanyMissingFields(t,'NATA accreditation required')).toEqual(['accreditations']);
 expect(planCompanyMissingFields(t,'NATA accreditation contact and named team members')).toEqual(['accreditation_contacts','team_members','accreditations']);
});
it('reuses a matching provider register association without substituting an unrelated register or verifying it',()=>{
 const t=completeCompany();t.sourceData!.firmable!.organizationRegisters={nata:'National association of testing authorities (AU)'};
 expect(planCompanyMissingFields(t,'NATA accreditation required')).toEqual([]);
 expect(t.accreditations||[]).toEqual([]);
 t.sourceData!.firmable!.organizationRegisters={'hvac-contractors':'HVAC contractors (AU)'};
 expect(planCompanyMissingFields(t,'NATA accreditation required')).toEqual(['accreditations']);
});
it('provider register membership does not supply certificate numbers or named accreditation contacts',()=>{
 const t=completeCompany();t.sourceData!.firmable!.organizationRegisters={nata:'National association of testing authorities (AU)'};
 expect(planCompanyMissingFields(t,'NATA accreditation number and accreditation contact')).toEqual(['accreditation_contacts','accreditations']);
});
it('settles provider-covered and out-of-scope fields without inventing website observations',()=>{
 const merged=mergeCompanyBackgroundEvidence({firmable:{organizationRegisters:{nata:'Provider-reported association'}}},'job',['accreditations','team_members'],{facts:[],fields:{accreditations:{status:'already_available'},team_members:{status:'not_required'}},attempts:[],registryContacts:[]});
 expect(merged.backgroundResearch.fields).toMatchObject({accreditations:{status:'already_available',observations:[]},team_members:{status:'not_required',observations:[]}});expect(merged.firmable).toEqual({organizationRegisters:{nata:'Provider-reported association'}});
});
