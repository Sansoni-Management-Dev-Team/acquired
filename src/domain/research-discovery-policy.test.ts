import {expect,it} from 'vitest';
import {balanceFirmableStaffBands,buildCompanyDiscoveryPolicy,reviewedCompanyDiscoveryPolicy,companyDiscoveryPolicySchema,buildAllDiscoveredCompanyPolicy} from './research-discovery-policy';
const rows=[{id:'large',au_employee_count:3},{id:'unknown',au_employee_count:99},{id:'small',au_employee_count:2},{id:'small2',au_employee_count:'2'}];
const proof={predictedFilters:{filters:{company_size:{'2':'11 - 50','3':'51 - 250'}},operators:{},excluded:{}},predictedCountry:{include:['AU'],operator:'OR'}};
it('uses only returned labels, keeps unknown evidence and never changes rows or treats codes as counts',()=>{const result=balanceFirmableStaffBands(rows,buildCompanyDiscoveryPolicy({min:30,max:80}),[proof]);expect(result.rows.map(r=>r.id)).toEqual(['small','large','small2','unknown']);expect(result.rows[0]).toBe(rows[2]);expect(result.summary.bands).toEqual([{label:'11 - 50',rows:2},{label:'51 - 250',rows:1}]);expect(rows[0].id).toBe('large');expect(balanceFirmableStaffBands(rows,reviewedCompanyDiscoveryPolicy,[proof]).rows).toBe(rows);});
it.each([
 {reason:'headcount_search_intent_unknown',policy:buildCompanyDiscoveryPolicy(),proofs:[proof]},
 {reason:'labelled_country_scope_ambiguous',proofs:[{...proof,predictedCountry:{include:['NZ'],operator:'OR'}}]},
 {reason:'staff_band_labels_unavailable',proofs:[{...proof,predictedFilters:{filters:{},operators:{},excluded:{}}}]},
 {reason:'staff_band_labels_conflict',proofs:[proof,{...proof,predictedFilters:{...proof.predictedFilters,filters:{company_size:{'2':'1 - 10','3':'51 - 250'}}}}]},
 {reason:'staff_band_labels_overlap',proofs:[{...proof,predictedFilters:{...proof.predictedFilters,filters:{company_size:{'2':'11 - 80','3':'51 - 250'}}}}]},
 {reason:'staff_band_labels_ambiguous',proofs:[{...proof,predictedFilters:{...proof.predictedFilters,filters:{company_size:{'2':'small','3':'medium'}}}}]},
])('retains the entire original sample when $reason',({reason,policy,proofs})=>{const r=balanceFirmableStaffBands(rows,policy??buildCompanyDiscoveryPolicy({min:30,max:80}),proofs);expect(r.rows).toBe(rows);expect(r.summary.reason).toBe(reason);});

it('accepts a distinct V5 all-discovered basic-People policy without weakening frozen V4',()=>{
 const old=buildAllDiscoveredCompanyPolicy();
 const people={version:1,maxCompanies:800,maxSearchPagesPerCompany:1,searchPageSize:50,maxContactsPerCompany:3,includePhones:false};
 const policy={...old,version:5,profileSelection:{...old.profileSelection,companyOnly:false},automaticPeople:people};
 expect(companyDiscoveryPolicySchema.parse(policy)).toEqual(policy);
 expect(companyDiscoveryPolicySchema.parse(old)).toEqual(old);
 expect(companyDiscoveryPolicySchema.safeParse({...old,automaticPeople:people}).success).toBe(false);
 for(const change of [{includePhones:true},{maxContactsPerCompany:4},{maxSearchPagesPerCompany:2},{maxCompanies:801},{searchPageSize:100}])expect(companyDiscoveryPolicySchema.safeParse({...policy,automaticPeople:{...people,...change}}).success).toBe(false);
});
