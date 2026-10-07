import {expect,it} from 'vitest';
import {briefSchema,briefToMandate,emptyBrief,worksheet,initialAssessment} from './acquisition';
import {mapFirmableProfile} from '@/adapters/firmable-company-mapper';
import {rankTarget} from './scoring';
import {reviewMandateFit} from './mandate-fit';
it('preserves explicit AU financial scope through brief validation and filter derivation',()=>{
 const brief={...emptyBrief(),financialScope:'AU' as const};
 expect(briefSchema.parse(brief).financialScope).toBe('AU');
 expect(briefToMandate(brief).financialScope).toBe('AU');
});
it('worksheet and fit use AU revenue only for an AU-scoped brief',()=>{
 const brief={...emptyBrief(),financialScope:'AU' as const};
 Object.assign(brief.criteria.find(c=>c.key==='revenue')!,{state:'specified',value:'1000000-2000000'});
 const mandate=briefToMandate(brief);const t=rankTarget(mapFirmableProfile({id:'fixture',name:'Synthetic',hq_country:'AU',revenue:'$10M - $50M',revenue_currency:'AUD',region:{AU:{revenue:1500000,revenue_currency:'AUD'},NZ:{}}},mandate,'fixture'),mandate);
 expect(worksheet(brief,t,initialAssessment).find(c=>c.criterionKey==='revenue')?.value).toContain('1,500,000');
 expect(reviewMandateFit(brief,t,initialAssessment).rows.find(r=>r.key==='revenue')?.status).not.toBe('fails');
});
it('does not mark company EBITDA comparable under an explicit AU financial brief',()=>{
 const brief={...emptyBrief(),financialScope:'AU' as const};Object.assign(brief.criteria.find(c=>c.key==='ebitda')!,{state:'specified',value:'100000-500000'});
 const mandate=briefToMandate(brief);const t=rankTarget(mapFirmableProfile({id:'fixture',name:'Synthetic',hq_country:'AU',revenue:'$1M - $2M',region:{AU:{},NZ:{}}},mandate,'fixture'),mandate);
 t.ebitda={value:200000,provenance:{source:'Reviewed group accounts',capturedAt:'2026-10-01',confidence:95,currency:'AUD',scope:'global'}};
 const withoutEarnings={...t,ebitda:{...t.ebitda,value:null}};
 expect(rankTarget(t,mandate).scores.fit).toBe(rankTarget(withoutEarnings,mandate).scores.fit);
 expect(worksheet(brief,t,initialAssessment).find(c=>c.criterionKey==='ebitda')?.assessment).toBe('unknown');
 expect(reviewMandateFit(brief,t,initialAssessment).rows.find(r=>r.key==='ebitda')?.status).toBe('unknown');
});
