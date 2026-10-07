import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { companyScopedFacts } from './company-scoped-facts';
import { mapFirmableProfile } from '@/adapters/firmable-company-mapper';
import { targetRecordToRankedTarget } from '@/db/target-record-mapper';
import { companyCompleteness } from './research-completeness';
import { CompanyInfoSummary } from '@/components/company-info-summary';
import { emptyBrief, initialAssessment, criterion } from './acquisition';
import { rankTarget } from './scoring';
import { reviewMandateFit } from './mandate-fit';

const raw = { id:'f123', name:'Synthetic Australian Laboratory', website:'https://laboratory.example.test', hq_country:'AU', revenue:'<$1M', region:{AU:{address:{state:'NSW',suburb:'Sydney'},revenue:{10:'No data available'}}} };
const mandate = {sectors:['Laboratory testing'],states:['NSW'],revenue:{min:6000000,max:30000000},ebitda:{min:0,max:null}};
const observed = '2026-10-01T00:00:00Z';

it('uses the company band for an AU-only Australian profile with explicit assumptions and untouched raw/global evidence',()=>{
 const before=JSON.stringify(raw),facts=companyScopedFacts(raw,observed);
 expect(facts.revenue.AU).toMatchObject({value:{label:'<$1M',min:0,max:1000000},currency:'AUD',scope:'AU',capturedAt:observed});
 expect(facts.revenue.AU.assumption).toContain('AUD currency assumed');
 expect(facts.revenue.AU.missingReason).toBeUndefined();
 expect(facts.revenue.global).toMatchObject({value:{label:'<$1M'},scope:'global'});
 expect(facts.revenue.global.currency).toBeUndefined();
 expect(JSON.stringify(raw)).toBe(before);
});

it.each([
 {...raw,hq_country:'US'},
 {...raw,hq_country:undefined},
 {...raw,region:{...raw.region,NZ:{}}},
 {...raw,revenue_currency:'USD'},
 {...raw,revenue:'US$1M - US$2M'},
 {...raw,revenue:'NZD $1M - $2M'},
 {...raw,region:{AU:{...raw.region.AU,revenue_currency:'USD'}}},
 {...raw,revenue:'No data available'},
 {...raw,websiteResearch:{status:'complete'}},
])('does not infer AU revenue without Australian-only identity or with incompatible source data %#',input=>{
 expect(companyScopedFacts(input,observed).revenue.AU.value).toBeNull();
});

it('explicit regional revenue including zero wins; explicit profile currency and wrapped payloads retain provenance',()=>{
 const facts=companyScopedFacts({...raw,region:{AU:{revenue:0,revenue_currency:'USD',revenue_period:'FY2025'}}},observed);
 expect(facts.revenue.AU).toMatchObject({value:{min:0,max:0},currency:'USD',period:'FY2025'});
 expect(facts.revenue.AU.assumption).toBeUndefined();
 const wrapped=companyScopedFacts({browserResponse:{...raw,revenue_currency:'AUD',revenue_period:'FY2024'}},observed);
 expect(wrapped.revenue.AU).toMatchObject({currency:'AUD',period:'FY2024'});
 expect(wrapped.revenue.AU.assumption).not.toContain('currency assumed');
});

it('new mappings and legacy JSON reloads drive usable revenue, provisional fit, UI and completeness without a backfill',()=>{
 const candidate=mapFirmableProfile(raw,mandate,'synthetic-org');
 expect(candidate.revenue).toMatchObject({value:{kind:'band',label:'<$1M'},researchState:'estimated',provenance:{currency:'AUD',scope:'AU',confidence:60}});
 const t=rankTarget(candidate,mandate);
 const row=JSON.parse(JSON.stringify({id:t.id,organizationId:t.organisationId,companyName:t.companyName,domain:t.domain,identifiers:{},firmographics:{state:t.state,suburb:t.suburb,sector:t.sector,revenue:{...t.revenue,value:null},headcount:t.headcount,ebitda:t.ebitda,establishedYear:t.establishedYear,firmable:{...t.sourceData?.firmable,scopedFacts:undefined}},fitScore:0,ripenessScore:0,confidenceScore:0,financeabilityScore:null,band:'cold',qualification:'research',status:'enriched'}));
 const projected=targetRecordToRankedTarget(row,[]);
 expect(projected.revenue).toMatchObject(candidate.revenue);
 const brief=emptyBrief();Object.assign(criterion(brief,'revenue'),{state:'specified',value:'6000000–30000000'});
 const member={target:projected,assessment:initialAssessment,accreditations:[],version:1};
 const report=companyCompleteness(member,brief);
 for(const field of ['AU revenue band','Mapped revenue'])expect(report.cells.find(c=>c.field===field)).toMatchObject({status:'estimated',currency:'AUD',reason:expect.stringContaining('AU scope assumed')});
 expect(reviewMandateFit(brief,projected,initialAssessment).rows.find(r=>r.key==='revenue')).toMatchObject({status:'fails'});
 const html=renderToStaticMarkup(React.createElement(CompanyInfoSummary,{member}));
 expect(html).toContain('&lt;$1M');expect(html).toContain('Revenue assumptions');expect(html).toContain('AUD currency assumed');
});
