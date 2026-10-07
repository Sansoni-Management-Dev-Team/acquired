import { visibleHtml } from '@/domain/abn-resolution.mjs';
import { publicResearchUrl,researchDomain } from '@/domain/research';
export type CompanyAssociationIdentity={name:string;domain:string;names?:string[];addresses?:string[];phones?:string[];emails?:string[]};
export type RelatedDomainAssociation={domain:string;sourceUrl:string;quote:string;basis:'official_registry_corroborated'|'explicit_relationship';capturedAt:string;corroboration?:'address'|'phone'|'email'};
const safeHtml=(html:string)=>html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
export function associationPageLinks(html:string){return [...safeHtml(html).matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].flatMap(match=>{const url=publicResearchUrl(match[1]);return url?[url]:[];});}
export function publishedCompanyAddresses(text:string){return [...text.replace(/(Road|Street|Avenue|Drive)(?=[A-Z])/g,'$1 ').matchAll(/\b(?:Unit\s+)?\d+(?:\/\d+)?[A-Z]?\s+(?:[\p{L}'-]+\s+){0,6}(?:Road|Rd|Street|St|Avenue|Ave|Drive|Dr|Court|Ct|Way|Highway|Hwy)\b[^.!?\n]{0,90}?\b(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s*\d{4}(?!\d)/giu)].map(match=>match[0]);}
const addressKey=(value:string)=>value.toLowerCase().replace(/\bunit\s*/g,'').replace(/\broad\b/g,'rd').replace(/\bstreet\b/g,'st').replace(/\bavenue\b/g,'ave').replace(/\bdrive\b/g,'dr').replace(/[^a-z0-9/]/g,'');
const nameKey=(value:string)=>value.toLowerCase().replace(/\b(?:pty|limited|ltd|inc|incorporated)\b/g,'').replace(/[^a-z0-9]/g,'');
const phoneKey=(value:string)=>{const digits=value.replace(/\D/g,'');return digits.startsWith('61')?'0'+digits.slice(2).replace(/^0/,''):digits;};
export function registryAssociation(html:string,sourceUrl:string,identity:CompanyAssociationIdentity,capturedAt=new Date().toISOString()):RelatedDomainAssociation[] {
 let url:URL;try{url=new URL(sourceUrl);}catch{return [];}if(!['nata.com.au','www.nata.com.au'].includes(url.hostname)||!/^\/accredited-organisation\//.test(url.pathname))return [];
 const cleaned=safeHtml(html),text=visibleHtml(cleaned),domains=[...new Set(associationPageLinks(cleaned).map(researchDomain).filter(domain=>domain!==identity.domain&&!/(^|\.)nata\.com\.au$/.test(domain)))];
 const headings=[...cleaned.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map(match=>visibleHtml(match[1]));
 const names=[identity.name,...identity.names||[]].map(nameKey).filter(name=>name.length>=5);
 if(!headings.some(heading=>names.some(name=>nameKey(heading).includes(name))))return [];
 let corroboration:RelatedDomainAssociation['corroboration'];
 const addresses=publishedCompanyAddresses(text).map(addressKey);if((identity.addresses||[]).some(value=>addresses.includes(addressKey(value))))corroboration='address';
 const phones=[...text.matchAll(/\b(?:P|Phone|Telephone)\s*:\s*(\+?\d[\d() -]{7,24})/gi)].map(match=>phoneKey(match[1]));
 if(!corroboration&&(identity.phones||[]).some(value=>phones.includes(phoneKey(value))))corroboration='phone';
 const emails=[...text.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)].map(match=>match[0].toLowerCase());if(!corroboration&&(identity.emails||[]).some(value=>emails.includes(value.toLowerCase())))corroboration='email';
 if(!corroboration)return [];
 // Only website links inside the listing's identity/contact section, not footer sponsors.
 const listingStart=[...cleaned.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].find(match=>names.some(name=>nameKey(visibleHtml(match[1])).includes(name)))?.index??0;const contactSection=cleaned.slice(Math.max(0,listingStart)).split(/<h[1-6][^>]*>\s*Scope of Accreditation/i)[0];
 const linked=new Set(associationPageLinks(contactSection).map(researchDomain));
 return domains.filter(domain=>linked.has(domain)&&!/(^|\.)(?:facebook|linkedin|twitter|youtube|instagram|google)\./i.test(domain)).map(domain=>({domain,sourceUrl,basis:'official_registry_corroborated',corroboration,quote:text.slice(Math.max(0,text.toLowerCase().indexOf(headings.find(heading=>names.some(name=>nameKey(heading).includes(name)))!.toLowerCase())),Math.max(0,text.toLowerCase().indexOf(headings.find(heading=>names.some(name=>nameKey(heading).includes(name)))!.toLowerCase()))+500),capturedAt}));
}
export function explicitRelatedDomains(html:string,sourceUrl:string,identity:CompanyAssociationIdentity,capturedAt=new Date().toISOString()):RelatedDomainAssociation[]{
 if(researchDomain(sourceUrl)!==identity.domain)return [];
 const cleaned=safeHtml(html),out:RelatedDomainAssociation[]=[];
 for(const match of cleaned.matchAll(/<(?:p|li|div|section)\b[^>]*>([^<>]*(?:<a\b[^>]*>[\s\S]*?<\/a>)[\s\S]{0,300}?)<\/(?:p|li|div|section)>/gi)){
  const text=visibleHtml(match[1]);if(!/\b(?:we|our|company|business)\b.{0,100}\b(?:trading as|formerly|renamed|changed (?:our )?name|now (?:known as|part of)|subsidiary|part of|operated by|owned by)\b/i.test(text))continue;
  for(const url of associationPageLinks(match[1])){const domain=researchDomain(url);if(domain!==identity.domain)out.push({domain,sourceUrl,quote:text.slice(0,500),basis:'explicit_relationship',capturedAt});}
 }
 return [...new Map(out.map(value=>[value.domain,value])).values()];
}
