import {companyScopedFacts} from '@/domain/company-scoped-facts';
import type {Mandate} from '@/domain/models';
import {normalizeFirmableProfile} from '@/domain/firmable-company-pipeline';
import {mapFirmableCompany} from './firmable-mapper';
/** Profile-only mapping. Search-row codes are never passed through as employee counts or dollars. */
export function mapFirmableProfile(raw:Record<string,unknown>,mandate:Mandate,organisationId:string){
 const profile=normalizeFirmableProfile(raw);
 const candidate=mapFirmableCompany({...raw,industries:profile.industries,states:profile.states,au_employee_count:undefined,employee_count:undefined,revenue:profile.revenueBand?.label,company_size:profile.headcountBand?.label},{id:profile.firmableId,name:profile.companyName,website:profile.website,formattedAddress:'',types:[]},mandate,organisationId);
 candidate.domain=profile.domain;
 if(raw.websiteResearch){
   const research=raw.websiteResearch as {facts?:Array<{field:string;sourceUrl?:string;capturedAt?:string;quote?:string}>};
   if(candidate.sourceData?.firmable && raw.website_address)candidate.sourceData.firmable.companyDetails={...candidate.sourceData.firmable.companyDetails,address:raw.website_address,addressBasis:'website_reported'};
   if(candidate.establishedYear.value!==null){const evidence=research.facts?.find(f=>f.field==="establishedYear");candidate.establishedYear.provenance={source:'Company website',sourceUrl:evidence?.sourceUrl || profile.website,capturedAt:evidence?.capturedAt || profile.retrievedAt,confidence:70,basis:'website'};}
 }
 const facts=companyScopedFacts(raw,profile.retrievedAt);
 const regionalCount=facts.headcount.AU;
 candidate.headcount={value:regionalCount.value,missingReason:regionalCount.missingReason,provenance:{source:regionalCount.source,sourceUrl:regionalCount.sourceUrl,capturedAt:regionalCount.capturedAt,confidence:70,scope:regionalCount.scope,basis:regionalCount.basis}};
 candidate.revenue={value:facts.revenue.AU.value?facts.revenue.AU.value.min===facts.revenue.AU.value.max?{kind:"range",min:facts.revenue.AU.value.min,max:facts.revenue.AU.value.max}:{kind:"band",label:facts.revenue.AU.value.label}:null,missingReason:facts.revenue.AU.missingReason,...(facts.revenue.AU.assumption?{researchState:'estimated' as const}:{}),provenance:{source:facts.revenue.AU.source,sourceUrl:facts.revenue.AU.sourceUrl,capturedAt:facts.revenue.AU.capturedAt,confidence:facts.revenue.AU.assumption?60:70,scope:"AU",currency:facts.revenue.AU.currency,period:facts.revenue.AU.period,basis:"provider_reported",assumption:facts.revenue.AU.assumption}};
 if(facts.headquarters.value){candidate.state=facts.headquarters.value.state;candidate.suburb=facts.headquarters.value.suburb;}
 candidate.headcountBand=profile.headcountBand?{value:profile.headcountBand,provenance:{source:'Firmable company profile',capturedAt:profile.retrievedAt,confidence:70}}:undefined;
 if(candidate.sourceData?.firmable){candidate.sourceData.firmable.rawResponse=raw;candidate.sourceData.firmable.scopedFacts=facts;candidate.sourceData.firmable.capturedAt=profile.retrievedAt;candidate.sourceData.firmable.employeeCount=profile.headcountExact??undefined;candidate.sourceData.firmable.states=profile.states;}
 return candidate;
}
