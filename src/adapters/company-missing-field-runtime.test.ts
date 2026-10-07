import {afterEach,expect,it,vi} from 'vitest';
vi.mock('./abn-identity-resolver',()=>({readIdentityWebsite:vi.fn(async()=>{throw Error('Synthetic discovery unavailable');})}));
import {researchCompanyMissingFields} from './company-missing-field-research';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('default runtime search preserves the background job ID required by worker admission',async()=>{
 vi.stubEnv('LOCAL_DEVELOPMENT','true');vi.stubEnv('RESEARCH_WORKER_URL','https://worker.example.com');vi.stubEnv('RESEARCH_SERVICE_SECRET','synthetic-secret');
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{if(String(url).endsWith('/crawl'))return Response.json({url:'https://orion.example.com/',html:'<p>Services</p>',only_main_content:false});expect(String(url)).toBe('https://worker.example.com/search');expect(new Headers(init?.headers).get('x-research-job-id')).toBe('synthetic-stable-background-job');return Response.json({seeds:[],results:[]});});vi.stubGlobal('fetch',fetcher);
 const result=await researchCompanyMissingFields({name:'Orion',website:'https://orion.example.com/',jobId:'synthetic-stable-background-job',missingFields:['company_emails']});expect(fetcher.mock.calls.some(call=>String(call[0]).endsWith('/search'))).toBe(true);expect(result.attempts.some(a=>a.kind==='search'&&a.status==='succeeded')).toBe(true);
});
