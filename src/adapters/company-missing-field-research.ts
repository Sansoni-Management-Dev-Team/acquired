import { visibleHtml } from '@/domain/abn-resolution.mjs';
import { observedCompanyFacts,parseHeadcount } from '@/domain/company-facts';
import { publicResearchUrl,researchDomain,type ResearchConfig } from '@/domain/research';
import { accreditationSourceUrls,nataListingUrl,parseAccreditationContact,parsePublishedAccreditation,type PublishedAccreditation,type AccreditationContact } from './accreditation-register';
import {registryAssociation,explicitRelatedDomains,publishedCompanyAddresses,type CompanyAssociationIdentity,type RelatedDomainAssociation} from './company-association-evidence';
import {publishedTeamMembers,type PublishedTeamMember} from './company-team-evidence';
export type {PublishedTeamMember,PublishedAccreditation,RelatedDomainAssociation};
import { cloudflareSearchResults } from './cloudflare-web-search';
import { readIdentityWebsite } from './abn-identity-resolver';
import { providerJsonRequest } from './observability/provider-request';
import { localReaderEndpoint } from '../../cloudflare/research/local-reader';

export type CompanyMissingField = 'description'|'company_emails'|'company_phones'|'year_founded'|'acn'|'website_address'|'employee_count'|'revenue'|'accreditation_contacts'|'team_members'|'accreditations';
export type CompanyMissingFieldFact = {field:CompanyMissingField;value:unknown;sourceUrl:string;quote:string;capturedAt:string;scope?:string;currency?:string|null;period?:string|null;evidenceType:'published';reader:string;readStartedAt?:string;readElapsedMs?:number;association?:RelatedDomainAssociation};
export type CompanyMissingFieldAttempt = {kind:'page'|'document'|'search';url?:string;field?:CompanyMissingField;status:'succeeded'|'failed'|'rejected';startedAt:string;elapsedMs:number;reason?:string;query?:string;resultCount?:number};
export type CompanyMissingFieldResearchResult = {facts:CompanyMissingFieldFact[];fields:Partial<Record<CompanyMissingField,{status:'reported'|'not_disclosed'|'research_incomplete';reason?:string}>>;attempts:CompanyMissingFieldAttempt[];registryContacts:AccreditationContact[];teamMembers?:PublishedTeamMember[];accreditations?:PublishedAccreditation[];relatedDomains?:RelatedDomainAssociation[]};
export type MissingFieldPage = {url:string;html?:string;markdown?:string;truncated?:boolean;reader:string;onlyMainContent?:false};
export type CompanyMissingFieldResearchInput = {name:string;website:string;missingFields:CompanyMissingField[];deadline?:number;jobId?:string;maxPages?:number;maxSearchQueries?:number;knownRegistryUrls?:string[];raw?:Record<string,unknown>};
export type CompanyMissingFieldResearchDependencies = {
 readPage(url:string,deadline:number):Promise<MissingFieldPage>;
 readDocument?(url:string,deadline:number):Promise<{url:string;text:string;truncated?:boolean}>;
 search?(query:string,field:CompanyMissingField,deadline:number):Promise<Array<{url:string;title?:string;snippet?:string}>>;
 now?:()=>number;
};

export function missingFieldSearchQuery(input:Pick<CompanyMissingFieldResearchInput,'name'|'website'>,field:CompanyMissingField) {
 const domain=researchDomain(input.website),terms:Record<CompanyMissingField,string>={description:'about company services',company_emails:'contact email',company_phones:'contact phone',year_founded:'about founded established',acn:'legal ACN',website_address:'contact address',employee_count:'employees workforce headcount',revenue:'annual revenue turnover currency financial year',accreditation_contacts:'NATA accreditation contact',accreditations:'NATA accreditation ISO standard',team_members:'team people staff scientists management'};
 return (field==='accreditation_contacts'||field==='accreditations')?`site:nata.com.au/accredited-organisation/ "${domain}" accreditation contact`:`site:${domain} ${terms[field]}`;
}
const navigable=(url:string)=>! /\.(?:css|js|mjs|json|xml|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|map|pdf|zip)(?:$|[?#])/i.test(url)&&! /\/(?:wp-content|wp-includes)\//i.test(url);
export function registryNameSearchQuery(input:Pick<CompanyMissingFieldResearchInput,'name'|'website'>,addresses:string[]=[]) {
 const core=input.name.replace(/\b(?:pty|proprietary|ltd|limited|inc|incorporated|llc|plc)\b\.?/gi,'').replace(/["\n\r]/g,' ').replace(/\s+/g,' ').trim().replace(/[., ]+$/,'');
 const location=addresses.map(address=>address.match(/\b(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s*\d{4}/i)?.[0]).find(Boolean)||'';
 return `site:nata.com.au/accredited-organisation/ "${core}" ${location}`.trim();
}
const priority=(url:string)=>nataListingUrl(url)?-1:/contact|location/i.test(url)?0:/about|company|team|history/i.test(url)?1:/legal|terms|privacy/i.test(url)?2:3;
function pageLinks(page:MissingFieldPage) {
 const html=(page.html||'').replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
 const links=[...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map(match=>match[1]);
 links.push(...[...(page.markdown||'').matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)].map(match=>match[1]));
 return links.flatMap(link=>{try{const url=publicResearchUrl(new URL(link.replaceAll('&amp;','&'),page.url).href);return url&&navigable(url)?[url]:[];}catch{return [];}});
}
function pageFacts(page:MissingFieldPage,input:CompanyMissingFieldResearchInput,capturedAt:string):CompanyMissingFieldFact[] {
 const html=(page.html||'').replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,''),text=html?visibleHtml(html):page.markdown||'',domain=researchDomain(input.website),facts:CompanyMissingFieldFact[]=[];
 const add=(field:CompanyMissingField,value:unknown,quote:string,meta:Partial<CompanyMissingFieldFact>={})=>{if(input.missingFields.includes(field))facts.push({field,value,quote:quote.slice(0,500),sourceUrl:page.url,capturedAt,evidenceType:'published',reader:page.reader,...meta});};
 if(researchDomain(page.url)!==domain)return facts;
 const meta=[...html.matchAll(/<meta\b[^>]*>/gi)].find(match=>/\bname\s*=\s*["']description["']/i.test(match[0]));
 const description=meta?.[0].match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];if(description)add('description',visibleHtml(description),description);
 for(const match of html.matchAll(/\bhref\s*=\s*["']mailto:([^"'?\s]+)/gi))if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(match[1]))add('company_emails',match[1],match[0]);
 for(const match of text.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)){
  const emailDomain=match[0].split('@')[1].toLowerCase();
  if(emailDomain===domain||emailDomain.endsWith(`.${domain}`))add('company_emails',match[0],text.slice(Math.max(0,match.index!-60),match.index!+match[0].length+60));
 }
 for(const match of html.matchAll(/\bhref\s*=\s*["']tel:([^"'?\s]+)/gi))if(match[1].replace(/\D/g,'').length>=8)add('company_phones',match[1],match[0]);
 for(const match of text.matchAll(/\b(?:phone|telephone|call(?: us)?|P)\s*[:.]?\s*(\+?\d[\d() -]{7,24})/gi))if(match[1].replace(/\D/g,'').length>=8)add('company_phones',match[1].trim(),match[0]);
 const year=text.match(/\b(?:founded|established)\s+(?:in\s+)?((?:18|19|20)\d{2})\b/i);if(year)add('year_founded',Number(year[1]),year[0]);
 const acn=text.match(/\bACN\s*[:#]?\s*((?:\d[ \u00a0]*){9})(?!\d)/i);if(acn)add('acn',acn[1].replace(/\D/g,''),acn[0],{scope:'AU'});
 const address=text.match(/\b([A-Z][a-zA-Z '-]{2,40}),?\s+(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+(\d{4})\b/);if(address)add('website_address',{suburb:address[1].trim(),state:address[2],postcode:address[3],country:'AU',full_address:address[0]},address[0],{scope:'reported_website_address'});
 const config={companyName:input.name,companyDomain:domain} as ResearchConfig;
 for(const fact of observedCompanyFacts(page.markdown||text,page.url,config)){
  if(fact.kind==='headcount'){const value=parseHeadcount(fact.value);if(value)add('employee_count',value.kind==='point'?value.min:value,fact.quote,{scope:fact.factMetadata?.scope||'unspecified'});}
  if(fact.kind==='revenue')add('revenue',fact.value,fact.quote,{scope:fact.factMetadata?.scope||'unspecified',currency:fact.factMetadata?.currency||null,period:fact.factMetadata?.period||null});
 }
 return facts;
}

export function createCompanyMissingFieldResearch(deps:CompanyMissingFieldResearchDependencies) {
 return async(input:CompanyMissingFieldResearchInput):Promise<CompanyMissingFieldResearchResult>=>{
  const now=deps.now||Date.now,started=now(),deadline=Math.min(input.deadline??Infinity,started+110000),maxPages=Math.max(1,Math.min(8,input.maxPages??8)),maxQueries=Math.max(0,Math.min(4,input.maxSearchQueries??4));
  const home=publicResearchUrl(input.website);if(!home)throw Error('Valid public company website required');
  const domain=researchDomain(home),requested=[...new Set(input.missingFields)],facts:CompanyMissingFieldFact[]=[],attempts:CompanyMissingFieldAttempt[]=[],registryContacts:AccreditationContact[]=[],visited=new Set<string>(),queue:string[]=[],searched=new Set<CompanyMissingField>();const relatedDomains:RelatedDomainAssociation[]=[],teamMembers:PublishedTeamMember[]=[],accreditations:PublishedAccreditation[]=[],identity:CompanyAssociationIdentity={name:input.name,domain,addresses:[],phones:[],emails:[]},personEmails=new Set<string>();let readCount=0,limited=false;
  const allowed=(url:string)=>Boolean(publicResearchUrl(url)&&(researchDomain(url)===domain||relatedDomains.some(a=>a.domain===researchDomain(url))||nataListingUrl(url)&&requested.some(f=>['accreditation_contacts','accreditations','team_members'].includes(f))));
  const enqueue=(url:string)=>{if(navigable(url)&&allowed(url)&&!visited.has(url)&&!queue.includes(url))queue.push(url);};
  const observed=(field:CompanyMissingField)=>facts.some(f=>f.field===field)||(field==='accreditation_contacts'&&registryContacts.length>0);
  const visit=async(url:string,readCeiling=maxPages,pageDeadline=deadline)=>{
   if(visited.has(url))return;if(readCount>=readCeiling||now()>=pageDeadline){limited=true;return;}visited.add(url);readCount++;const at=now();
   try{
    let page:MissingFieldPage;try{page=await deps.readPage(url,pageDeadline);}catch{attempts.push({kind:'page',url,status:'failed',startedAt:new Date(at).toISOString(),elapsedMs:Math.max(0,now()-at),reason:'Initial public page read unavailable'});if(readCount>=readCeiling||now()>=pageDeadline)throw Error('Retry budget unavailable');readCount++;page=await deps.readPage(url,pageDeadline);}
    if(!allowed(page.url)||!nataListingUrl(url)&&researchDomain(page.url)!==researchDomain(url))throw Error('Source redirected outside company identity');
    const capturedAt=new Date(now()).toISOString(),readStartedAt=new Date(at).toISOString(),readElapsedMs=Math.max(0,now()-at);const text=visibleHtml(page.html||page.markdown||'');
    if(researchDomain(page.url)===domain){identity.addresses!.push(...publishedCompanyAddresses(text));identity.phones!.push(...[...text.matchAll(/\b(?:P|Phone|Telephone)\s*[:.]?\s*(\+?\d[\d() -]{7,24})/gi)].map(m=>m[1]));identity.emails!.push(...[...text.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)].map(m=>m[0]));}
    const associations=nataListingUrl(page.url)?registryAssociation(page.html||'',page.url,identity,capturedAt):explicitRelatedDomains(page.html||'',page.url,identity,capturedAt);
    for(const association of associations)if(!relatedDomains.some(a=>a.domain===association.domain)){relatedDomains.push(association);enqueue(`https://${association.domain}/`);}
    const association=relatedDomains.find(a=>a.domain===researchDomain(page.url));const pageTeam=nataListingUrl(page.url)?[]:publishedTeamMembers(page.html||'',page.markdown||'',page.url,capturedAt,page.reader);const staffEmails=new Set(pageTeam.flatMap(member=>member.email?[member.email.toLowerCase()]:[]));for(const email of staffEmails)personEmails.add(email);
    facts.push(...pageFacts(page,{...input,website:association?page.url:input.website},capturedAt).filter(f=>f.field!=='company_emails'||typeof f.value!=='string'||!staffEmails.has(f.value.toLowerCase())).map(f=>({...f,readStartedAt,readElapsedMs,...(association?{association}:{})})));
    if(requested.includes('team_members')&&!nataListingUrl(page.url))for(const member of pageTeam){teamMembers.push(member);facts.push({field:'team_members',value:member,sourceUrl:page.url,quote:member.quote,capturedAt,evidenceType:'published',reader:page.reader,readStartedAt,readElapsedMs,...(association?{association}:{})});}

    if(nataListingUrl(page.url)){const accreditation=parsePublishedAccreditation(page.html||'',page.url,domain,capturedAt,identity);if(accreditation&&requested.includes('accreditations')){accreditations.push(accreditation);facts.push({field:'accreditations',value:accreditation,sourceUrl:page.url,quote:accreditation.quote,capturedAt,evidenceType:'published',reader:page.reader,readStartedAt,readElapsedMs});}const contact=parseAccreditationContact(page.html||'',page.url,domain,capturedAt,identity);if(contact){registryContacts.push(contact);facts.push({field:'accreditation_contacts',value:contact,sourceUrl:page.url,quote:`Published ${contact.registry} accreditation contact`,capturedAt,evidenceType:'published',reader:page.reader,readStartedAt,readElapsedMs});}}
    for(const link of pageLinks(page))if(priority(link)<3||nataListingUrl(link))enqueue(link);
    attempts.push({kind:'page',url:page.url,status:'succeeded',startedAt:new Date(at).toISOString(),elapsedMs:Math.max(0,now()-at),...(page.truncated?{reason:'Full page truncated at bounded content limit'}:{})});if(page.truncated)limited=true;
   }catch{attempts.push({kind:'page',url,status:'failed',startedAt:new Date(at).toISOString(),elapsedMs:Math.max(0,now()-at),reason:'Public page read unavailable'});}
  };
  const discoveryDeadline=Math.min(deadline,started+45000),initialReadCeiling=Math.min(3,Math.max(1,maxPages-2));
  await visit(home,initialReadCeiling,discoveryDeadline);
  const registryUrls=[...(input.knownRegistryUrls||[]),...accreditationSourceUrls(input.raw||{})];for(const url of registryUrls)if(nataListingUrl(url))enqueue(url);
  for(const url of queue.filter(url=>nataListingUrl(url)))if(readCount<Math.max(1,maxPages-2)&&now()<deadline){queue.splice(queue.indexOf(url),1);await visit(url,Math.max(1,maxPages-2));}
  if(deps.readDocument&&now()<discoveryDeadline&&requested.some(field=>!observed(field))){
   const documents=[new URL('/robots.txt',home).href,new URL('/sitemap.xml',home).href],seen=new Set<string>();
   for(let n=0;n<documents.length&&n<4&&now()<discoveryDeadline;n++){
    const url=documents[n];if(seen.has(url)||!allowed(url))continue;seen.add(url);const at=now();
    try{const doc=await deps.readDocument(url,Math.min(discoveryDeadline,now()+5000));if(researchDomain(doc.url)!==domain)throw Error('Document identity mismatch');
     const text=doc.text;for(const match of text.matchAll(/(?:^|\n)\s*Sitemap:\s*(\S+)/gi)){const found=publicResearchUrl(match[1]);if(found&&researchDomain(found)===domain&&!documents.includes(found))documents.push(found);}
     for(const match of text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)){const found=publicResearchUrl(match[1].replaceAll('&amp;','&').trim());if(!found||researchDomain(found)!==domain)continue;if(/\.xml(?:\?|$)/i.test(found)){if(!documents.includes(found))documents.push(found);}else if(priority(found)<3)enqueue(found);}
     attempts.push({kind:'document',url:doc.url,status:'succeeded',startedAt:new Date(at).toISOString(),elapsedMs:Math.max(0,now()-at),...(doc.truncated?{reason:'Discovery document truncated'}:{})});if(doc.truncated)limited=true;
    }catch{attempts.push({kind:'document',url,status:'failed',startedAt:new Date(at).toISOString(),elapsedMs:Math.max(0,now()-at),reason:'Discovery document unavailable'});}
   }
  }
  queue.sort((a,b)=>priority(a)-priority(b));
  while(queue.length&&readCount<initialReadCeiling&&now()<discoveryDeadline)await visit(queue.shift()!,initialReadCeiling,discoveryDeadline);
  const order:CompanyMissingField[]=['company_emails','accreditation_contacts','accreditations','team_members','company_phones','description','year_founded','acn','website_address','employee_count','revenue'];let queries=0;
  for(const field of order.filter(field=>requested.includes(field))){
   if(observed(field))continue;
   if(!deps.search||queries>=maxQueries||now()>=deadline||readCount>=maxPages){limited=true;continue;}
   const search=async(query:string)=>{
    if(!deps.search||queries>=maxQueries||now()>=deadline){limited=true;return [];}
    queries++;searched.add(field);const at=now();
    try{const results=await deps.search(query,field,deadline);attempts.push({kind:'search',field,query:query.slice(0,500),resultCount:results.length,status:'succeeded',startedAt:new Date(at).toISOString(),elapsedMs:Math.max(0,now()-at)});return results;}
    catch{attempts.push({kind:'search',field,query:query.slice(0,500),status:'failed',startedAt:new Date(at).toISOString(),elapsedMs:Math.max(0,now()-at),reason:'Field-specific search unavailable'});return [];}
   };
   const results=await search(missingFieldSearchQuery(input,field));
   // Failure and empty-result responses both permit the bounded official-name fallback.
   if(!results.length&&['accreditation_contacts','accreditations'].includes(field)&&queries<maxQueries&&now()<deadline)results.push(...await search(registryNameSearchQuery(input,identity.addresses)));
   // Search text selects URLs only; source facts require a subsequent document read.
   const candidates=new Set(results.slice(0,6).map(result=>result.url));for(const result of results.slice(0,6))enqueue(result.url);
   if(field==='team_members')for(const association of relatedDomains){if(queries>=maxQueries||now()>=deadline)break;for(const result of (await search(`site:${association.domain} team people scientists staff`)).slice(0,6)){candidates.add(result.url);enqueue(result.url);}}
   const fieldReadCeiling=Math.min(maxPages,readCount+2);while(readCount<fieldReadCeiling&&now()<deadline){const next=queue.filter(url=>candidates.has(url)||nataListingUrl(url)||relatedDomains.some(association=>researchDomain(url)===association.domain)).sort((a,b)=>priority(a)-priority(b))[0];if(!next)break;queue.splice(queue.indexOf(next),1);await visit(next,fieldReadCeiling);}

  }
  for(let i=facts.length-1;i>=0;i--)if(facts[i].field==='company_emails'&&typeof facts[i].value==='string'&&personEmails.has(String(facts[i].value).toLowerCase()))facts.splice(i,1);
  const incomplete=limited||queue.length>0||now()>=deadline||attempts.some(a=>a.status==='failed');
  const fields:CompanyMissingFieldResearchResult['fields']={};for(const field of requested)fields[field]=observed(field)?{status:'reported'}:incomplete||!searched.has(field)?{status:'research_incomplete',reason:'Field remains unresolved after bounded retrieval; source/read/budget coverage incomplete'}:{status:'not_disclosed',reason:'No published value found on retrieved pages and field-specific search sources'};
  const uniqueFacts=[...new Map(facts.filter(f=>f.field!=='company_emails'||typeof f.value!=='string'||!personEmails.has(f.value.toLowerCase())).map(f=>[JSON.stringify([f.field,f.value,f.sourceUrl]),f])).values()];
  return{facts:uniqueFacts,fields,attempts,teamMembers,accreditations,relatedDomains,registryContacts:[...new Map(registryContacts.map(c=>[`${c.sourceUrl}:${c.name}`,c])).values()]};
 };
}

/** Uses the application's existing Crawl4AI HTTP service, never a tool/MCP client. */
export type MissingFieldCrawlEnvironment={LOCAL_DEVELOPMENT?:string;LOCAL_RESEARCH_BENCHMARK?:string;LOCAL_CRAWL4AI_URL?:string;CRAWL4AI_URL?:string;CRAWL4AI_SECRET?:string;RESEARCH_WORKER_URL?:string;RESEARCH_SERVICE_SECRET?:string};
export function createMissingFieldCrawlReader(env:MissingFieldCrawlEnvironment={LOCAL_DEVELOPMENT:process.env.LOCAL_DEVELOPMENT,LOCAL_RESEARCH_BENCHMARK:process.env.LOCAL_RESEARCH_BENCHMARK,LOCAL_CRAWL4AI_URL:process.env.LOCAL_CRAWL4AI_URL,CRAWL4AI_URL:process.env.CRAWL4AI_URL,CRAWL4AI_SECRET:process.env.CRAWL4AI_SECRET,RESEARCH_WORKER_URL:process.env.RESEARCH_WORKER_URL,RESEARCH_SERVICE_SECRET:process.env.RESEARCH_SERVICE_SECRET},fetcher:typeof fetch=fetch) {
 return async(url:string,deadline:number):Promise<MissingFieldPage>=>{
  if(!publicResearchUrl(url))throw Error('Unsupported public URL');
  const local=env.LOCAL_DEVELOPMENT==='true';
  const proxy=!local&&!env.CRAWL4AI_URL&&Boolean(env.RESEARCH_WORKER_URL&&env.RESEARCH_SERVICE_SECRET);
  if(!local&&!env.CRAWL4AI_URL&&!proxy){const page=await readIdentityWebsite(url,deadline);return{url:page.url,html:page.html,truncated:page.truncated,reader:'public-http',onlyMainContent:false};}
  const endpoint=local?localReaderEndpoint(env):proxy?new URL('/company-page',env.RESEARCH_WORKER_URL!).href:new URL('/crawl',env.CRAWL4AI_URL!).href;
  const secret=proxy?env.RESEARCH_SERVICE_SECRET:env.CRAWL4AI_SECRET;
  if(!local&&(new URL(endpoint).protocol!=='https:'||!secret))throw Error('Authenticated HTTPS Crawl4AI service required');
  const remaining=Math.min(40000,deadline-Date.now());if(remaining<=0)throw Error('Missing-field read deadline reached');
  const {response,data}=await providerJsonRequest<{url?:string;html?:string;markdown?:string;truncated?:boolean;only_main_content?:boolean}>(fetcher,endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(!local?{authorization:`Bearer ${secret}`}:{})},body:JSON.stringify({url,only_main_content:false}),signal:AbortSignal.timeout(remaining),cache:'no-store'},{provider:'local-crawl4ai',operation:'company_missing_fields_full_page'});
  if(!response.ok||!data.url||!publicResearchUrl(data.url)||data.only_main_content!==false||typeof data.html!=='string'||!data.html.trim())throw Error('Full-page Crawl4AI contract unavailable');
  return{url:data.url,html:data.html.slice(0,250000),markdown:data.markdown?.slice(0,100000),truncated:data.truncated===true,reader:local?'local-crawl4ai':'crawl4ai-http',onlyMainContent:false};
 };
}
export async function researchCompanyMissingFields(input:CompanyMissingFieldResearchInput){return createCompanyMissingFieldResearch({
 readPage:createMissingFieldCrawlReader(),
 readDocument:async(url,deadline)=>{const result=await readIdentityWebsite(url,deadline);return{url:result.url,text:result.html,truncated:result.truncated};},
 search:async(query,_field,deadline)=>cloudflareSearchResults(query,(input,init)=>fetch(input,{...init,signal:AbortSignal.any([...(init?.signal?[init.signal]:[]),AbortSignal.timeout(Math.max(1,deadline-Date.now()))])}),input.jobId),
})(input);}
