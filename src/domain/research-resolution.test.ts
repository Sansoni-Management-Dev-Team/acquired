import { expect, it } from 'vitest';
import type { ResearchFinding } from './research';
import { resolveCompanyField } from './research-resolution';
import { fieldSatisfied, fieldCompletionMessage } from './research-objectives';
const count = (value: string, basis = 'reported', sourceKind = 'company_profile') => ({ kind: 'headcount', name: 'Headland Technology', value, quote: `Company size ${value}`, website: 'https://linkedin.com/company/headland', factMetadata: { basis, sourceKind, scope: 'unspecified', identityNote: null, currency: null, period: null } }) as ResearchFinding;
it('keeps Headland conflicting reported ranges open without inventing an exact count', () => {
 const findings = [count('11-50 employees'), count('51-200 employees'), count('101-200 employees')];
 expect(resolveCompanyField('size', findings)).toMatchObject({status:'conflicting',selected:null});
 expect(fieldSatisfied('size',findings)).toBe(false);
});
it('keeps estimates as observations but never marks them sourced', () => {
 const findings = [count('148 employees','third_party_estimate','third_party_directory')];
 expect(resolveCompanyField('size', findings)).toMatchObject({status:'estimated',selected:{value:'148 employees'}});
 expect(fieldSatisfied('size',findings)).toBe(false);
});
it('selects reported profile ranges over less reliable conflicting directory estimates', () => {
 const findings=[count('51-200 employees'),count('11-50 employees','third_party_estimate','third_party_directory')];
 expect(resolveCompanyField('size',findings)).toMatchObject({status:'observed',selected:{value:'51-200 employees'},superseded: [findings[1]]});
 expect(fieldSatisfied('size',findings)).toBe(true);
});
it('keeps identity ambiguity and differing reporting scopes open',()=>{
 expect(fieldSatisfied('size',[{...count('51-200 employees'),factMetadata:{...count('').factMetadata!,identityNote:'Different website; confirm identity'}}])).toBe(false);
 expect(resolveCompanyField('size',[count('51-200 employees'),{...count('400 employees'),factMetadata:{...count('').factMetadata!,scope:'group'}}]).status).toBe('conflicting');
});
it('does not claim email success for a people-only job',()=>{
 expect(fieldCompletionMessage('people')).toBe('Sourced owner or director candidate found; email availability is checked separately.');
 expect(fieldCompletionMessage('email')).toBe('Sourced published owner or director email found.');
});
it('treats incomplete legacy facts and search snippets as missing, not completion',()=>{
 expect(resolveCompanyField('size',[{kind:'headcount'} as ResearchFinding]).status).toBe('missing');
 expect(fieldSatisfied('size',[count('51-200 employees','search_snippet')])).toBe(false);
 expect(resolveCompanyField('size',[])).toMatchObject({status:'missing',selected:null});
});
it('does not invent currencies or accept conflicting revenue observations',()=>{
 const revenue=(value:string,currency:string|null='AUD') => ({...count(value),kind:'revenue',factMetadata:{...count('').factMetadata!,currency}}) as ResearchFinding;
 expect(resolveCompanyField('revenue',[revenue('$100 million'),revenue('$20 million')])).toMatchObject({status:'conflicting',selected:null});
 expect(fieldSatisfied('revenue',[revenue('$100 million',null)])).toBe(false);
 expect(fieldSatisfied('revenue',[revenue('$100 million')])).toBe(true);
});
