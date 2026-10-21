import {describe,it,expect} from 'vitest';
import {emptyBrief} from '@/domain/acquisition';
import {buildAgentResearchPlan,agentResearchContextRevision} from './agent-research-plan';
const ids={productionPipeline:'firmable-v1' as const,researchJobId:'12927bba-1515-482e-b8b6-3815403b5b7c',responsibilityId:'fc12b514-dfd7-42da-98b7-447591464c33',responsibilityRevision:1,mandateRevision:'123'};
function brief(){const b=emptyBrief();for(const [key,value]of [['subsectors','Commercial refrigeration; cold room maintenance'],['geography','QLD and NSW']]){const c=b.criteria.find(c=>c.key===key)!;Object.assign(c,{value,state:'specified',confirmed:true});}b.naturalLanguage='Private buyer information must not become a search query';return b;}
describe('reviewed native research plan',()=>{
 it('uses saved confirmed criteria without model calls, private narrative or unbounded discovery',()=>{
  const plan=buildAgentResearchPlan({brief:brief(),...ids});
  expect(plan).toMatchObject({nativeResearchPlanVersion:1,mandateRevision:'123',responsibilityRevision:1,config:{requestId:ids.researchJobId,geography:'NSW, QLD',researchScope:'Commercial refrigeration; cold room maintenance',targetBusinesses:20,budget:{maxPages:5,maxDomains:5,maxMinutes:10,maxModelCalls:5}}});
  expect(JSON.stringify(plan)).not.toContain('Private buyer');
 });
 it('refuses unknown or unconfirmed search criteria rather than inferring them with an unbudgeted model',()=>{
  const b=brief();b.criteria.find(c=>c.key==='subsectors')!.confirmed=false;
  expect(()=>buildAgentResearchPlan({brief:b,...ids})).toThrow(/confirm/i);
 });
 it('cannot accept an automatic continuation, provider override or arbitrary account through its input',()=>{
  expect(()=>buildAgentResearchPlan({...ids,brief:brief(),provider:'another'} as Parameters<typeof buildAgentResearchPlan>[0])).toThrow();
 });
});

it('freezes the production engine in the exact reviewed native plan',()=>{
 const plan=buildAgentResearchPlan({brief:brief(),...ids});
 expect(plan.execution).toHaveProperty('productionPipeline','firmable-v1');
});
it('freezes hybrid COMPANY scope with separately reviewed people/background and explicit physical request ceilings',()=>{const plan=buildAgentResearchPlan({...ids,productionPipeline:'hybrid-firmable-v1',brief:brief()});expect(plan.execution).toEqual({productionPipeline:'hybrid-firmable-v1',pipeline:'hybrid-company-v1',backgroundResearch:false,peopleResearch:false});expect(plan.providerPolicy.maxAttempts).toEqual({search:6,page:5,ai:0,firmable:60});expect(plan.config).toMatchObject({targetBusinesses:20,findPeople:false});expect(plan.contextRevision).not.toBe(buildAgentResearchPlan({...ids,brief:brief()}).contextRevision);});
it('freezes expanded discovery sampling separately from the unchanged profile/spend caps, preserving old approved interpretation',()=>{
 const options={...ids,productionPipeline:'hybrid-firmable-v1' as const,brief:brief()};
 const current=buildAgentResearchPlan(options);expect(current.config.companyDiscoveryPolicy).toMatchObject({version:3,firmablePageSize:100,maxFirmablePages:2,maxFirmableRows:200,maxProfiledCompanies:20,maxWebQueries:6});expect(current.providerPolicy.maxAttempts).toEqual({firmable:60,search:6,page:5,ai:0});
 const legacy=buildAgentResearchPlan({...options,discoveryPolicyVersion:1});expect(legacy.config.companyDiscoveryPolicy).toBeUndefined();expect(legacy.contextRevision).not.toBe(current.contextRevision);
});

it('freezes current company identity policy while preserving explicitly historical plan interpretation',()=>{const options={...ids,brief:brief()};const next=buildAgentResearchPlan(options);expect(next.config).toHaveProperty('companyIdentityPolicyVersion',1);const old=buildAgentResearchPlan({...options,companyIdentityPolicyVersion:0});expect(old.config).not.toHaveProperty('companyIdentityPolicyVersion');expect(old.contextRevision).toBe(agentResearchContextRevision({productionPipeline:ids.productionPipeline,responsibilityId:ids.responsibilityId,responsibilityRevision:ids.responsibilityRevision,mandateRevision:ids.mandateRevision}));expect(old.contextRevision).not.toBe(next.contextRevision);expect(buildAgentResearchPlan({...options,companyIdentityPolicyVersion:0})).toEqual(old);});

it('freezes staff-band search intent for new plans without reinterpreting old v2 approvals',()=>{const b=brief();Object.assign(b.criteria.find(c=>c.key==='headcount')!,{state:'specified',value:'30–80',confirmed:true});const options={...ids,productionPipeline:'hybrid-firmable-v1' as const,brief:b};const next=buildAgentResearchPlan(options);expect(next.config.companyDiscoveryPolicy).toHaveProperty('profileSelection.requestedHeadcount',{min:30,max:80});const old=buildAgentResearchPlan({...options,discoveryPolicyVersion:2});expect(old.config.companyDiscoveryPolicy).toEqual({version:2,countryScope:'AU',desiredSourceCompanies:20,maxProfiledCompanies:20,firmablePageSize:100,maxFirmablePages:2,maxFirmableRows:200,maxWebQueries:6,queryOrder:'subsector_round_robin'});expect(old.contextRevision).not.toBe(next.contextRevision);expect(buildAgentResearchPlan({...options,discoveryPolicyVersion:2})).toEqual(old);b.criteria.find(c=>c.key==='headcount')!.confirmed=false;expect(buildAgentResearchPlan(options).config.companyDiscoveryPolicy).toHaveProperty('profileSelection.requestedHeadcount',null);});

it('freezes explicit v4 all-company enrichment with configured no-credit pricing and physical ceilings, without changing defaults',()=>{
 const options={...ids,productionPipeline:'hybrid-firmable-v1' as const,brief:brief()};const plan=buildAgentResearchPlan({...options,discoveryPolicyVersion:4});
 expect(plan.config).toMatchObject({targetBusinesses:20,companyOnly:true,includeCompanyPeople:false,includePhones:false,findPeople:false,budget:{maxMinutes:15},companyDiscoveryPolicy:{version:4,maxProfiledCompanies:800}});
 expect(plan.providerPolicy).toEqual({version:2,companyOnly:true,callAdmission:'per_request',requestCeilingMicroUsd:'1000000',requestCeilingsMicroUsd:{firmable:'0',search:'1000000',page:'1000000',ai:'1000000'},pricingBasis:'configured_company_only_incremental',maxAttempts:{search:6,page:5,ai:0,firmable:24024}});
 expect(buildAgentResearchPlan(options).config.companyDiscoveryPolicy?.version).toBe(3);expect(plan.contextRevision).not.toBe(buildAgentResearchPlan(options).contextRevision);
 expect(()=>buildAgentResearchPlan({...ids,brief:brief(),discoveryPolicyVersion:4})).toThrow();
});

it('binds a fresh remaining-company review to the exact source snapshot without changing historical plans or funding',()=>{
 const options={...ids,productionPipeline:'hybrid-firmable-v1' as const,discoveryPolicyVersion:4 as const,brief:brief()};
 const companyContinuation={version:1 as const,sourceRootId:'00000000-0000-4000-8000-000000000007',sourceDigest:'a'.repeat(64),candidateKeys:['firmable:f1','domain:remaining.example']};
 const ordinary=buildAgentResearchPlan(options),next=buildAgentResearchPlan({...options,companyContinuation} as Parameters<typeof buildAgentResearchPlan>[0]);
 expect(next.config).toHaveProperty('companyContinuation',companyContinuation);
 expect(next.contextRevision).not.toBe(ordinary.contextRevision);
 expect(next.providerPolicy).toEqual(ordinary.providerPolicy);
 expect(buildAgentResearchPlan({...options,companyContinuation:{...companyContinuation,sourceDigest:'b'.repeat(64)}} as Parameters<typeof buildAgentResearchPlan>[0]).contextRevision).not.toBe(next.contextRevision);
 expect(()=>buildAgentResearchPlan({...options,discoveryPolicyVersion:3,companyContinuation} as Parameters<typeof buildAgentResearchPlan>[0])).toThrow();
 expect(()=>buildAgentResearchPlan({...options,companyContinuation:{...companyContinuation,sourceRootId:ids.researchJobId}} as Parameters<typeof buildAgentResearchPlan>[0])).toThrow();
 expect(buildAgentResearchPlan(options)).toEqual(ordinary);
});


it('freezes a new V5 joint company/basic-People review without extending old V4 authority',()=>{
 const options={...ids,productionPipeline:'hybrid-firmable-v1' as const,brief:brief()};
 const old=buildAgentResearchPlan({...options,discoveryPolicyVersion:4});
 const next=buildAgentResearchPlan({...options,discoveryPolicyVersion:5});
 expect(next.execution.peopleResearch).toBe(true);
 expect(next.config).toMatchObject({includeCompanyPeople:true,includePhones:false,findPeople:false,companyDiscoveryPolicy:{version:5,automaticPeople:{version:1,maxCompanies:800,maxSearchPagesPerCompany:1,searchPageSize:50,maxContactsPerCompany:3,includePhones:false}}});
 expect(next.config).not.toHaveProperty('companyOnly');
 expect(next.providerPolicy).toMatchObject({version:3,usdAdmission:'company_phase_people_per_request',firmableCompanyRequestCeilingMicroUsd:'0',requestCeilingsMicroUsd:{firmable:'1000000'},maxAttempts:{firmable:24024,search:6,page:5,ai:0}});
 expect(next.contextRevision).not.toBe(old.contextRevision);
 expect(buildAgentResearchPlan({...options,discoveryPolicyVersion:4})).toEqual(old);
 expect(()=>buildAgentResearchPlan({...ids,brief:brief(),discoveryPolicyVersion:5})).toThrow();
});
