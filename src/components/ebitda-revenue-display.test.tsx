import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {EbitdaEstimatePanel} from './ebitda-estimate-panel';
import {mapFirmableProfile} from '@/adapters/firmable-company-mapper';
const mandate={sectors:['Manufacturing'],states:[],revenue:{min:0,max:null},ebitda:{min:0,max:null}};
const target=()=>mapFirmableProfile({id:'synthetic',name:'Synthetic manufacturer',hq_country:'AU',revenue:'$5M - $10M',industries:['Manufacturing'],employee_count:100,region:{AU:{employee_count:50},NZ:{}}},mandate,'test');
it('renders company revenue × industry margin, currency assumption and signed model provenance',()=>{
 const html=renderToStaticMarkup(<EbitdaEstimatePanel findings={[]} target={target()}/>);
 expect(html).toContain('Revenue × industry EBITDA margin');
 expect(html).toContain('abs-revenue-margin-v1');
 expect(html).toContain('AUD currency assumed');
 expect(html).toContain('Company/group');
 expect(html).not.toContain('50–50 people ×');
});
it('renders observed earnings without claiming a margin calculation or requiring a benchmark',()=>{
 const t=target();t.ebitda={value:350000,provenance:{source:'Reviewed accounts',capturedAt:'2026-10-01',currency:'AUD',confidence:95}};
 const html=renderToStaticMarkup(<EbitdaEstimatePanel findings={[]} target={t}/>);
 expect(html).toContain('Reported annual EBITDA');
 expect(html).toContain('$350,000');
 expect(html).not.toContain('Revenue × industry EBITDA margin');
});
