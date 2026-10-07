import { expect,it,vi } from 'vitest';
vi.mock('@/db/client',()=>({requireDb:vi.fn()}));
import { mapFirmableProfile } from '@/adapters/firmable-company-mapper';
import { companyBackgroundJobId,planCompanyMissingFields,mergeCompanyBackgroundEvidence } from './company-background-research';
import type { CompanyMissingFieldResearchResult } from '@/adapters/company-missing-field-research';
const mandate={sectors:['Industrial cleaning'],states:['VIC'],revenue:{min:0,max:null},ebitda:{min:0,max:null}};
const result:CompanyMissingFieldResearchResult={facts:[{field:'company_emails',value:'office@operator.example.com',sourceUrl:'https://operator.example.com/contact',quote:'Email office@operator.example.com',capturedAt:'2026-10-08T00:00:00Z',scope:'company',evidenceType:'published',reader:'fixture'}],fields:{company_emails:{status:'reported'},company_phones:{status:'not_disclosed',reason:'No corporate phone published'},revenue:{status:'research_incomplete',reason:'Accounts read timed out'}},attempts:[],registryContacts:[]};
it('plans only public company values missing after normalized full provider mapping; zero workforce is an observation',()=>{
 const t=mapFirmableProfile({id:'synthetic',name:'Synthetic Services',website:'https://operator.example.com',description:'We provide industrial cleaning services.',year_founded:2001,industry_codes:{acn:'123456789'},company_emails:['office@operator.example.com'],company_phones:['+61 300000000'],region:{AU:{employee_count:0,address:{state:'VIC',suburb:'Melbourne'},revenue:'AUD $3M - $6M',revenue_currency:'AUD'}}},mandate,'org');
 expect(planCompanyMissingFields(t)).toEqual(['accreditation_contacts','team_members','accreditations']);
 t.sourceData!.firmable!.companyEmails=[];expect(planCompanyMissingFields(t)).toEqual(['company_emails','accreditation_contacts','team_members','accreditations']);
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
