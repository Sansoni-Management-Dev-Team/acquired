import { expect,it,vi } from 'vitest';
import { ebitdaBenchmarks } from './estimated-ebitda';
import { resolveTargetEbitda } from './target-financial-evidence';
import { mapFirmableProfile } from '@/adapters/firmable-company-mapper';
import reference from './data/abs-ebitda-benchmarks.json';
const mandate={states:['VIC'],sectors:['Manufacturing'],revenue:{min:0,max:null},ebitda:{min:0,max:null}};
const target=(revenue:unknown='AUD $4M - $6M',currency='AUD')=>mapFirmableProfile({id:'synthetic',name:'Synthetic Manufacturing',website:'https://operator.example.com',industries:['Manufacturing'],employee_count:900,revenue,revenue_currency:currency,region:{AU:{employee_count:25,revenue:'No data available'}}},mandate,'org');
const margins=(id:string)=>reference.benchmarks.find(b=>b.id===id)!.observations.filter(o=>typeof o.salesServiceIncomeMillions==='number'&&o.salesServiceIncomeMillions>0).map(o=>o.ebitdaMillions/o.salesServiceIncomeMillions!);
it('uses same-period EBITDA divided by sales and service income across revenue-band endpoint combinations',()=>{
 const t=target();const estimate=resolveTargetEbitda([],25,t,'division-manufacturing');const rates=margins('division-manufacturing');const values=rates.flatMap(r=>[4e6*r,6e6*r]);
 expect(estimate).toMatchObject({status:'estimated',modelBasis:'revenue',modelVersion:'abs-revenue-margin-v1',revenueRange:{min:4e6,max:6e6},marginRange:{min:Math.min(...rates),max:Math.max(...rates)},match:{method:'manual'}});expect(estimate.low).toBe(Math.round(Math.min(...values)));expect(estimate.high).toBe(Math.round(Math.max(...values)));expect(estimate.benchmark?.cells).toContain('D');
});
it('preserves negative and sign-changing EBITDA margins without clipping or averaging a workforce model',()=>{
 for(const id of ['anzsic-95','anzsic-89']){const estimate=resolveTargetEbitda([],25,target(),id);const values=margins(id).flatMap(m=>[4e6*m,6e6*m]);expect(estimate.low).toBe(Math.round(Math.min(...values)));expect(estimate.high).toBe(Math.round(Math.max(...values)));}
 expect(resolveTargetEbitda([],25,target(),'anzsic-95').high).toBeLessThan(0);expect(resolveTargetEbitda([],25,target(),'anzsic-89').low).toBeLessThan(0);expect(resolveTargetEbitda([],25,target(),'anzsic-89').high).toBeGreaterThan(0);
});
it('reported signed EBITDA wins over every model while preserving its source and basis',()=>{
 const t=target();t.ebitda={value:-120000,provenance:{source:'Reviewed financial statements',sourceUrl:'https://operator.example.com/accounts',capturedAt:'2026-10-08T00:00:00Z',confidence:95,currency:'AUD',scope:'AU'}};
 expect(resolveTargetEbitda([],25,t)).toMatchObject({status:'estimated',modelBasis:'reported',earningsBasis:'reported',low:-120000,high:-120000,source:{source:'Reviewed financial statements'}});
});
it('company revenue cannot be compared to AU-only workforce; optional AU scope permits a separate comparison',()=>{
 const t=target();expect(resolveTargetEbitda([],25,t).modelWarnings?.join(' ')).toMatch(/incomparable|different scope/i);expect(resolveTargetEbitda([],25,t).headcountComparison).toBeUndefined();
 t.sourceData!.firmable!.rawResponse={...t.sourceData!.firmable!.rawResponse,region:{AU:{employee_count:25,revenue:'AUD $4M - $6M',revenue_currency:'AUD'}}};delete t.sourceData!.firmable!.scopedFacts;
 expect(resolveTargetEbitda([],25,t,undefined,'AU')).toMatchObject({modelBasis:'revenue',revenueRange:{scope:'AU'},headcountComparison:{modelBasis:'headcount',status:'estimated'}});
});
it('zero sourced revenue remains zero EBITDA and unusable foreign-currency revenue falls back visibly to headcount',()=>{
 expect(resolveTargetEbitda([],25,target(0))).toMatchObject({status:'estimated',modelBasis:'revenue',low:0,high:0});
 expect(resolveTargetEbitda([],25,target('USD $4M - $6M','USD'))).toMatchObject({status:'estimated',modelBasis:'headcount',modelVersion:'abs-headcount-v4'});
 expect(resolveTargetEbitda([],25,target('USD $4M - $6M','USD')).modelWarnings?.join(' ')).toMatch(/revenue.*unusable|currency/i);
});
it('unconfirmed industries remain review-required and explicit unknown benchmark remains unavailable',()=>{
 const t=target();t.sourceData!.firmable!.rawResponse={...t.sourceData!.firmable!.rawResponse,industries:[]};delete t.sourceData!.firmable!.scopedFacts;
 expect(resolveTargetEbitda([],25,t)).toMatchObject({modelBasis:'revenue',match:{method:'fallback',needsReview:true}});expect(resolveTargetEbitda([],25,t,'missing-benchmark')).toMatchObject({status:'unavailable'});
});
it('uses actual regional AU fallback scope and refuses to relabel manual company revenue or EBITDA as AU',()=>{
 const regional=target();regional.sourceData!.firmable!.rawResponse={...regional.sourceData!.firmable!.rawResponse,revenue:null,region:{AU:{employee_count:25,revenue:'AUD $4M - $6M',revenue_currency:'AUD'}}};delete regional.sourceData!.firmable!.scopedFacts;
 expect(resolveTargetEbitda([],25,regional)).toMatchObject({modelBasis:'revenue',revenueRange:{scope:'AU'},headcountComparison:{modelBasis:'headcount'}});
 const manual=target();manual.revenue={value:4e6,provenance:{source:'Reviewed group accounts',capturedAt:'2026-10-08T00:00:00Z',confidence:95,currency:'AUD',scope:'global'}};
 expect(resolveTargetEbitda([],25,manual,undefined,'AU')).toMatchObject({status:'unavailable'});
 manual.ebitda={value:1e6,provenance:{source:'Reviewed group accounts',capturedAt:'2026-10-08T00:00:00Z',confidence:95,currency:'AUD',scope:'global'}};
 expect(resolveTargetEbitda([],25,manual,undefined,'AU')).toMatchObject({status:'unavailable',modelBasis:'reported'});
});
it('omits missing denominator periods rather than treating them as zero or borrowing another year',()=>{
 const t=resolveTargetEbitda([],25,target(),'anzsic-17'),rates=margins('anzsic-17');expect(t.marginRange).toEqual({min:rates[0],max:rates[0]});expect(t.benchmark?.periods).toEqual(['2023-24']);expect(t.low).toBe(Math.round(4e6*rates[0]));expect(t.high).toBe(Math.round(6e6*rates[0]));
});
it('zero EBITDA numerators remain usable and non-positive denominator-only benchmarks remain unavailable',()=>{
 const benchmark=structuredClone(ebitdaBenchmarks.find(b=>b.id==='division-manufacturing')!);
 benchmark.observations.forEach((o,i)=>{o.salesServiceIncomeMillions=100;o.ebitdaMillions=i*10;});
 const selected=vi.spyOn(ebitdaBenchmarks,'find').mockReturnValue(benchmark);
 try{
  expect(resolveTargetEbitda([],25,target(),'division-manufacturing')).toMatchObject({modelBasis:'revenue',low:0,high:1200000,marginRange:{min:0,max:0.2}});
  benchmark.observations.forEach((o,i)=>{o.salesServiceIncomeMillions=i%2?0:-1;});
  expect(resolveTargetEbitda([],25,target(),'division-manufacturing')).toMatchObject({status:'unavailable',modelBasis:'revenue'});
 }finally{selected.mockRestore();}
});
