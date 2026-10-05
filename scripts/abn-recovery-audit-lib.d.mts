import type {AbnRecord,IdentityPage} from '../src/domain/abn-resolution.mjs';
export type AuditCompany={name:string;domain:string;aliases?:string[];indexedAbns?:string[]};
export type AuditMatch={abn:string;entityName:string;reason:string;level:string;sourceUrl:string;websiteEvidence:{url:string;quote:string}[]};
export function nameKey(name:string):string;
export function auditAliases(company:AuditCompany,extra?:string[]):string[];
export function assessAbnCandidates(company:AuditCompany,records:AbnRecord[],pages:(IdentityPage & {kind?:string})[],providerAbns?:string[]):{status:string;match:AuditMatch|null;candidates:AuditMatch[]};
