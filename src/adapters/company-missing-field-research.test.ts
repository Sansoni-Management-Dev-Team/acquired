import { expect,it,vi } from 'vitest';
import {createCompanyMissingFieldResearch,createMissingFieldCrawlReader,missingFieldSearchQuery} from './company-missing-field-research';
const input={name:'Synthetic Services',website:'https://synthetic.example.com/',missingFields:['company_emails'] as const};
const base={...input,missingFields:[...input.missingFields]};
it('accepts a completed retrieval even when its final successful response crosses an attempt deadline',async()=>{
 let clock=0;const research=createCompanyMissingFieldResearch({now:()=>clock,readPage:async url=>{clock+=100;return{url,html:'No founding year disclosed',reader:'fixture'}},search:async()=>[{url:'https://synthetic.example.com/history'}]});
 const first=await research({...base,missingFields:['year_founded'],resumable:true,deadline:90});
 const final=await research({...base,missingFields:['year_founded'],resumable:true,resume:first.continuation,deadline:190});
 expect(final.continuation).toBeUndefined();expect(final.fields.year_founded?.status).toBe('not_disclosed');
});
it('retains unread work and actual usage when its explicit retrieval budget is exhausted',async()=>{
 const result=await createCompanyMissingFieldResearch({readPage:async url=>({url,html:'<a href="/contact">Contact</a>',reader:'fixture'})})({...base,resumable:true,maxPages:1,maxSearchQueries:0});
 expect(result.continuation).toBeUndefined();expect(result.checkpoint).toMatchObject({readCount:1,queries:0,queue:['https://synthetic.example.com/contact']});expect(result.budgetExhausted).toBe(true);
});
it('checkpoints unfinished finite work and resumes it without rereading completed pages or losing facts',async()=>{
 let clock=0;
 const readPage=vi.fn(async(url:string)=>{if(url.endsWith('/history'))return{url,html:'Established in 2001',reader:'fixture'};clock=100;return{url,html:'<footer>saved@synthetic.example.com</footer>',reader:'fixture'};});
 const search=vi.fn(async()=>[{url:'https://synthetic.example.com/history'}]);
 const research=createCompanyMissingFieldResearch({readPage,search,now:()=>clock});
 const first=await research({...base,missingFields:['company_emails','year_founded'],deadline:90,resumable:true});
 expect(first.continuation).toBeDefined();expect(first.facts).toContainEqual(expect.objectContaining({field:'company_emails',value:'saved@synthetic.example.com'}));
 const next=await research({...base,missingFields:['company_emails','year_founded'],deadline:1000,resumable:true,resume:first.continuation});
 expect(next.continuation).toBeUndefined();expect(next.fields).toMatchObject({company_emails:{status:'reported'},year_founded:{status:'reported'}});
 expect(readPage.mock.calls.map(([url])=>url)).toEqual([input.website,'https://synthetic.example.com/history']);
 expect(next.facts.map(f=>f.field).sort()).toEqual(['company_emails','year_founded']);
});
it('full homepage plaintext footer email absent from search snippet becomes sourced evidence, not a missing value',async()=>{
 const search=vi.fn();const readPage=vi.fn(async(url:string)=>({url,html:'<main>Testing services</main><footer>office@synthetic.example.com</footer>',reader:'local-crawl4ai'}));
 const result=await createCompanyMissingFieldResearch({readPage,search})(base);
 expect(result.fields.company_emails?.status).toBe('reported');expect(result.facts[0]).toMatchObject({field:'company_emails',value:'office@synthetic.example.com',sourceUrl:input.website,evidenceType:'published',reader:'local-crawl4ai'});expect(result.facts[0].quote).toContain('office@synthetic.example.com');expect(search).not.toHaveBeenCalled();
});
it('robots sitemap index leads to contact child page and retains email read provenance',async()=>{
 const readPage=vi.fn(async(url:string)=>({url,html:url.endsWith('/contact')?'<p>Email: laboratory@synthetic.example.com</p>':'<main>Company homepage</main>',reader:'fixture-crawl'}));
 const readDocument=vi.fn(async(url:string)=>({url,text:url.endsWith('robots.txt')?'Sitemap: https://synthetic.example.com/site-index.xml':url.endsWith('site-index.xml')?'<sitemapindex><sitemap><loc>https://synthetic.example.com/contact-map.xml</loc></sitemap></sitemapindex>':url.endsWith('contact-map.xml')?'<urlset><url><loc>https://synthetic.example.com/contact</loc></url></urlset>':'<urlset/>'}));
 const result=await createCompanyMissingFieldResearch({readPage,readDocument})(base);expect(readPage).toHaveBeenCalledWith('https://synthetic.example.com/contact',expect.any(Number));expect(result.facts).toContainEqual(expect.objectContaining({field:'company_emails',sourceUrl:'https://synthetic.example.com/contact'}));expect(result.attempts.some(a=>a.kind==='document'&&a.url?.endsWith('contact-map.xml'))).toBe(true);
});
it('targeted search links are read; a snippet email never becomes proof and other company pages are rejected',async()=>{
 const readPage=vi.fn(async(url:string)=>({url,html:url.endsWith('/contact')?'<a href="mailto:contact@synthetic.example.com">Email</a>':'No published contacts',reader:'fixture'}));
 const search=vi.fn(async()=>[{url:'https://other.example.com/contact',snippet:'invented@synthetic.example.com'},{url:'https://synthetic.example.com/contact',snippet:'invented@synthetic.example.com'}]);
 const result=await createCompanyMissingFieldResearch({readPage,search})(base);expect(search).toHaveBeenCalledWith('site:synthetic.example.com contact email','company_emails',expect.any(Number));expect(readPage.mock.calls.map(c=>c[0])).not.toContain('https://other.example.com/contact');expect(result.facts.map(f=>f.value)).toContain('contact@synthetic.example.com');expect(JSON.stringify(result.facts)).not.toContain('invented@');
});
it('reader failures leave original provider snapshot untouched and unresolved fields operationally incomplete',async()=>{
 const raw=Object.freeze({description:'Provider retained description',company_emails:['known@synthetic.example.com']});
 const result=await createCompanyMissingFieldResearch({readPage:async()=>{throw Error('timeout');},search:async()=>{throw Error('unavailable');}})({...base,raw,missingFields:['year_founded']});
 expect(result.facts).toEqual([]);expect(result.fields.year_founded?.status).toBe('research_incomplete');expect(raw).toEqual({description:'Provider retained description',company_emails:['known@synthetic.example.com']});expect(result.attempts.filter(a=>a.status==='failed')).toHaveLength(3);
});
it('retained regional NATA source is captured as accreditation contact, never owner/CEO',async()=>{
 const source='https://nata.com.au/accredited-organisation/synthetic-12345-67890/';
 const result=await createCompanyMissingFieldResearch({readPage:async(url)=>({url,html:url===source?'<p>Accreditation No. 12345 Site No. 67890</p><a href="https://synthetic.example.com/">Website</a><p>Contact Ms Avery Morgan P: +61 0400 000 999</p>':'Homepage',reader:'fixture'})})({...base,missingFields:['accreditation_contacts'],raw:{browserResponse:{region:{AU:{org_registers:[{url:source}]}}}}});
 expect(result.registryContacts[0]).toMatchObject({role:'Accreditation contact',sourceUrl:source,name:'Avery Morgan'});expect(result.fields.accreditation_contacts?.status).toBe('reported');
});
it('total deadline/page/query caps classify unattempted objectives without making up missing data',async()=>{
 let clock=0;const search=vi.fn(async()=>[]);const readPage=vi.fn(async(url:string)=>{clock=110001;return{url,html:'No contacts',reader:'fixture'};});
 const result=await createCompanyMissingFieldResearch({readPage,search,now:()=>clock})({...base,missingFields:['company_emails','company_phones'],deadline:110000});expect(readPage).toHaveBeenCalledTimes(1);expect(search).not.toHaveBeenCalled();expect(result.fields.company_emails?.status).toBe('research_incomplete');expect(result.fields.company_phones?.status).toBe('research_incomplete');
 expect(missingFieldSearchQuery(input,'revenue')).toContain('currency financial year');
});
it('Crawl4AI HTTP uses explicit full-page contract and refuses an old truncated-markdown-only response',async()=>{
 const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>{void _input;void _init;return Response.json({url:input.website,html:'<footer>office@synthetic.example.com</footer>',markdown:'footer',only_main_content:false,truncated:false});});
 const read=createMissingFieldCrawlReader({LOCAL_DEVELOPMENT:'true'},fetcher);expect(await read(input.website,Date.now()+10000)).toMatchObject({reader:'local-crawl4ai',onlyMainContent:false});expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({url:input.website,only_main_content:false});
 const old=createMissingFieldCrawlReader({LOCAL_DEVELOPMENT:'true'},async()=>Response.json({url:input.website,markdown:'Main content only'}));await expect(old(input.website,Date.now()+10000)).rejects.toThrow('Full-page Crawl4AI contract unavailable');
});
it('successful bounded page and targeted search with no disclosed value is distinct from failed/unattempted acquisition',async()=>{
 const result=await createCompanyMissingFieldResearch({readPage:async url=>({url,html:'<main>Independent company services</main>',reader:'fixture'}),search:async()=>[]})(base);
 expect(result.fields.company_emails).toMatchObject({status:'not_disclosed'});expect(result.facts).toEqual([]);expect(result.attempts.map(a=>a.status)).toEqual(['succeeded','succeeded']);
});
it('email deep in full footer survives long main content and includes page timing without accepting script/comment addresses',async()=>{
 const result=await createCompanyMissingFieldResearch({readPage:async url=>({url,html:'<main>'+('Visible services '.repeat(3000))+'</main><script>fake@synthetic.example.com</script><!-- hidden@synthetic.example.com --><footer>real@synthetic.example.com</footer>',reader:'full-html'})})(base);
 expect(result.facts.map(f=>f.value)).toEqual(['real@synthetic.example.com']);expect(result.facts[0]).toMatchObject({readStartedAt:expect.any(String),readElapsedMs:expect.any(Number)});
});

it('production full-page reads reuse the authenticated Worker crawler proxy without exposing crawler credentials to the app',async()=>{
 const fetcher=vi.fn(async()=>Response.json({url:input.website,html:'<footer>office@synthetic.example.com</footer>',markdown:'footer',only_main_content:false,truncated:false}));
 const read=createMissingFieldCrawlReader({RESEARCH_WORKER_URL:'https://research.example.com',RESEARCH_SERVICE_SECRET:'synthetic-worker-secret'},fetcher);
 expect(await read(input.website,Date.now()+10000)).toMatchObject({reader:'crawl4ai-http',html:expect.stringContaining('office@')});
 expect(fetcher).toHaveBeenCalledWith('https://research.example.com/company-page',expect.objectContaining({headers:expect.objectContaining({authorization:'Bearer synthetic-worker-secret'})}));
});

it('retains admission classification and stops repeated field queries when browser capacity is deferred', async () => {
 const {BrowserAdmissionDeferred}=await import('@/domain/research-provider-error');
 const search=vi.fn(async()=>{throw new BrowserAdmissionDeferred('private diagnostic body');});
 const result=await createCompanyMissingFieldResearch({readPage:async url=>({url,html:'Company homepage',reader:'fixture'}),search})({...base,missingFields:['company_emails','company_phones']});
 expect(search).toHaveBeenCalledOnce();
 expect(result.attempts.filter(a=>a.kind==='search')).toEqual([expect.objectContaining({status:'failed',category:'browser_admission'})]);
 expect(result.fields.company_emails?.status).toBe('research_incomplete');
 expect(result.fields.company_phones?.status).toBe('research_incomplete');
 expect(JSON.stringify(result)).not.toContain('private diagnostic body');
});

it('does not read or search for any fields already returned in the provider profile',async()=>{
 const readPage=vi.fn(),search=vi.fn(),research=createCompanyMissingFieldResearch({readPage,search});
 const result=await research({name:'Company',website:'https://company.example.com',missingFields:['description','company_emails','company_phones','year_founded','acn','employee_count','revenue','website_address'],raw:{name:'Company',description:'Refrigeration services',year_founded:2001,company_size:'11-50',revenue:'$3M - $6M',industry_codes:{acn:'123456789'},region:{AU:{emails:['office@company.example.com'],phones:['+61300000000'],address:{state:'VIC'},employee_count:0}}}});
 expect(readPage).not.toHaveBeenCalled();expect(search).not.toHaveBeenCalled();expect(result.attempts).toEqual([]);expect(result.facts).toEqual([]);
 expect(Object.values(result.fields).every(f=>f?.status==='already_available')).toBe(true);
});
it('does not use NATA search as a fallback for a different required credential',()=>{
 expect(missingFieldSearchQuery({name:'Company',website:'https://company.example.com',mandateScope:'ISO 9001 certification'},'accreditations')).toBe('site:company.example.com ISO 9001');
});
it('only searches unresolved fields and does not extract replacement facts for provider-covered fields from the same page',async()=>{
 const search=vi.fn(async()=>[]),readPage=vi.fn(async(url:string)=>({url,html:'<p>Different website description</p><footer>replacement@synthetic.example.com</footer>',reader:'fixture'}));
 const raw=Object.freeze({description:'Saved description',company_emails:['saved@synthetic.example.com']});
 const result=await createCompanyMissingFieldResearch({readPage,search})({...base,missingFields:['description','company_emails','year_founded'],raw});
 expect(readPage).toHaveBeenCalled();expect(search).toHaveBeenCalledExactlyOnceWith('site:synthetic.example.com about founded established','year_founded',expect.any(Number));
 expect(result.facts).toEqual([]);expect(result.fields).toMatchObject({description:{status:'already_available'},company_emails:{status:'already_available'},year_founded:{status:'not_disclosed'}});
 expect(raw.company_emails).toEqual(['saved@synthetic.example.com']);
});
