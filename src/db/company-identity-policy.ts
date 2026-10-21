import { z } from 'zod';
import type { CompanyIdentityReviewReason } from '../domain/company-identity-review';
const identitySchema = z.object({companyName:z.string().trim().min(1).max(1000),domain:z.string().min(1).max(1000),firmableId:z.string().regex(/^f[0-9]+$/).max(200).optional(),abn:z.string().regex(/^\d{11}$/).optional()}).strict();
export type CompanyIdentity = z.infer<typeof identitySchema>;
export type CompanyIdentityCandidate = CompanyIdentity & {targetId:string};
export function normalizeCompanyIdentity(input:CompanyIdentity):CompanyIdentity {
 const value=identitySchema.parse(input);
 const url=new URL(value.domain.includes('://')?value.domain:`https://${value.domain}`);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||!url.hostname.includes('.')||!/^([a-z0-9-]+\.)+[a-z0-9-]+$/i.test(url.hostname))throw Error('Invalid company domain');
 return {...value,domain:url.hostname.toLowerCase().replace(/^www\./,'')};
}
export type CompanyIdentityResolution={kind:'create'}|{kind:'reuse';targetId:string}|{kind:'review';reason:CompanyIdentityReviewReason};
/** Candidates are every current same-org exact FID/domain/ABN match. Names and
 * saved contacts never establish identity; contradictory evidence never wins by
 * array order or by an earlier claim. */
export function classifyCompanyIdentity(source:CompanyIdentity,candidates:CompanyIdentityCandidate[],claimedTargetId?:string):CompanyIdentityResolution {
 if(candidates.some(c=>c.firmableId!==undefined&&!/^f[0-9]+$/.test(c.firmableId)))return {kind:'review',reason:'conflicting_identifiers'};
 if(candidates.length>50)throw Error('Company identity has too many candidates for a complete review.');
 if(new Set([source.firmableId,...candidates.map(c=>c.firmableId)].filter(Boolean)).size>1||new Set([source.abn,...candidates.map(c=>c.abn)].filter(Boolean)).size>1)return {kind:'review',reason:'conflicting_identifiers'};
 if(candidates.some(c=>c.domain!==source.domain||(c.firmableId&&source.firmableId&&c.firmableId!==source.firmableId)||(c.abn&&source.abn&&c.abn!==source.abn)))return {kind:'review',reason:'conflicting_identifiers'};
 if(claimedTargetId)return candidates.some(c=>c.targetId===claimedTargetId)?{kind:'reuse',targetId:claimedTargetId}:{kind:'review',reason:'conflicting_identifiers'};
 if(!candidates.length)return{kind:'create'};
 if(candidates.length===1)return{kind:'reuse',targetId:candidates[0].targetId};
 // Exact provider duplicates share one future-write destination. Old target
 // rows and their contacts, workflows and receipts remain on their original IDs.
 if(source.firmableId&&candidates.every(c=>c.firmableId===source.firmableId))return{kind:'reuse',targetId:candidates.map(c=>c.targetId).sort()[0]};
 return{kind:'review',reason:'consistent_existing_duplicates'};
}
