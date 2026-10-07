import type { Mandate, TargetCandidate } from './models';
import { companyScopedFacts } from './company-scoped-facts';
import { screenBand } from './firmable-company-pipeline';
import { effectiveRevenueRange, financialInterval, resolveTargetRevenue } from './target-financial-evidence';
export type CompanyScreenStatus='supported'|'review'|'excluded';
/** Activity needs an actual service claim. A topic keyword or supplier category alone is not evidence. */
export function activityScreen(target:TargetCandidate,mandate:Mandate):CompanyScreenStatus {
 const provider=target.sourceData?.firmable;const content=[provider?.description,provider?.tagline,target.sector.value].filter(Boolean).join('\n').toLowerCase();
 if (!content || /^(unclassified|unknown)$/i.test(content.trim())) return 'review';
 const sentences=content.split(/[.!?\n]+/).map(s=>s.trim()).filter(Boolean);
 for(const sector of mandate.sectors){
  const terms=sector.toLowerCase().split(/\W+/).filter(w=>w.length>2&&!['and','services','service','business','businesses'].includes(w));
  for(const sentence of sentences){
   if(/\b(?:not|never|no|without|don't|doesn't|cannot|can't)\b/i.test(sentence))continue;
   if(/\b(?:suppliers?|wholesale|directory|association|consultancy|consultants?|consulting|training|advice|blog|article)\b/i.test(sentence))continue;
   const offering=/\b(?:we|our|company|team)\b.{0,70}\b(?:provide|provides|perform|performs|offer|offers|deliver|delivers|operate|operates|speciali[sz]e|speciali[sz]es|maintain|maintains|inspect|inspects|test|tests|service|services|manufacture|manufactures|collect|collects|clean|cleans)\b|\bour\b.{0,65}\b(?:services|maintenance|operations)\b/i.test(sentence);
   if(!offering || /\bour\s+(?:customers?|clients?|partners?)\b.{0,35}\b(?:provide|offer|perform|deliver|maintain|inspect|test|service)\b/i.test(sentence))continue;
   if(/fire.*(?:maintenance|protection)/i.test(sector)){
    if(/\b(?:fire|extinguishers?|sprinklers?)\b/i.test(sentence)&&/\b(?:maintain(?:s|ing|ed)?|maintenance|inspect(?:s|ions?|ing)?|test(?:s|ing)?|servicing)\b/i.test(sentence))return 'supported';
   }else if(terms.length&&terms.every(term=>new RegExp(`\\b${term}\\b`,'i').test(sentence)))return 'supported';
  }
 }
 return 'review';
}
export function screenCompanyCandidate(target:TargetCandidate,mandate:Mandate){
 const provider=target.sourceData?.firmable;const facts=provider?.scopedFacts||(provider?.rawResponse?companyScopedFacts(provider.rawResponse,provider.capturedAt):undefined);
 const count=facts?.headcount.AU.value ?? (target.headcount.provenance.scope==='AU'?target.headcount.value:null);
 const revenueField=resolveTargetRevenue(target,mandate.financialScope);
 const revenue=mandate.financialScope==='AU'&&revenueField.provenance.scope!=='AU'?null:financialInterval(revenueField.value,revenueField.provenance.currency);
 const operating=facts ? facts.operatingStates.value || [] : target.state!=='Unknown'?[target.state]:[];
 const geography:CompanyScreenStatus=!mandate.states.length?'supported':operating.length?operating.some(state=>mandate.states.includes(state))?'supported':'excluded':'review';
 const rawType=provider?.rawResponse?.company_type;const type=provider?.companyType || (typeof rawType==='string'?rawType:rawType&&typeof rawType==='object'?Object.values(rawType).filter(v=>typeof v==='string').join(' '):'');
 const entityExcluded=/\b(?:government|local authority|municipal|public sector|council)\b/i.test(type);
 const screening={headcount:screenBand(count===null?null:{min:count,max:count},mandate.headcount),revenue:screenBand(revenue,effectiveRevenueRange(mandate)),geography,sector:activityScreen(target,mandate),diligence:'review' as CompanyScreenStatus};
 const reasons=[...(entityExcluded?['Government entity is not an acquisition candidate']:[]),...Object.entries(screening).filter(([,status])=>status==='excluded').map(([key])=>`${key}: scoped provider evidence outside mandate`),...Object.entries(screening).filter(([,status])=>status==='review').map(([key])=>`${key}: comparable sourced evidence or diligence requires review`)];
 return {...screening,eligibility:entityExcluded||Object.values(screening).includes('excluded')?'excluded' as const:Object.values(screening).includes('review')?'review' as const:'supported' as const,reasons};
}
