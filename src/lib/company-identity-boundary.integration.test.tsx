import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,expect,it,vi} from 'vitest';
import {initialAssessment} from '@/domain/acquisition';
import {defaultMandate} from '@/test/fixtures/scoring-targets';
import {targets} from '@/db/schema';
import {targetRecordToRankedTarget} from '@/db/target-record-mapper';
import {CompanyInfoSummary} from '@/components/company-info-summary';
const background=vi.hoisted(()=>({queue:vi.fn(async()=>({jobId:'background-job',fields:[],created:true})),websiteReads:vi.fn(),registryReads:vi.fn()}));
vi.mock('@/lib/company-background-research',()=>({queueCompanyBackgroundResearch:background.queue}));
const state=vi.hoisted(()=>({selects:[] as unknown[],inserts:[] as Array<{table:unknown;value:Record<string,unknown>}>,updates:[] as Record<string,unknown>[],providerStatus:404,html:'',abnName:'Acme Glass',abnErrors:false,websiteFailure:false,websiteTruncated:false,profile:null as Record<string,unknown>|null}));
vi.mock('@/db/client',()=>{
 const builder=(result:()=>unknown)=>{const b:Record<string,unknown>={};for(const method of ['from','where','orderBy','limit','for','onConflictDoNothing','onConflictDoUpdate'])b[method]=()=>b;b.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve(result()).then(resolve);return b;};
 const db={select:()=>builder(()=>state.selects.shift()),insert:(table:unknown)=>({values:(value:Record<string,unknown>)=>{state.inserts.push({table,value});return builder(()=>[]);}}),update:()=>({set:(value:Record<string,unknown>)=>{state.updates.push(value);return builder(()=>[]);}}),transaction:async(fn:(tx:unknown)=>unknown)=>fn(db)};
 return{requireDb:()=>db};
});
vi.mock('@/adapters/firmable-client',async()=>{const actual=await vi.importActual<typeof import('@/adapters/firmable-client')>('@/adapters/firmable-client');return{...actual,FirmableClient:class{async enrichCompany(){if(state.profile)return state.profile;throw new actual.FirmableError('/company',state.providerStatus,'unmatched');}}};});
vi.mock('@/lib/company-people-research',()=>({queueCompanyPeople:vi.fn(),tickCompanyPeople:vi.fn()}));
// Real resolver logic, deterministic reads only; no database or upstream calls.
vi.mock('@/adapters/abn-identity-resolver',async()=>{const actual=await vi.importActual<typeof import('@/adapters/abn-identity-resolver')>('@/adapters/abn-identity-resolver');return{...actual,readIdentityWebsite:background.websiteReads,resolvePublicCompanyAbn:actual.createAbnIdentityResolver({website:async url=>{background.registryReads(url);if(state.abnErrors)throw Error('Identity website HTTP 403');return{url,html:state.html};},search:async()=>({status:'no_results',match:null,searchUrl:'https://abr.business.gov.au',candidates:[]}),record:async abn=>({abn,entityName:abn==='56663118241'?'GLASS PTY LTD':state.abnName,active:true,names:[],location:'',sourceUrl:'https://abr.business.gov.au/ABN/View?abn=68006904052'})})};});
import {firmableCompanyResearch} from './firmable-company-research';
const job={id:'root',organizationId:'org',mandateId:'mandate',createdBy:'user',status:'extracting',config:{pipelineDesign:'web-firmable-v1',researchRunId:'root',mode:'automatic',workflow:'business',automaticDeadline:Date.now()+60000}} as unknown as Parameters<typeof firmableCompanyResearch>[0];
const payload={action:'e-company',row:{name:'Acme Glass',domain:'acmeglass.com',website:'https://acmeglass.com'}};
beforeEach(()=>{state.selects=[[{filters:defaultMandate}],[{status:'extracting'}],[],[{status:'extracting'}]];state.inserts=[];state.updates=[];state.providerStatus=404;state.html='<meta name="description" content="Independent glazing services"><p>Established in 2001. Carlton VIC 3053. ACN 123 456 789.</p><a href="mailto:office@acmeglass.com">Email</a><a href="tel:+61312345678">Call</a>';state.abnErrors=false;state.abnName='Acme Glass';state.profile=null;state.websiteFailure=false;state.websiteTruncated=false;});
function readSaved(){const row=state.inserts.find(x=>x.table===targets)!.value;return targetRecordToRankedTarget({...row,createdAt:new Date(),updatedAt:new Date()} as Parameters<typeof targetRecordToRankedTarget>[0],[]);}

it.each([404,409])('unmatched provider %s saves identity and durable background work without website or registry reads',async status=>{
 state.providerStatus=status;background.websiteReads.mockClear();background.registryReads.mockClear();background.queue.mockClear();
 const result=await firmableCompanyResearch(job,payload);expect(result).toMatchObject({ok:true,matched:false,backgroundJobId:'background-job'});
 const target=readSaved();expect(target.companyName).toBe('Acme Glass');expect(target.domain).toBe('acmeglass.com');expect(target.sourceData?.firmable?.firmableId).toBe('');expect(target.abn).toBeUndefined();expect(target.headcount.value).toBeNull();expect(target.revenue.value).toBeNull();
 expect(background.websiteReads).not.toHaveBeenCalled();expect(background.registryReads).not.toHaveBeenCalled();expect(background.queue).toHaveBeenCalledOnce();
 expect(background.queue).toHaveBeenCalledWith(job,expect.objectContaining({id:(result as {targetId?:string}).targetId}),expect.anything());
 expect(state.updates.find(x=>(x.config as {targetId?:string}|undefined)?.targetId)?.status).toBe('complete');
});
it('accepts Firmable ABN and complete supplied fields before any supplemental registry work',async()=>{
 state.profile={id:'f100',name:'Acme Glass',website:'https://acmeglass.com',description:'Glazing services',company_emails:['office@acmeglass.com'],industry_codes:{abn:'68006904052'},employee_count:25};background.registryReads.mockClear();
 await firmableCompanyResearch(job,payload);const target=readSaved();expect(target.abn).toBe('68006904052');expect(target.sourceData?.firmable?.description).toBe('Glazing services');expect(target.sourceData?.firmable?.companyEmails).toEqual(['office@acmeglass.com']);expect(target.sourceData?.firmable?.employeeCount).toBe(25);
 expect(background.registryReads).not.toHaveBeenCalled();expect(state.inserts.find(x=>x.table===targets)!.value.identifiers).toMatchObject({abnSource:{source:'Firmable'}});
 expect(renderToStaticMarkup(<CompanyInfoSummary member={{target,assessment:initialAssessment,accreditations:[],version:1}}/>)).toContain('68006904052');
});
it('company save is rolled back if durable missing-field queue cannot be committed',async()=>{
 background.queue.mockRejectedValueOnce(Error('outbox persistence failed'));const result=await firmableCompanyResearch(job,payload);expect(result).toEqual({ok:false});expect(state.updates.at(-1)?.status).toBe('failed');
});
it('root company phase finishes without waiting for optional contact or background work',async()=>{
 state.selects=[[{filters:defaultMandate}],[]];await firmableCompanyResearch(job,{action:'e-finish',result:{failed:0,stopReason:'exhausted'}});expect(state.updates.at(-1)?.status).toBe('complete');
});
it('root company failures still remain operationally partial',async()=>{
 state.selects=[[{filters:defaultMandate}],[{id:'partial-child'}]];await firmableCompanyResearch(job,{action:'e-finish',result:{failed:0,stopReason:'exhausted'}});expect(state.updates.at(-1)?.status).toBe('partial');
});
