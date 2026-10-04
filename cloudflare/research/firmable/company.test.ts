import {expect,it} from 'vitest';
import {expandCompanyProfile} from './company';
it('exposes regional identifiers and company contacts without replacing global headcount',()=>{
 const raw={id:'f123',employee_count:42,industry_codes:{anzsic:'6925'},region:{AU:{employee_count:30,emails:['info@example.test'],phones:['1300 123 456'],business_identifiers:{abn:{value:'26609047878'},acn:{value:'609047878'}},locations:[{name:'Virginia'}]},NZ:{emails:['nz@example.test']}}};
 const result=expandCompanyProfile(raw,'AU');
 expect(result.abn).toBe('26609047878');expect(result.acn).toBe('609047878');expect(result.industry_codes).toEqual({anzsic:'6925',abn:'26609047878',acn:'609047878'});
 expect(result.company_emails).toEqual(['info@example.test']);expect(result.company_phones).toEqual(['1300 123 456']);expect(result.employee_count).toBe(42);
 expect(result.company_details.employee_count).toBe(30);expect(result.available_people_count).toBeNull();expect(result.browserResponse).toEqual(raw);
});
it('keeps unknown company contacts and contact counts empty rather than inventing them',()=>{
 const result=expandCompanyProfile({id:'f123',employee_count:40,region:{NZ:{emails:['nz@example.test']}}},'AU');
 expect(result.company_details.available).toBe(false);expect(result.company_emails).toEqual([]);expect(result.abn).toBeNull();expect(result.available_people_count).toBeNull();
});
