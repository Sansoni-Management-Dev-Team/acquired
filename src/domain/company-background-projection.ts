import type { TargetCandidate,Provenance } from './models';
import type { BackgroundCompanyField as CompanyMissingField,BackgroundCompanyFact as CompanyMissingFieldFact,BackgroundCompanyEvidence,PublishedCompanyTeamMember as PublishedTeamMember } from './company-background-types';
import { australianState,companyScopedFacts,revenueFromCompanyFact,type CompanyFact } from './company-scoped-facts';
import { parseCompanyBand } from './firmable-company-pipeline';
import { publicResearchUrl } from './research';
import type { Accreditation } from './acquisition';
export type { BackgroundCompanyEvidence } from './company-background-types';
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const present=(v:unknown)=>v!==null&&v!==undefined&&v!==''&&(!Array.isArray(v)||v.length>0)&&!(typeof v==='string'&&/^(unknown|no data available|n\/a)$/i.test(v));
const scope=(fact:CompanyMissingFieldFact):CompanyFact<unknown>['scope']=>fact.scope==='AU'?'AU':fact.scope==='global'||fact.scope==='group'?'global':'unknown';
const provenance=(fact:CompanyMissingFieldFact):Provenance=>({source:'Company website research',sourceUrl:fact.sourceUrl,capturedAt:fact.capturedAt,confidence:70,basis:'website',scope:scope(fact),currency:fact.currency||undefined,period:fact.period||undefined});
function observationId(key:string){
 const hex=[0x811c9dc5,0x9e3779b9,0x85ebca6b,0xc2b2ae35].map(seed=>{let hash=seed;for(const char of key)hash=Math.imul(hash^char.charCodeAt(0),16777619);return(hash>>>0).toString(16).padStart(8,'0');}).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export function backgroundAccreditations(observations:CompanyMissingFieldFact[]):Accreditation[]{
 return observations.flatMap(f=>{const v=object(f.value);if(v.registry!=='NATA'||typeof v.accreditationNumber!=='string'||!/^https:\/\/(?:www\.)?nata\.com\.au\/accredited-organisation\//i.test(f.sourceUrl)||!f.quote?.trim()||!Number.isFinite(Date.parse(f.capturedAt)))return[];
 return[{id:observationId(`${f.sourceUrl}:${v.accreditationNumber}:${v.siteNumber||''}`),issuer:'NATA',identifier:v.accreditationNumber,scope:typeof v.scope==='string'&&v.scope.trim()?v.scope:typeof v.standard==='string'&&v.standard.trim()?v.standard:'Published accreditation listing; scope requires review',site:typeof v.siteNumber==='string'?v.siteNumber:'',status:'unverified',verifiedAt:f.capturedAt.slice(0,10),expiresAt:'',source:'Public NATA accreditation listing',sourceUrl:f.sourceUrl,confidence:70}];});
}
/** Read-only evidence projection: never rewrite raw paid data or replace an observed/manual value. */
export function applyCompanyBackgroundProjection<T extends TargetCandidate>(target:T,input:unknown):T {
 const background=object(input) as unknown as BackgroundCompanyEvidence;
 if(!background.fields)return target;
 const observations=(field:CompanyMissingField)=>(background.fields[field]?.observations||[]).filter(f=>f.field===field&&present(f.value)&&publicResearchUrl(f.sourceUrl)&&f.quote?.trim()&&Number.isFinite(Date.parse(f.capturedAt)));
 const first=(field:CompanyMissingField)=>observations(field)[0];
 const original=target.sourceData?.firmable;
 // Provider metadata remains its original value; website observations have their own provenance.
 const profile=original?{...original,companyDetails:{...original.companyDetails}}:undefined;
 const projected={...target,sourceData:{...target.sourceData,backgroundResearch:background,...(profile?{firmable:profile}:{})}};
 if(!present(projected.sourceData.publishedTeamMembers))projected.sourceData.publishedTeamMembers=observations('team_members').flatMap(f=>{const m=object(f.value);return m.employmentStatus==='published_team_member'&&typeof m.name==='string'?[m as PublishedTeamMember]:[];});
 if(!present(projected.accreditations))projected.accreditations=backgroundAccreditations(observations('accreditations'));
 if(profile){
  for(const [field,key] of [['description','description'],['acn','acn']] as const){const f=first(field);if(!present(profile[key])&&f&&typeof f.value==='string')profile[key]=f.value;}
  for(const [field,key] of [['company_emails','companyEmails'],['company_phones','companyPhones']] as const)if(!present(profile[key]))profile[key]=[...new Set(observations(field).flatMap(f=>typeof f.value==='string'?[f.value]:[]))];
 }
 const founded=first('year_founded');if(projected.establishedYear.value===null&&founded&&typeof founded.value==='number'&&Number.isInteger(founded.value)&&founded.value>=1800&&founded.value<=new Date(founded.capturedAt).getUTCFullYear()){
  projected.establishedYear={value:founded.value,provenance:provenance(founded),researchState:'observed'};if(profile&&!present(profile.yearFounded))profile.yearFounded=founded.value;
 }
 const address=first('website_address'),reported=object(address?.value),state=australianState(reported.state);
 if(profile&&address&&!present(profile.companyDetails?.address))profile.companyDetails={...profile.companyDetails,address:reported,addressSource:'Company website research',addressRole:'reported website address',addressProvenance:provenance(address)};
 if(address&&state){if(!present(projected.state))projected.state=state;if(!present(projected.suburb)&&typeof reported.suburb==='string')projected.suburb=reported.suburb;}
 if(profile?.rawResponse){
  const scoped=profile.scopedFacts||companyScopedFacts(profile.rawResponse,profile.capturedAt);
  const facts={...scoped,operatingStates:{...scoped.operatingStates},headcount:{AU:{...scoped.headcount.AU},global:{...scoped.headcount.global}},revenue:{AU:{...scoped.revenue.AU},global:{...scoped.revenue.global}}};profile.scopedFacts=facts;
  const factValue=<V>(f:CompanyMissingFieldFact,value:V):CompanyFact<V>=>({value,source:'Company website research',sourceUrl:f.sourceUrl,capturedAt:f.capturedAt,scope:scope(f),basis:'website',currency:f.currency||undefined,period:f.period||undefined});
  if(address&&state&&facts.operatingStates.value===null)facts.operatingStates=factValue(address,[state]);
  for(const f of observations('employee_count')){
   const s=scope(f);if(s==='unknown'||typeof f.value!=='number'||!Number.isSafeInteger(f.value)||f.value<0)continue;
   if(facts.headcount[s==='AU'?'AU':'global'].value===null)facts.headcount[s==='AU'?'AU':'global']=factValue(f,f.value);
   if(s==='AU'&&projected.headcount.value===null)projected.headcount={value:f.value,provenance:provenance(f),researchState:'observed'};
  }
  if(projected.revenue.value===null&&facts.revenue.global.value!==null)projected.revenue=revenueFromCompanyFact(facts.revenue.global);
  for(const f of observations('revenue')){
   const s=scope(f),band=typeof f.value==='number'&&Number.isFinite(f.value)&&f.value>=0?{label:String(f.value),min:f.value,max:f.value}:parseCompanyBand(f.value,true);if(s==='unknown'||!band)continue;
   if(facts.revenue[s==='AU'?'AU':'global'].value===null)facts.revenue[s==='AU'?'AU':'global']=factValue(f,band);
   if(s==='AU'&&f.currency?.toUpperCase()==='AUD'&&projected.revenue.value===null)projected.revenue={value:band.min===band.max?{kind:'range',min:band.min,max:band.max}:{kind:'band',label:band.label},provenance:provenance(f),researchState:'observed'};
  }
 }
 return projected;
}
