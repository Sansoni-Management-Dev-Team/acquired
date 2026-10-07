import { visibleHtml } from '@/domain/abn-resolution.mjs';
import { registryAssociation,type CompanyAssociationIdentity } from './company-association-evidence';
import { readIdentityWebsite } from './abn-identity-resolver';

export type AccreditationContact = {
  name: string; phone: string; role: 'Accreditation contact'; sourceUrl: string;
  registry: 'NATA'; accreditationNumber: string; siteNumber: string; capturedAt: string;
};
export function nataListingUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && ['nata.com.au','www.nata.com.au'].includes(url.hostname) && /^\/accredited-organisation\/[^/]+\/$/.test(url.pathname) ? url.href : null; }
  catch { return null; }
}
/** Only retained, documented register URLs are read; no provider endpoint is guessed. */
export function accreditationSourceUrls(raw: Record<string, unknown>) {
  const urls = new Set<string>();
  const scan = (value: unknown, depth = 0) => {
    if (depth > 5) return;
    if (typeof value === 'string') { const url = nataListingUrl(value); if (url) urls.add(url); }
    else if (Array.isArray(value)) value.slice(0,100).forEach(item => scan(item,depth+1));
    else if (value && typeof value === 'object') Object.values(value).slice(0,100).forEach(item => scan(item,depth+1));
  };
  const containers:unknown[]=[raw];
  for(let i=0;i<containers.length&&i<12;i++){
    const current=containers[i];if(!current||typeof current!=='object')continue;
    const data=current as Record<string,unknown>;
    for(const key of ['org_registers','local_registers','registers'])scan(data[key]);
    for(const key of ['browserResponse','region','regions','AU'])if(data[key]&&typeof data[key]==='object')containers.push(data[key]);
    if(Array.isArray(current))containers.push(...current.slice(0,6));
  }
  return [...urls].slice(0,3);
}
export function parseAccreditationContact(html: string, sourceUrl: string, expectedDomain: string, capturedAt = new Date().toISOString(),identity?:CompanyAssociationIdentity): AccreditationContact | null {
  if (!nataListingUrl(sourceUrl)) return null;
  const domain = expectedDomain.toLowerCase().replace(/^www\./,'');
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  // The official listing must link the exact company website, not a name match.
  const visible = html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  const linked = [...visible.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].some(match => {
    try { return new URL(match[1]).hostname.toLowerCase().replace(/^www\./,'') === domain; } catch { return false; }
  });
  if (!linked && !(identity&&identity.domain===domain&&registryAssociation(html,sourceUrl,identity,capturedAt).length)) return null;
  const text = visibleHtml(html);
  const accreditation = text.match(/\bAccreditation No\.?\s*(\d+)\b/i)?.[1];
  const site = text.match(/\bSite No\.?\s*(\d+)\b/i)?.[1];
  const contact = text.match(/\bContact\s+((?:(?:Mr|Ms|Mrs|Dr|Prof)\.?\s+)?[\p{L}][\p{L}'’ -]{2,100}?)\s+P\s*:\s*(\+?[\d() -]{7,30})/iu);
  if (!accreditation || !site || !contact) return null;
  const name = contact[1].replace(/^(?:Mr|Ms|Mrs|Dr|Prof)\.?\s+/i,'').trim();
  const phone = contact[2].trim();
  if (name.split(/\s+/).length < 2 || phone.replace(/\D/g,'').length < 8) return null;
  return {name,phone,role:'Accreditation contact',sourceUrl,registry:'NATA',accreditationNumber:accreditation,siteNumber:site,capturedAt};
}
export async function readAccreditationContact(sourceUrl: string, expectedDomain: string, deadline?: number) {
  if (!nataListingUrl(sourceUrl)) return null;
  const page = await readIdentityWebsite(sourceUrl,deadline);
  return parseAccreditationContact(page.html,page.url,expectedDomain);
}

export type PublishedAccreditation={registry:'NATA';accreditationNumber:string;siteNumber?:string;standard?:string;scope?:string;accreditationDate?:string;sourceUrl:string;quote:string;capturedAt:string};
export function parsePublishedAccreditation(html:string,sourceUrl:string,expectedDomain:string,capturedAt:string,identity?:CompanyAssociationIdentity):PublishedAccreditation|null {
 if(!nataListingUrl(sourceUrl))return null;
 const clean=html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 const linked=[...clean.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].some(match=>{try{return new URL(match[1]).hostname.replace(/^www\./,'')===expectedDomain;}catch{return false;}});
 if(!linked&&!(identity&&identity.domain===expectedDomain&&registryAssociation(clean,sourceUrl,identity,capturedAt).length))return null;
 const text=visibleHtml(clean),accreditationNumber=text.match(/\bAccreditation No\.?\s*(\d+)\b/i)?.[1];if(!accreditationNumber)return null;
 const siteNumber=text.match(/\bSite No\.?\s*(\d+)\b/i)?.[1],standard=text.match(/\b(?:ISO(?:\/IEC)?\s*\d{4,5}(?::\d{4})?)/i)?.[0];
 const dateMatch=text.match(/\bDate of Accreditation\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i);let accreditationDate:string|undefined;if(dateMatch){const day=Number(dateMatch[1]),month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(dateMatch[2].toLowerCase()),year=Number(dateMatch[3]),date=new Date(Date.UTC(year,month,day));if(date.getUTCFullYear()===year&&date.getUTCMonth()===month&&date.getUTCDate()===day)accreditationDate=date.toISOString().slice(0,10);}
 const at=text.search(/\bAccreditation No/i);return{registry:'NATA',accreditationNumber,...(siteNumber?{siteNumber}:{}),...(standard?{standard}:{}),...(accreditationDate?{accreditationDate}:{}),sourceUrl,quote:text.slice(Math.max(0,at),at+500),capturedAt};
}
