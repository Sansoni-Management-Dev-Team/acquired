import { afterEach, expect, it, vi } from 'vitest';
import { researchCompanyMissingFields } from './company-missing-field-research';

vi.mock('./abn-identity-resolver', () => ({ readIdentityWebsite: async (url: string) => ({url,html:'<urlset/>',truncated:false}) }));
afterEach(() => {vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('passes the background deadline and job identity to search and saves evidence from its returned page', async () => {
  vi.stubEnv('RESEARCH_WORKER_URL','https://worker.example');
  vi.stubEnv('RESEARCH_SERVICE_SECRET','offline-fixture');
  vi.stubEnv('LOCAL_DEVELOPMENT','false');
  vi.stubEnv('CRAWL4AI_URL','');
  const requests: Array<{url:string;init?:RequestInit}>=[];
  vi.stubGlobal('fetch',vi.fn(async (input: RequestInfo | URL, init?:RequestInit) => {
    const url=String(input);requests.push({url,init});
    if(url.endsWith('/search'))return Response.json({seeds:['https://synthetic.example.com/contact'],results:[{url:'https://synthetic.example.com/contact',title:'Contact',snippet:'An unverified snippet'}]});
    const page=JSON.parse(String(init?.body)).url;
    return Response.json({url:page,html:page.endsWith('/contact')?'<a href="mailto:office@synthetic.example.com">Contact</a>':'Company homepage',only_main_content:false});
  }));
  const deadline=Date.now()+10000;
  const result=await researchCompanyMissingFields({name:'Synthetic Company',website:'https://synthetic.example.com/',missingFields:['company_emails'],jobId:'00000000-0000-4000-8000-000000000001',deadline});
  const search=requests.find(r=>r.url.endsWith('/search'));
  expect(search).toBeDefined();
  const headers=new Headers(search!.init?.headers);
  expect(headers.get('x-research-deadline')).toBe(String(deadline));
  expect(headers.get('x-research-job-id')).toBe('00000000-0000-4000-8000-000000000001');
  expect(search!.init?.signal).toBeInstanceOf(AbortSignal);
  expect(result.fields.company_emails?.status).toBe('reported');
  expect(result.facts).toContainEqual(expect.objectContaining({value:'office@synthetic.example.com',sourceUrl:'https://synthetic.example.com/contact'}));
});
