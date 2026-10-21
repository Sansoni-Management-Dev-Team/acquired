import {z} from 'zod';
import {parseCompanyBand,type FirmableFilters} from './firmable-company-pipeline';
import {firmablePaginationFilters} from './firmable-pagination-filters';
const bounds={countryScope:z.literal('AU'),desiredSourceCompanies:z.literal(20),maxProfiledCompanies:z.literal(20),firmablePageSize:z.literal(100),maxFirmablePages:z.literal(2),maxFirmableRows:z.literal(200),maxWebQueries:z.literal(6),queryOrder:z.literal('subsector_round_robin')};
const range=z.object({min:z.number().int().nonnegative().safe(),max:z.number().int().nonnegative().safe()}).strict().refine(r=>r.max>=r.min);
/** Saved V2 approvals retain their original ordering and exact configuration. */
const v2=z.object({version:z.literal(2),...bounds}).strict();
const v3=z.object({version:z.literal(3),...bounds,profileSelection:z.object({strategy:z.literal('labelled_au_staff_bands'),requestedHeadcount:range.nullable(),unknownBands:z.literal('retain_after_labelled'),qualification:z.literal('profile_required')}).strict()}).strict();
const v4=z.object({version:z.literal(4),...bounds,maxProfiledCompanies:z.literal(800),maxWebRowsPerQuery:z.literal(100),profileSelection:z.object({strategy:z.literal('all_discovered'),identity:z.literal('firmable_id_then_domain'),companyOnly:z.literal(true)}).strict()}).strict();
const v5=z.object({version:z.literal(5),...bounds,maxProfiledCompanies:z.literal(800),maxWebRowsPerQuery:z.literal(100),profileSelection:z.object({strategy:z.literal('all_discovered'),identity:z.literal('firmable_id_then_domain'),companyOnly:z.literal(false)}).strict(),automaticPeople:z.object({version:z.literal(1),maxCompanies:z.literal(800),maxSearchPagesPerCompany:z.literal(1),searchPageSize:z.literal(50),maxContactsPerCompany:z.literal(3),includePhones:z.literal(false)}).strict()}).strict();
export const companyDiscoveryPolicySchema=z.discriminatedUnion('version',[v2,v3,v4,v5]);
export type CompanyDiscoveryPolicy=z.infer<typeof companyDiscoveryPolicySchema>;
export const reviewedCompanyDiscoveryPolicy:z.infer<typeof v2>={version:2,countryScope:'AU',desiredSourceCompanies:20,maxProfiledCompanies:20,firmablePageSize:100,maxFirmablePages:2,maxFirmableRows:200,maxWebQueries:6,queryOrder:'subsector_round_robin'};
/** Shared new-root policy. The caller supplies saved search intent, never company facts. */
export function buildCompanyDiscoveryPolicy(headcount:unknown=null):z.infer<typeof v3>{const parsed=range.safeParse(headcount);return{...reviewedCompanyDiscoveryPolicy,version:3,profileSelection:{strategy:'labelled_au_staff_bands',requestedHeadcount:parsed.success?parsed.data:null,unknownBands:'retain_after_labelled',qualification:'profile_required'}};}
export function buildAllDiscoveredCompanyPolicy():z.infer<typeof v4>{return {...reviewedCompanyDiscoveryPolicy,version:4,maxProfiledCompanies:800,maxWebRowsPerQuery:100,profileSelection:{strategy:'all_discovered',identity:'firmable_id_then_domain',companyOnly:true}};}
/** Fresh combined scope; historical company-only approvals retain V4 unchanged. */
export function buildAllDiscoveredCompanyPeoplePolicy():z.infer<typeof v5>{return {...reviewedCompanyDiscoveryPolicy,version:5,maxProfiledCompanies:800,maxWebRowsPerQuery:100,profileSelection:{strategy:'all_discovered',identity:'firmable_id_then_domain',companyOnly:false},automaticPeople:{version:1,maxCompanies:800,maxSearchPagesPerCompany:1,searchPageSize:50,maxContactsPerCompany:3,includePhones:false}};}
type Row=Record<string,unknown>;
/** Reorders hints only. All rows survive, no counts or qualification are inferred.
 * The taxonomy is taken exclusively from this search's returned labelled map. */
export function balanceFirmableStaffBands(rows:Row[],policy:CompanyDiscoveryPolicy,proofs:Array<{predictedFilters?:FirmableFilters;predictedCountry?:unknown}>){
 const unchanged=(reason:string)=>({rows,summary:{status:'unchanged',reason,bands:[] as Array<{label:string;rows:number}>}});
 if(policy.version!==3)return unchanged('legacy_policy');
 const requested=policy.profileSelection.requestedHeadcount;if(!requested)return unchanged('headcount_search_intent_unknown');
 if(!proofs.length)return unchanged('labelled_country_scope_unavailable');
 let labels:Record<string,string>|undefined;
 for(const proof of proofs){
  try{if(!proof.predictedFilters)throw Error();firmablePaginationFilters(proof.predictedFilters,proof.predictedCountry,'AU');}catch{return unchanged('labelled_country_scope_ambiguous');}
  const parsed=z.record(z.string().regex(/^\d+$/),z.string().trim().min(1).max(80)).safeParse(proof.predictedFilters!.filters.company_size);
  if(!parsed.success||!Object.keys(parsed.data).length)return unchanged('staff_band_labels_unavailable');
  if(labels&&JSON.stringify(Object.entries(labels).sort())!==JSON.stringify(Object.entries(parsed.data).sort()))return unchanged('staff_band_labels_conflict');
  labels=parsed.data;
 }
 const bands=Object.entries(labels!).map(([code,label])=>({code,band:parseCompanyBand(label),rows:[] as Row[]}));
 if(bands.some(b=>!b.band))return unchanged('staff_band_labels_ambiguous');
 const sorted=[...bands].sort((a,b)=>a.band!.min-b.band!.min);
 if(sorted.some((b,i)=>i>0&&(sorted[i-1].band!.max??Infinity)>=b.band!.min))return unchanged('staff_band_labels_overlap');
 const eligible=sorted.filter(b=>b.band!.min<=requested.max&&(b.band!.max??Infinity)>=requested.min);
 if(!eligible.length)return unchanged('no_labelled_staff_band_overlap');
 const other:Row[]=[];
 for(const row of rows){const code=typeof row.au_employee_count==='number'&&Number.isSafeInteger(row.au_employee_count)?String(row.au_employee_count):typeof row.au_employee_count==='string'?row.au_employee_count:'';const group=eligible.find(b=>b.code===code);if(group)group.rows.push(row);else other.push(row);}
 const balanced:Row[]=[];for(let i=0;i<Math.max(0,...eligible.map(b=>b.rows.length));i++)for(const group of eligible)if(group.rows[i])balanced.push(group.rows[i]);
 return{rows:[...balanced,...other],summary:{status:'balanced',reason:'returned_au_staff_band_overlap',bands:eligible.map(b=>({label:b.band!.label,rows:b.rows.length}))}};
}
