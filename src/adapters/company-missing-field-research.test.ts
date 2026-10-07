import { expect,it,vi } from 'vitest';
import {createCompanyMissingFieldResearch,createMissingFieldCrawlReader,missingFieldSearchQuery} from './company-missing-field-research';
const input={name:'Synthetic Services',website:'https://synthetic.example.com/',missingFields:['company_emails'] as const};
const base={...input,missingFields:[...input.missingFields]};
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
