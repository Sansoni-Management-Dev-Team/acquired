import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {buildAllDiscoveredCompanyPolicy} from '@/domain/research-discovery-policy';
import {AgentNativeProposalDetails,nativeProposalReviewable} from './agent-native-proposal-details';

function combined(){
 const discovery=buildAllDiscoveredCompanyPolicy();
 return {nativeResearchPlanVersion:1,config:{requestId:'combined-research',researchScope:'Commercial refrigeration',geography:'QLD',targetBusinesses:20,companyIdentityPolicyVersion:1,includeCompanyPeople:true,includePhones:false,findPeople:false,budget:{maxMinutes:15},companyDiscoveryPolicy:{...discovery,version:5,profileSelection:{...discovery.profileSelection,companyOnly:false},automaticPeople:{version:1,maxCompanies:800,maxSearchPagesPerCompany:1,searchPageSize:50,maxContactsPerCompany:3,includePhones:false}}},execution:{productionPipeline:'hybrid-firmable-v1',pipeline:'hybrid-company-v1',peopleResearch:true,backgroundResearch:false},providerPolicy:{version:3,callAdmission:'per_request',usdAdmission:'company_phase_people_per_request',requestCeilingMicroUsd:'1000000',requestCeilingsMicroUsd:{firmable:'1000000',search:'1000000',page:'1000000',ai:'1000000'},firmableCompanyRequestCeilingMicroUsd:'0',pricingBasis:'configured_company_plus_metered_people',maxAttempts:{firmable:24024,search:6,page:5,ai:0}}};
}
function render(input:Record<string,unknown>){return renderToStaticMarkup(<AgentNativeProposalDetails name="research.start" input={input}/>);}

it('discloses combined company and basic contact approval with separate per-request People funding',()=>{
 const input=combined();expect(nativeProposalReviewable('research.start',input)).toBe(true);
 const html=render(input);
 for(const value of ['Company research and basic contacts','Names, roles and available email addresses','3 contacts per matched company','1 search page of up to 50 rows','separate credit-consuming action','Firmable: 24024','Search: 6','Pages: 5','AI: 0','$11','$1 per physical People request','24,035','15-minute','not a quoted provider charge','does not approve outreach'])expect(html).toContain(value);
 for(const absent of ['Company research only','People enrichment is off','company-only Firmable incremental reserve','All Firmable requests are free','full reserve is allocated','Incomplete proposal'])expect(html).not.toContain(absent);
});

it('blocks combined proposals whose People scope, pricing or continuation differs from the reviewed contract',()=>{
 for(const change of [
  (input:ReturnType<typeof combined>)=>{input.config.includePhones=true;},
  (input:ReturnType<typeof combined>)=>{input.config.includeCompanyPeople=false;},
  (input:ReturnType<typeof combined>)=>{input.config.companyDiscoveryPolicy.automaticPeople.maxContactsPerCompany=50;},
  (input:ReturnType<typeof combined>)=>{input.execution.peopleResearch=false;},
  (input:ReturnType<typeof combined>)=>{input.providerPolicy.requestCeilingsMicroUsd.firmable='0';},
  (input:ReturnType<typeof combined>)=>{input.providerPolicy.firmableCompanyRequestCeilingMicroUsd='1000000';},
  (input:ReturnType<typeof combined>)=>{Object.assign(input.config,{companyOnly:true});},
  (input:ReturnType<typeof combined>)=>{Object.assign(input.config,{companyContinuation:{version:1,sourceRootId:'00000000-0000-4000-8000-000000000001',sourceDigest:'a'.repeat(64),candidateKeys:['firmable:f1']}});}
 ]){const input=combined();change(input);expect(nativeProposalReviewable('research.start',input)).toBe(false);expect(render(input)).toContain('Incomplete proposal');}
});

it('preserves the historical V4 company-only approval wording and scope',()=>{
 const next=combined(),input={...next,config:{...next.config,companyDiscoveryPolicy:buildAllDiscoveredCompanyPolicy(),includeCompanyPeople:false,companyOnly:true},execution:{...next.execution,peopleResearch:false},providerPolicy:{version:2,companyOnly:true,callAdmission:'per_request',requestCeilingMicroUsd:'1000000',requestCeilingsMicroUsd:{firmable:'0',search:'1000000',page:'1000000',ai:'1000000'},pricingBasis:'configured_company_only_incremental',maxAttempts:{firmable:24024,search:6,page:5,ai:0}}};
 expect(nativeProposalReviewable('research.start',input)).toBe(true);
 const html=render(input);for(const value of ['Company research only','People enrichment is off','Configured company-only Firmable incremental reserve: $0','not an observed invoice price'])expect(html).toContain(value);
 expect(html).not.toContain('Company research and basic contacts');
});

it('hides internal sender physical identifiers while preserving recipients and safe account aliases in contact review',()=>{
 const id='00000000-0000-4000-8000-000000000001',phone='+999882000000001',physical='physical-'+'d'.repeat(64);
 const route={channel:'whatsapp',recipient:{kind:'phone',value:phone},bindingId:id,bindingDigest:'a'.repeat(64),identityProof:{kind:'recorded_contact',revision:'1'},senderLabel:`whatsapp · whatsapp · ${physical}`};
 const input={nativeTargetSelectionVersion:1,delivery:{mode:'channels',policyRevision:1},selected:[{contactId:id,targetId:id,name:'Demo lead',fit:[],channels:[route]}]};const before=JSON.stringify(input);
 expect(nativeProposalReviewable('target.select',input)).toBe(true);
 const html=renderToStaticMarkup(<AgentNativeProposalDetails name="target.select" input={input}/>);expect(html).toContain('Recorded WhatsApp account');expect(html).toContain(phone);expect(html).not.toContain(physical);expect(html).not.toContain('Simulated WhatsApp account');expect(JSON.stringify(input)).toBe(before);
 route.senderLabel='Acquisitions team';expect(renderToStaticMarkup(<AgentNativeProposalDetails name="target.select" input={input}/>)).toContain('Acquisitions team');
 route.senderLabel='Simulated WhatsApp account';expect(renderToStaticMarkup(<AgentNativeProposalDetails name="target.select" input={input}/>)).toContain('Simulated WhatsApp account');
});

it('puts people and useful company context first and folds exact routes and shared setup into details',()=>{
 const id='00000000-0000-4000-8000-000000000001';
 const input={nativeTargetSelectionVersion:1,delivery:{mode:'channels',policyRevision:9},selected:[{contactId:id,targetId:id,name:'Rahul Sunail',recipient:'lead-402@agent-deep-gui-20261020.leads.acquire.test',qualificationConfirmed:false,fit:[],channels:[{channel:'email',recipient:{kind:'email',value:'lead-402@agent-deep-gui-20261020.leads.acquire.test'},bindingId:id,bindingDigest:'a'.repeat(64),identityProof:{kind:'recorded_contact',revision:'1'},senderLabel:'email · gmail · physical-record'}]}]};
 const html=renderToStaticMarkup(<AgentNativeProposalDetails name="target.select" input={input} people={[{id,name:'Rahul Sunail',company:'Acme Services',role:'Director'}]}/>);
 expect(html).toContain('Acme Services');expect(html).toContain('Director');expect(html).toMatch(/<summary[^>]*>Details<\/summary>/);
 expect(html.indexOf('Acme Services')).toBeLessThan(html.indexOf('Details'));
 expect(html).not.toContain('Policy version');expect(html).not.toContain('requires your review');
});
