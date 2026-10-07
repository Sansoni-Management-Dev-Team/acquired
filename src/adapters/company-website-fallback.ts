import {identityLinks,readIdentityWebsite,type IdentityRead} from './abn-identity-resolver';
import {visibleHtml,type IdentityPage} from '@/domain/abn-resolution.mjs';
import {publicResearchUrl} from '@/domain/research';
export type WebsiteFallbackInput={name:string;website:string;deadline?:number};
/** Bounded public evidence retrieval; never infers financials, workforce, or legal identity. */
export function createCompanyWebsiteFallback(read:(url:string,deadline?:number)=>Promise<IdentityRead>){
 return async(input:WebsiteFallbackInput)=>{
  const website=publicResearchUrl(input.website),deadline=Math.min(input.deadline??Infinity,Date.now()+20000),pages:IdentityPage[]=[],errors:Array<{url:string;message:string}>=[],facts:Array<{field:string;value:unknown;sourceUrl:string;quote:string;capturedAt:string}>=[];
  if(!website)throw Error('Invalid company website');
  const raw:Record<string,unknown>={name:input.name,website};
  const visit=async(url:string)=>{try{if(Date.now()>=deadline)throw Error('Website fallback deadline reached');const result=await read(url,deadline),text=visibleHtml(result.html),capturedAt=new Date().toISOString();pages.push({url:result.url,text});if(result.truncated)errors.push({url:result.url,message:'Website truncated at bounded read limit'});
   const meta=[...result.html.matchAll(/<meta\b[^>]*>/gi)].find(m=>/\bname\s*=\s*["']description["']/i.test(m[0]));const description=meta?.[0].match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];if(description&&!raw.description){raw.description=visibleHtml(description);facts.push({field:'description',value:raw.description,sourceUrl:result.url,quote:description,capturedAt});}
   const founded=text.match(/\b(?:founded|established)\s+(?:in\s+)?((?:18|19|20)\d{2})\b/i);if(founded&&!raw.year_founded){raw.year_founded=Number(founded[1]);facts.push({field:'establishedYear',value:raw.year_founded,sourceUrl:result.url,quote:founded[0],capturedAt});}
   const acn=text.match(/\bACN\s*[:#]?\s*((?:\d[ \u00a0]*){9})(?!\d)/i);if(acn&&!raw.industry_codes){const value=acn[1].replace(/\D/g,'');raw.industry_codes={acn:value};facts.push({field:'acn',value,sourceUrl:result.url,quote:acn[0],capturedAt});}
   const address=text.match(/\b([A-Z][a-zA-Z '-]{2,40}),?\s+(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+(\d{4})\b/);if(address&&!raw.website_address){raw.website_address={suburb:address[1].trim(),state:address[2],postcode:address[3],country:'AU',full_address:address[0]};facts.push({field:'reportedAddress',value:raw.website_address,sourceUrl:result.url,quote:address[0],capturedAt});}
   for(const[field,pattern]of [['company_emails',/href\s*=\s*["']mailto:([^"'?\s]+)/gi],['company_phones',/href\s*=\s*["']tel:([^"'?\s]+)/gi]] as const){for(const match of result.html.matchAll(pattern)){const value=match[1].trim();const values=(raw[field]??[]) as string[];if(!values.includes(value)){raw[field]=[...values,value];facts.push({field,value,sourceUrl:result.url,quote:match[0],capturedAt});}}}
   return result;
  }catch(error){errors.push({url,message:error instanceof Error?error.message:'Website read failed'});return null;}};
  const home=await visit(website);if(home)for(const url of identityLinks(home.html,home.url))await visit(url);
  const fields=['description','year_founded','company_emails','company_phones','revenue','employee_count','acn','website_address'];
  raw.websiteResearch={status:errors.length?(pages.length?'partial':'failed'):'complete',pages:pages.map(p=>p.url),errors,facts,fields:Object.fromEntries(fields.map(field=>[field,(field==='acn'?(raw.industry_codes as {acn?:string}|undefined)?.acn:raw[field])?'reported':errors.length?'research_incomplete':'not_disclosed'])),providerMatch:'unmatched'};
  return{raw,pages};
 };
}
export const researchCompanyWebsite=createCompanyWebsiteFallback(readIdentityWebsite);
