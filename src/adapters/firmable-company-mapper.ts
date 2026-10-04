import type {Mandate} from '@/domain/models';
import {normalizeFirmableProfile} from '@/domain/firmable-company-pipeline';
import {mapFirmableCompany} from './firmable-mapper';
/** Profile-only mapping. Search-row codes are never passed through as employee counts or dollars. */
export function mapFirmableProfile(raw:Record<string,unknown>,mandate:Mandate,organisationId:string){
 const profile=normalizeFirmableProfile(raw);
 const candidate=mapFirmableCompany({...raw,industries:profile.industries,states:profile.states,au_employee_count:undefined,employee_count:undefined,revenue:profile.revenueBand?.label,company_size:profile.headcountBand?.label},{id:profile.firmableId,name:profile.companyName,website:profile.website,formattedAddress:'',types:[]},mandate,organisationId);
 candidate.domain=profile.domain;
 if(profile.headcountExact)candidate.headcount={value:profile.headcountExact,provenance:{source:'Firmable reported employee count',capturedAt:profile.retrievedAt,confidence:70}};
 candidate.headcountBand=profile.headcountBand?{value:profile.headcountBand,provenance:{source:'Firmable company profile',capturedAt:profile.retrievedAt,confidence:70}}:undefined;
 if(candidate.sourceData?.firmable){candidate.sourceData.firmable.rawResponse=raw;candidate.sourceData.firmable.employeeCount=profile.headcountExact??undefined;candidate.sourceData.firmable.states=profile.states;}
 return candidate;
}
