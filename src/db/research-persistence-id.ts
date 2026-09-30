import {createHash} from 'node:crypto';
function stableId(parts:string[]) {
 const hex=createHash('sha256').update(JSON.stringify(parts)).digest('hex');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export function researchTargetId(organizationId:string,domain:string) {
 return stableId(['research-target-v1',organizationId,domain.trim().toLowerCase().replace(/^www\./,'')]);
}
export function researchContactId(organizationId:string,targetId:string,name:string) {
 return stableId(['research-contact-v1',organizationId,targetId,name.trim().replace(/\s+/g,' ').toLowerCase()]);
}
