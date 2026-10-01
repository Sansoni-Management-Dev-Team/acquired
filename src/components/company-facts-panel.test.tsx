import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CompanyEvidenceSummary } from './company-facts-panel';
import type { SavedResearchFinding } from '@/domain/research';
const count=(value:string,basis:'reported'|'third_party_estimate'='reported'):SavedResearchFinding=>({id:value,jobId:'job',targetId:'target',confidence:0.5,sourceUrl:'https://headland.au/about',observedAt:'2026-10-01',evidence:{kind:'headcount',name:'Headland Technology',value,quote:`Company size ${value}`,website:'https://headland.au',factMetadata:{basis,sourceKind:basis==='reported'?'company_profile':'third_party_directory',currency:null,period:null,scope:'unspecified',identityNote:null}}});
it('detail shows the selected published range without calling weaker estimates contradictory',()=>{
 const html=renderToStaticMarkup(<CompanyEvidenceSummary findings={[count('51-200 employees'),count('11-50 employees','third_party_estimate')]} searches={3}/>);
 expect(html).toContain('51-200 employees');expect(html).not.toContain('Sources disagree');expect(html).not.toContain('11-50 employees');
});
it('detail marks equally authoritative disjoint Headland ranges unresolved',()=>{
 const html=renderToStaticMarkup(<CompanyEvidenceSummary findings={[count('11-50 employees'),count('51-200 employees')]} searches={3}/>);
 expect(html).toContain('Sources disagree');expect(html).not.toContain('51-200 employees · Found');
});
it('detail distinguishes estimate-only headcount from sourced observations',()=>{
 const html=renderToStaticMarkup(<CompanyEvidenceSummary findings={[count('148 employees','third_party_estimate')]} searches={3}/>);
 expect(html).toContain('Estimates only');expect(html).not.toContain('Found — awaiting review');
});
