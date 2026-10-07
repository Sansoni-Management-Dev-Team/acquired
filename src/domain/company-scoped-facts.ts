import type { CompanyBand } from './firmable-company-pipeline';
import { parseCompanyBand } from './firmable-company-pipeline';

export type CompanyFact<T> = { value: T | null; source: string; sourceUrl?: string; capturedAt: string; scope: 'AU' | 'global' | 'unknown'; basis: 'provider_reported' | 'website'; currency?: string; period?: string; missingReason?: string; assumption?: string };
export type ScopedCompanyFacts = { headquarters: CompanyFact<{ state: string; suburb: string; address: string }>; operatingStates: CompanyFact<string[]>; headcount: { AU: CompanyFact<number>; global: CompanyFact<number> }; revenue: { AU: CompanyFact<CompanyBand>; global: CompanyFact<CompanyBand> }; industries: CompanyFact<string[]> };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const stateNames: Record<string,string> = { victoria:'VIC', queensland:'QLD', 'new south wales':'NSW', 'south australia':'SA', 'western australia':'WA', tasmania:'TAS', 'northern territory':'NT', 'australian capital territory':'ACT' };
export function australianState(value: unknown): string | undefined {
 if (typeof value !== 'string') return undefined;
 return stateNames[value.toLowerCase().trim()] || value.match(/\b(?:VIC|NSW|QLD|SA|WA|TAS|NT|ACT)\b/i)?.[0].toUpperCase();
}
const strings = (v:unknown):string[] => typeof v === 'string' ? [v] : (Array.isArray(v)?v:Object.values(object(v))).filter((s):s is string=>typeof s==='string');
const count = (v:unknown) => typeof v==='number' && Number.isSafeInteger(v) && v>=0 ? v : null;
export function companyScopedFacts(input: Record<string,unknown>, capturedAt=new Date().toISOString()): ScopedCompanyFacts {
 const raw={...object(input.browserResponse),...input}; const au=object(object(raw.region).AU); const details=object(raw.company_details);
 const regional=Object.keys(au).length?au:details.country==='AU'?{...details,address:details.address,employee_count:details.employee_count,revenue:details.revenue_band}:{};
 const sourceUrl=typeof raw.website==='string'?raw.website:undefined;
 const fact=<T>(value:T|null,scope:CompanyFact<T>['scope'],reason:string,extra:Partial<CompanyFact<T>>={}):CompanyFact<T>=>({value,scope,source:raw.websiteResearch?'Company website':'Firmable company profile',sourceUrl,capturedAt,basis:raw.websiteResearch?'website':'provider_reported',...(value===null?{missingReason:reason}:{}),...extra});
 const address=object(regional.address); const state=australianState(address.state || address.full_address);
 const branches=(Array.isArray(regional.locations)?regional.locations:[]).flatMap(location=>{const s=australianState(typeof location==='string'?location:object(location).name);return s?[s]:[];});
 const topStates=strings(raw.states).flatMap(v=>australianState(v)?[australianState(v)!]:[]);
 const reportedWebsiteState=australianState(object(raw.website_address).state);
 const operating=[...new Set([...branches,...topStates,...(state?[state]:[]),...(reportedWebsiteState?[reportedWebsiteState]:[])])];
 const currency=(v:unknown)=>typeof v==='string'?v.toUpperCase():undefined;
 const band=(v:unknown):CompanyBand|null=>typeof v==='number' && Number.isFinite(v) && v>=0 ? {label:String(v),min:v,max:v}:parseCompanyBand(v,true);
 const regionalRevenue=band(regional.revenue),profileRevenue=band(raw.revenue);
 const profileCurrency=currency(raw.revenue_currency);
 const explicitCurrency=profileCurrency || (typeof raw.revenue==='string' ? /\b(USD|NZD|EUR|GBP|CAD|AUD)\b/i.exec(raw.revenue)?.[1]?.toUpperCase() || (/US\$/i.test(raw.revenue)?'USD':/NZ\$/i.test(raw.revenue)?'NZD':/€/.test(raw.revenue)?'EUR':/£/.test(raw.revenue)?'GBP':undefined) : undefined);
 const regions=Object.keys(object(raw.region));
 // A company-level band is usable for an Australian-only profile, but its
 // scope/currency inference must remain distinct from explicit regional data.
 const australianOnly=String(raw.hq_country || '').toUpperCase()==='AU' && regions.length===1 && regions[0]==='AU';
 const useProfileRevenue=!raw.websiteResearch && regionalRevenue===null && profileRevenue!==null && australianOnly && (!explicitCurrency || explicitCurrency==='AUD') && (!currency(regional.revenue_currency) || currency(regional.revenue_currency)==='AUD');
 const assumption=useProfileRevenue ? `AU scope assumed from Australian headquarters and AU-only profile coverage${explicitCurrency ? '' : '; AUD currency assumed'}. Regional revenue was not disclosed.` : undefined;
 const auRevenue=fact(regionalRevenue || (useProfileRevenue?profileRevenue:null),'AU','Provider has no Australian revenue data',{currency:useProfileRevenue?'AUD':currency(regional.revenue_currency),period:typeof (useProfileRevenue?raw.revenue_period:regional.revenue_period)==='string'?String(useProfileRevenue?raw.revenue_period:regional.revenue_period):undefined,...(assumption?{assumption}:{})});
 return {headquarters:fact(state?{state,suburb:String(address.suburb || 'Unknown'),address:String(address.full_address || '')}:null,'AU','No regional primary address'),operatingStates:fact(operating.length?operating:null,'AU','No sourced Australian operating locations'),headcount:{AU:fact(count(regional.employee_count),'AU','No Australian workforce count'),global:fact(count(raw.employee_count),'global','No profile workforce count')},revenue:{AU:auRevenue,global:fact(profileRevenue,'global','No profile revenue band',{currency:profileCurrency,period:typeof raw.revenue_period==='string'?raw.revenue_period:undefined})},industries:fact(strings(raw.industries).length?strings(raw.industries):null,'unknown','No provider industry classification')};
}

/** Re-project legacy retained profiles without rewriting or deleting global observations. */
export function applyScopedCompanyFacts<T extends import('./models').TargetCandidate>(target:T):T {
 const provider=target.sourceData?.firmable;if(!provider?.rawResponse)return target;
 const facts=companyScopedFacts(provider.rawResponse,provider.capturedAt || target.headcount.provenance.capturedAt || new Date(0).toISOString());
 const provenance=(f:CompanyFact<unknown>)=>({source:f.source,sourceUrl:f.sourceUrl,capturedAt:f.capturedAt,confidence:f.assumption?60:70,scope:f.scope,basis:f.basis,currency:f.currency,period:f.period,assumption:f.assumption});
 return {...target,state:facts.headquarters.value?.state || target.state,suburb:facts.headquarters.value?.suburb || target.suburb,headcount:{value:facts.headcount.AU.value,missingReason:facts.headcount.AU.missingReason,provenance:provenance(facts.headcount.AU)},revenue:{value:facts.revenue.AU.value?facts.revenue.AU.value.min===facts.revenue.AU.value.max?{kind:'range',min:facts.revenue.AU.value.min,max:facts.revenue.AU.value.max}:{kind:'band',label:facts.revenue.AU.value.label}:null,missingReason:facts.revenue.AU.missingReason,provenance:provenance(facts.revenue.AU),...(facts.revenue.AU.assumption?{researchState:'estimated' as const}:{})},sourceData:{...target.sourceData,firmable:{...provider,scopedFacts:facts}}};
}
