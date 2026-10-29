import{it,expect}from'vitest';
import{companyMandateScope,companyFieldRelevant,providerCompanyFields}from'./company-web-research-policy';
it('uses specified saved brief criteria as well as the discovery sector',()=>{
 const scope=companyMandateScope({brief:{naturalLanguage:'Commercial refrigeration',criteria:[{state:'specified',value:'NATA accreditation required'},{state:'unknown',value:'staff profiles'}]}},'Commercial refrigeration');
 expect(companyFieldRelevant('accreditations',scope)).toBe(true);expect(companyFieldRelevant('team_members',scope)).toBe(false);
});
it('does not make explicitly optional accreditation a generic requirement',()=>{
 expect(companyFieldRelevant('accreditations','Commercial refrigeration; NATA is not required')).toBe(false);
});
it('does not turn provider employee or people counts into named team members',()=>{
 const fields=providerCompanyFields({employee_count:0,team_members:20,people_summary:{available:12}});
 expect(fields.has('employee_count')).toBe(true);expect(fields.has('team_members')).toBe(false);
});
it('keeps individual certificate standards unknown when the provider only reports register membership',()=>{
 const raw={region:{AU:{org_registers:{nata:'NATA association'}}}};
 expect(providerCompanyFields(raw,'NATA accreditation').has('accreditations')).toBe(true);
 expect(providerCompanyFields(raw,'NATA accreditation with ISO 17025 standard').has('accreditations')).toBe(false);
});
it('does not treat a contractor directory category or a false register flag as accreditation',()=>{
 expect(providerCompanyFields({org_registers:{'hvac-contractors':'HVAC contractors (AU)'}},'Commercial refrigeration with accreditation').has('accreditations')).toBe(false);
 expect(providerCompanyFields({org_registers:{nata:false}},'NATA accreditation').has('accreditations')).toBe(false);
});
