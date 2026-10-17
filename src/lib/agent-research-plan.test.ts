import {describe,it,expect} from 'vitest';
import {emptyBrief} from '@/domain/acquisition';
import {buildAgentResearchPlan} from './agent-research-plan';
const ids={researchJobId:'12927bba-1515-482e-b8b6-3815403b5b7c',responsibilityId:'fc12b514-dfd7-42da-98b7-447591464c33',responsibilityRevision:1,mandateRevision:'123'};
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
