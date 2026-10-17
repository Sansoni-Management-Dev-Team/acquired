import {it,expect} from 'vitest';
import {buildAgentPeoplePlan} from './agent-people-plan';
const base={mandateRevision:'123',responsibilityId:'fc12b514-dfd7-42da-98b7-447591464c33',responsibilityRevision:1,researchJobId:'a1a639c7-169c-4bcd-893a-991470047023'};
const company={targetId:'a7cb06d3-2f07-4426-bb94-708cd425177c',name:'Synthetic company',firmableId:'f123',sourceRevision:'a'.repeat(64),blockedReasons:[]};
it('freezes bounded companies/source tokens and requests separate email-only human approval',()=>{const plan=buildAgentPeoplePlan({...base,companies:[company]});expect(plan).toMatchObject({selected:[company],maxContactsPerCompany:3,includePhones:false});expect(plan.body).toContain('No phone reveal');expect(buildAgentPeoplePlan({...base,companies:[company],researchJobId:'700ea5af-232a-41b4-8f3e-d5e25dc75eab'}).contextRevision).toBe(plan.contextRevision);});
it('excludes cached, contacted or suppressed companies and never manufactures an empty launch',()=>{expect(()=>buildAgentPeoplePlan({...base,companies:[{...company,blockedReasons:['previously_contacted']}]})).toThrow(/No reviewed/);});
it('keeps an eligible company when another cached company has no provider identifier',()=>{expect(buildAgentPeoplePlan({...base,companies:[{...company,firmableId:'',blockedReasons:['missing_firmable_company']},company]}).selected).toEqual([company]);});
