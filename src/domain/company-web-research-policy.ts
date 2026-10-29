import type {TargetCandidate} from './models';
import type {BackgroundCompanyField} from './company-background-types';
import {companyFieldObject,projectFirmableCompanyFields} from './firmable-company-fields';
import {companyScopedFacts} from './company-scoped-facts';

export const companyValueKnown=(v:unknown):boolean=>v!==null&&v!==undefined&&(typeof v==='boolean'?v:typeof v==='string'?Boolean(v.trim())&&!/^(unknown|unclassified|no data available|n\/a|not available|not provided|-)$/i.test(v.trim()):Array.isArray(v)?v.some(companyValueKnown):typeof v==='object'?Object.values(v).some(companyValueKnown):true);
const optionalFields=new Set<BackgroundCompanyField>(['team_members','accreditations','accreditation_contacts']);
export function companyFieldRelevant(field:BackgroundCompanyField,scope:string){
 if(!optionalFields.has(field))return true;
 const text=scope.replace(/\b(?:NATA|accreditations?|certifications?|team members?)\s+(?:(?:are|is)\s+)?(?:not required|optional)\b/gi,'');
 if(field==='team_members')return /\b(?:team members|staff (?:list|roster|profiles)|leadership team|management team|key personnel|technical team)\b/i.test(text);
 if(field==='accreditation_contacts')return /\b(?:accreditation|NATA)\s+contacts?\b|\bcontacts?\s+(?:for|at)\s+NATA\b/i.test(text);
 return /\b(?:NATA|accreditations?|accredited|certifications?|certified|ISO(?:\/IEC)?\s*\d{4,5}|licen[cs](?:e|es|ed|ing))\b/i.test(text);
}
/** Retain the saved brief's actual criteria, rather than guessing requirements from sector. */
export function companyMandateScope(filters:unknown,fallback=''){
 const data=companyFieldObject(filters),brief=companyFieldObject(data.brief);
 const criteria=Array.isArray(brief.criteria)?brief.criteria.map(companyFieldObject).filter(c=>c.state==='specified').map(c=>c.value):[];
 return [brief.naturalLanguage,...criteria,fallback].filter((v):v is string=>typeof v==='string'&&Boolean(v.trim())).join('; ');
}
function registerProvidesAssociation(registers:Record<string,unknown>,scope:string){
 // A provider register association is not a verified certificate, identifier or contact.
 if(/\bISO(?:\/IEC)?\s*\d{4,5}\b|\b(?:accreditation|certificate|licen[cs]e)\s+(?:number|scope|expiry|status)\b|\b(?:verify|validate)\b[^.;\n]{0,40}\b(?:NATA|accreditation|licen[cs]e)\b/i.test(scope))return false;
 // Contractor-directory categories remain company data, not accreditation evidence.
 const keys=!scope.trim()||/\bNATA\b/i.test(scope)?['nata']:[];
 return keys.some(key=>companyValueKnown(registers[key]));
}
/** Availability only. It never modifies source facts or invents published/verified evidence. */
export function providerCompanyFields(raw:Record<string,unknown>,scope=''):Set<BackgroundCompanyField>{
 const p=projectFirmableCompanyFields(raw,'',''),facts=companyScopedFacts(raw,''),body=companyFieldObject(raw.browserResponse);
 const namedEntries=(value:unknown,contact=false)=>Array.isArray(value)&&value.some(item=>{const r=companyFieldObject(item);return typeof r.name==='string'&&Boolean(r.name.trim())&&(!contact||companyValueKnown(r.email)||companyValueKnown(r.phone));});
 const values:Record<BackgroundCompanyField,unknown>={description:p.description||p.tagline,company_emails:p.companyEmails,company_phones:p.companyPhones,year_founded:p.yearFounded,acn:p.acn,website_address:facts.operatingStates.value||p.companyDetails.address,employee_count:facts.headcount.AU.value??facts.headcount.global.value??p.companySize,revenue:facts.revenue.AU.value??facts.revenue.global.value,team_members:namedEntries(raw.team_members??body.team_members)||undefined,accreditations:raw.accreditations??body.accreditations,accreditation_contacts:namedEntries(raw.accreditation_contacts??body.accreditation_contacts,true)||undefined};
 const fields=new Set<BackgroundCompanyField>((Object.keys(values) as BackgroundCompanyField[]).filter(f=>companyValueKnown(values[f])));
 if(registerProvidesAssociation(p.organizationRegisters,scope))fields.add('accreditations');
 return fields;
}
export function availableCompanyFields(target:TargetCandidate,scope=''):Set<BackgroundCompanyField>{
 const p=target.sourceData?.firmable,provided=providerCompanyFields(p?.rawResponse||{},scope);
 const values:Record<BackgroundCompanyField,unknown>={description:p?.description||p?.tagline,company_emails:p?.companyEmails,company_phones:p?.companyPhones,year_founded:target.establishedYear.value??p?.yearFounded,acn:p?.acn,website_address:p?.scopedFacts?.operatingStates.value||(target.state==='Unknown'?null:target.state),employee_count:target.headcount.value??p?.employeeCount??p?.companySize??target.headcountBand?.value,revenue:target.revenue.value??p?.revenueBand,team_members:target.sourceData?.publishedTeamMembers,accreditations:target.accreditations,accreditation_contacts:undefined};
 for(const field of Object.keys(values) as BackgroundCompanyField[])if(companyValueKnown(values[field]))provided.add(field);
 if(registerProvidesAssociation(p?.organizationRegisters||{},scope))provided.add('accreditations');
 return provided;
}
export function planCompanyWebFields(target:TargetCandidate,scope=''):BackgroundCompanyField[]{
 const provided=availableCompanyFields(target,scope);
 const fields:BackgroundCompanyField[]=['description','company_emails','company_phones','year_founded','acn','website_address','employee_count','revenue','accreditation_contacts','team_members','accreditations'];
 return fields.filter(field=>companyFieldRelevant(field,scope)&&!provided.has(field));
}
