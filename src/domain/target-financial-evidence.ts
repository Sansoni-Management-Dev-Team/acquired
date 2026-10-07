import { estimateEbitda,ebitdaBenchmarks,matchEbitdaBenchmark,ebitdaBenchmarkId,type EstimatedEbitda,type BenchmarkMatch,type EbitdaScenario } from './estimated-ebitda';
import reference from './data/abs-ebitda-benchmarks.json';
import { parseCompanyBand } from './firmable-company-pipeline';
import type { FinancialValue, TargetCandidate, Mandate } from './models';
import { companyScopedFacts,independentRevenue,revenueFromCompanyFact } from './company-scoped-facts';
import type { SavedResearchFinding } from './research';

/** A dollar symbol alone does not establish AUD. */
export function financialInterval(value: FinancialValue | null, currency?: string) {
  if (value === null || currency && currency !== "AUD") return null;
  if (typeof value === 'number') return currency === 'AUD' ? { min: value, max: value, estimated: false } : null;
  if (value.kind === 'range') return currency === 'AUD' ? { min: value.min, max: value.max, estimated: false } : null;
  if (currency !== 'AUD' && !/\bAUD\b|A\$/i.test(value.label)) return null;
  const band = parseCompanyBand(value.label, true);
  return band ? { min: band.min, max: band.max, estimated: true } : null;
}

export function resolveTargetEbitda(findings: SavedResearchFinding[], preferredHeadcount?: number, target?: TargetCandidate,benchmarkId?:string,financialScope:'company'|'AU'='company'):EstimatedEbitda {
  const reported=target?.ebitda;
  const observed=reported && reported.provenance.basis!=='modelled' && reported.researchState!=='estimated' ? financialInterval(reported.value,reported.provenance.currency):null;
  if(observed && observed.max!==null && Number.isFinite(observed.min) && Number.isFinite(observed.max) && observed.min<=observed.max){
    if(financialScope==='AU' && reported!.provenance.scope!=='AU')return{status:'unavailable',modelBasis:'reported',earningsBasis:'reported',modelVersion:'reported-ebitda-v1',currency:'AUD',metric:'EBITDA',source:reported!.provenance,headcountFindingIds:[],sizeComparisons:[],reason:'Reported EBITDA does not have explicit AU scope.',limitations:['Reported company/group earnings are retained; no silent AU model replacement applied.'],modelWarnings:['Reported EBITDA scope is incompatible with the requested Australian financial scope.']};
    return{status:'estimated',modelBasis:'reported',earningsBasis:'reported',modelVersion:'reported-ebitda-v1',currency:'AUD',metric:'EBITDA',low:observed.min,high:observed.max,source:reported!.provenance,headcountFindingIds:[],sizeComparisons:[],limitations:['Reported EBITDA retained from its source; no industry margin or workforce model applied.'],modelWarnings:[]};
  }
  const facts=target?.sourceData?.firmable?.scopedFacts || (target?.sourceData?.firmable?.rawResponse ? companyScopedFacts(target.sourceData.firmable.rawResponse,target.sourceData.firmable.capturedAt) : undefined);
  const industryFindings:SavedResearchFinding[]=facts?.industries.value?.map((value,index)=>({id:`provider-industry-${index}`,sourceUrl:facts.industries.sourceUrl || '',observedAt:facts.industries.capturedAt,confidence:.7,evidence:{kind:'industry' as const,name:'Industry',value,quote:value,relevance:'unclear' as const}} as SavedResearchFinding)) || [];
  const scopedCount=facts?facts.headcount.AU.value ?? undefined:preferredHeadcount;
  const compatibleFindings=[...findings.filter(f => !f.evidence.factMetadata?.identityNote && !(facts && f.evidence.kind === 'headcount')),...industryFindings];
  const workforce=estimateEbitda(compatibleFindings, benchmarkId,
    scopedCount === undefined ? undefined : { value: scopedCount, source: facts ? 'Australian company workforce' : 'company data' });
  const headcount:EstimatedEbitda={...workforce,modelBasis:'headcount',earningsBasis:'modelled'};
  const revenue=target?resolveTargetRevenue(target,financialScope):undefined;
  const interval=revenue?financialInterval(revenue.value,revenue.provenance.currency):null;
  if(financialScope==='AU' && revenue?.value!==null && revenue?.value!==undefined && revenue.provenance.scope!=='AU')return{...headcount,status:'unavailable',low:undefined,high:undefined,benchmark:undefined,modelBasis:'revenue',reason:'Revenue does not have explicit AU scope.',modelWarnings:['Company/group revenue cannot be relabelled as Australian revenue; no replacement model applied.']};
  if(!revenue || !interval || interval.max===null || !Number.isFinite(interval.min) || !Number.isFinite(interval.max) || interval.min<0 || interval.min>interval.max){
    const warning=`Revenue is unusable for an AUD margin model${revenue?.provenance.currency?` (currency ${revenue.provenance.currency})`:': bounded revenue and currency are required'}; headcount fallback is a separate indicative model.`;
    return{...headcount,modelWarnings:[warning],limitations:[...headcount.limitations,warning]};
  }
  const industries=compatibleFindings.filter(f=>f.evidence.kind==='industry').map(f=>f.evidence.value);
  const match:BenchmarkMatch=benchmarkId?{id:ebitdaBenchmarkId(benchmarkId),method:'manual',description:'Industry benchmark selected manually.',needsReview:false}:matchEbitdaBenchmark(industries);
  const benchmark=ebitdaBenchmarks.find(b=>b.id===match.id);
  const observations=benchmark?.observations.filter(o=>typeof o.salesServiceIncomeMillions==='number'&&Number.isFinite(o.salesServiceIncomeMillions)&&o.salesServiceIncomeMillions>0&&Number.isFinite(o.ebitdaMillions)) || [];
  if(!benchmark || !observations.length)return{...headcount,status:'unavailable',low:undefined,high:undefined,benchmark:undefined,modelBasis:'revenue',reason:benchmark?'Selected benchmark has no usable same-period sales and service income denominator.':'Selected benchmark is unavailable. Choose another industry.',match,modelWarnings:['Revenue model cannot be calculated from the selected benchmark.']};
  const margins=observations.map(o=>o.ebitdaMillions/o.salesServiceIncomeMillions!);
  const actualScope=revenue.provenance.scope==='AU'?'AU' as const:'company' as const;
  const min=interval.min,max=interval.max;
  const marginRange={min:Math.min(...margins),max:Math.max(...margins)},revenueRange={min,max,scope:actualScope,currency:'AUD' as const};
  const values=margins.flatMap(m=>[min*m,max*m]);
  const low=Math.round(Math.min(...values)),high=Math.round(Math.max(...values)),latest=observations.at(-1)!;
  const selected:EbitdaScenario={id:benchmark.id,label:benchmark.label,low,high,period:latest.period.replace('-','–'),periods:observations.map(o=>o.period),sourceUrl:reference.sourceUrl,sheet:benchmark.sheet,cells:observations.map(o=>`${o.period}: ${o.cells}; sales and service income ${o.salesServiceIncomeCell}`).join('; '),modelBasis:'revenue',marginRange,revenueRange};
  const modelWarnings:string[]=[];
  if(observations.length<benchmark.observations.length)modelWarnings.push('Some benchmark periods have missing or non-positive sales and service income denominators and were omitted; no other-year denominator was substituted.');
  const comparable=actualScope==='AU' && facts?.headcount.AU.value!==null && facts?.headcount.AU.value!==undefined && headcount.status==='estimated';
  if(headcount.status==='estimated'&&!comparable)modelWarnings.push('Company/group revenue and Australian-only workforce have different scope and are incomparable; no workforce comparison or averaging applied.');
  if(comparable && (headcount.high!<low || headcount.low!>high))modelWarnings.push('Revenue-margin and AU workforce scenarios disagree: their ranges do not overlap. They remain independent scenarios and are not averaged.');
  if(match.needsReview)modelWarnings.push(match.description);
  if(revenue.provenance.assumption)modelWarnings.push(revenue.provenance.assumption);
  if(benchmark.level==='size'&&!comparable)modelWarnings.push('The selected employee-size cohort is not independently supported by a workforce count of matching financial scope.');
  const limitations=[
    'Indicative annual EBITDA from revenue multiplied by historical industry EBITDA / sales and service income ratios; not reported earnings or a confidence interval.',
    'Numerator and denominator use the same ABS industry population and financial period; the margin is not the ABS operating profit before tax profit-margin statistic.',
    actualScope==='company'?'Company/group revenue input; do not interpret this as Australian operating-company EBITDA.':'Australian revenue input; geographic scope must remain consistent with operating-company evidence.',
    'The range uses all available same-period signed annual margins and both revenue endpoints. Negative and zero earnings remain possible; business-specific variation is not measured.',
    'Revenue reported by a provider may differ from ABS sales and service income. Confirm the business revenue definition, financial period, industry and currency before relying on the model.',
    ...modelWarnings,
  ];
  return{status:'estimated',currency:'AUD',metric:'EBITDA',low,high,modelBasis:'revenue',earningsBasis:'modelled',modelVersion:'abs-revenue-margin-v1',revenueRange,marginRange,source:revenue.provenance,benchmark:selected,match,sizeComparisons:[],headcountFindingIds:[],limitations,modelWarnings,...(comparable?{headcountComparison:headcount}:{})};
}

export function targetRevenueCurrency(target: TargetCandidate) {
  const raw = target.sourceData?.firmable?.rawResponse;
  return target.revenue.provenance.currency ?? (typeof raw?.revenue_currency === 'string' ? raw.revenue_currency : undefined);
}

export function effectiveRevenueRange(mandate: Mandate) {
  const max = Math.min(mandate.revenue.max ?? Infinity, mandate.revenueCeiling ?? Infinity);
  return { min: mandate.revenue.min, max: Number.isFinite(max) ? max : null };
}

/** Company revenue is primary; separately scoped AU observations/assumptions remain explicit. Manual evidence wins. */
export function resolveTargetRevenue(target:TargetCandidate,financialScope:Mandate['financialScope']='company'):TargetCandidate['revenue'] {
 if(independentRevenue(target))return target.revenue;
 const provider=target.sourceData?.firmable;
 const rawFacts=provider?.rawResponse?companyScopedFacts(provider.rawResponse,provider.capturedAt):undefined;
 const stored=provider?.scopedFacts;
 const facts=rawFacts||stored;if(!facts)return target.revenue;
 // Background observations are independently sourced and must survive raw-provider reprojection.
 const global=stored?.revenue.global.basis==='website'&&stored.revenue.global.value!==null?stored.revenue.global:facts.revenue.global;
 const au=stored?.revenue.AU.basis==='website'&&stored.revenue.AU.value!==null?stored.revenue.AU:facts.revenue.AU;
 return revenueFromCompanyFact(financialScope==='AU'?au:global.value?global:au);
}
