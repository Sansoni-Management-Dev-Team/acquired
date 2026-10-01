import { beforeEach, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { ResearchProviderError } from '@/domain/research-provider-error';
const m=vi.hoisted(()=>({search:vi.fn(),claimed:true,writes:[] as Record<string,unknown>[],guards:[] as unknown[], evidenceGuard:undefined as unknown, evidence:[] as unknown[]}));
vi.mock('next/server',()=>({after:vi.fn()}));
vi.mock('@/lib/research-service',()=>({researchEnabled:()=>true,researchServiceAuthorized:()=>true}));
vi.mock('@/adapters/cloudflare-web-search',()=>({cloudflareSearchResults:m.search}));
vi.mock('@/db/research-repository',async original=>({...await original<typeof import('@/db/research-repository')>(),ResearchRepository:class{saveSnippetEstimates=vi.fn();getControl=vi.fn(async()=>({status:"crawling",config:{}}));}}));
const id='00000000-0000-4000-8000-000000000001';
let job:Record<string,unknown>;
vi.mock('@/db/client',()=>({requireDb:()=>({
 select:()=>({from:()=>({where:(guard:unknown)=>{m.evidenceGuard=guard;return {limit:async()=>[job],then:(resolve:(rows:unknown[])=>unknown)=>Promise.resolve(m.evidence).then(resolve)};}})}),
 update:()=>({set:(fields:Record<string,unknown>)=>{m.writes.push(fields);return {where:(guard:unknown)=>{m.guards.push(guard);return {returning:async()=>m.claimed?[{id}]:[],then:(resolve:(rows:unknown[])=>unknown)=>Promise.resolve([]).then(resolve)};}};}}),
})}));
import { POST, GET } from './route';
const call=()=>POST(new Request('https://app/api',{method:'POST',body:JSON.stringify({action:'targeted-followup',field:'size'})}),{params:Promise.resolve({jobId:id})});
it('routes generic-title ABR records ahead of directories for the Headland ABN branch', async () => {
 Object.assign(job.config as Record<string, unknown>, { researchField: 'abn', companyName: 'Headland Technology', companyDomain: 'headland.au', companyLocation: 'Burwood VIC' });
 m.search.mockResolvedValue([{ url: 'https://directory.example.com/headland', title: 'Headland Technology', snippet: '' }, { url: 'https://abr.business.gov.au/ABN/View/96004338961', title: 'Current details for ABN 96 004 338 961', snippet: 'Entity name: HEADLAND TECHNOLOGY PTY LTD Main business location: VIC 3125' }]);
 const response = await POST(new Request('https://app/api', { method: 'POST', body: JSON.stringify({ action: 'targeted-followup', field: 'abn' }) }), { params: Promise.resolve({ jobId: id }) });
 expect(await response.json()).toMatchObject({ query: '"Headland Technology" abn', seeds: ['https://abr.business.gov.au/ABN/View/96004338961', 'https://directory.example.com/headland'] });
});
beforeEach(()=>{
 vi.clearAllMocks();m.claimed=true;m.writes.length=0;m.guards.length=0;m.evidence=[];m.evidenceGuard=undefined;m.search.mockResolvedValue([]);
 job={id,organizationId:'org',mandateId:'mandate',status:'crawling',createdAt:new Date(),updatedAt:new Date(),seeds:[],crawlId:null,config:{approved:true,seeds:[],searchTerms:[],geography:'Australia',purpose:'firmographics',researchField:'size',companyName:'Example Instruments',companyDomain:'instruments.example.com',targetedFollowup:true,budget:{maxPages:12,maxDomains:8,maxMinutes:15,maxModelCalls:14}}};
});
it.each(['browser_admission','reader_busy','domain_backoff'])('defers %s capacity without exhausting or recording query attempts',async category=>{
 m.search.mockRejectedValue(new ResearchProviderError(category,429));
 const response=await call();const body=await response.json();
 expect(body).toMatchObject({seeds:[],deferred:true,retryable:true,retryAfterMs:expect.any(Number)});expect(body.failed).toBeUndefined();expect(body.exhausted).toBeUndefined();
 expect(body.retryAfterMs).toBeGreaterThanOrEqual(1000);expect(body.retryAfterMs).toBeLessThanOrEqual(30000);
 expect(m.writes).toHaveLength(2);
 const release=new PgDialect().sqlToQuery(m.writes[1].config as never);expect(release.sql).toContain("- 'targetedSearchLease'");expect(release.sql).not.toContain('targetedSearchAttempts');expect(release.sql).not.toContain('targetedSearches');
 const guard=new PgDialect().sqlToQuery(m.guards[1] as never);expect(guard.sql).toContain("->>'id'");expect(guard.params).toContain('org');
});
it('defers lease contention without releasing another owner or spending a query attempt',async()=>{
 m.claimed=false;const body=await(await call()).json();expect(body).toMatchObject({deferred:true,retryable:true,retryAfterMs:expect.any(Number)});expect(body.failed).toBeUndefined();expect(body.exhausted).toBeUndefined();expect(m.search).not.toHaveBeenCalled();expect(m.writes).toHaveLength(1);
});
it('still records genuine provider failures against their bounded query allowance',async()=>{
 m.search.mockRejectedValue(new ResearchProviderError('transport',502));const body=await(await call()).json();expect(body).toMatchObject({failed:true,exhausted:false});expect(body.deferred).toBeUndefined();
 const save=new PgDialect().sqlToQuery(m.writes[1].config as never);expect(save.sql).toContain('targetedSearchAttempts');expect(save.params.some(p=>typeof p==='string'&&p.includes('"status":"failed"')&&p.includes('transport'))).toBe(true);
});
it.each([[-1,1000],[Infinity,3000],[90000,30000]])('bounds provider retry delay %s without consuming attempts',async(delay,expected)=>{
 const error=Object.assign(new ResearchProviderError('domain_backoff',429),{retryAfterMs:delay});m.search.mockRejectedValue(error);
 expect((await(await call()).json()).retryAfterMs).toBe(expected);
 const claim=new PgDialect().sqlToQuery(m.writes[0].config as never);const claimJson=claim.params.find(p=>typeof p==='string'&&p.includes('"until"')) as string;
 const guard=new PgDialect().sqlToQuery(m.guards[1] as never);expect(guard.params).toContain(JSON.parse(claimJson).id);
});

it('reuses first-party sibling facts for a parallel field without a target id before searching',async()=>{
 const config=job.config as Record<string,unknown>;Object.assign(config,{parallelBusinessResearch:true,researchTask:'field',researchRunId:'root'});
 m.evidence=[{evidence:{kind:'headcount',name:'Headcount',value:'50 employees',quote:'We employ 50 employees.',factMetadata:{sourceKind:'company_website',basis:'reported',scope:'company'}}}];
 const body=await(await call()).json();expect(body).toMatchObject({exhausted:true,findings:m.evidence.map(f=>(f as {evidence:unknown}).evidence)});expect(m.search).not.toHaveBeenCalled();expect(m.writes).toHaveLength(0);
 const query=new PgDialect().sqlToQuery(m.evidenceGuard as never);expect(query.sql).toContain('count(DISTINCT');expect(query.sql).toContain('mandate_targets');expect(query.sql).toContain('search_snippet');expect(query.params).toContain('instruments.example.com');expect(query.params).toContain('root');expect(query.params).toContain('org');expect(query.params).toContain('mandate');
});
it.skipIf(process.env.RUN_RESEARCH_SCHEDULER_SQL_TESTS !== 'true')('executes SELECT-only sibling scope fixtures for uniqueness, isolation and own-job fallback',async()=>{
 const {Client}=await import('pg');const db=new Client({connectionString:'postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire'});await db.connect();
 const config=job.config as Record<string,unknown>;Object.assign(config,{parallelBusinessResearch:true,researchTask:'field',researchRunId:'root',companyDomain:'www.instruments.example.com'});
 await call();const query=new PgDialect().sqlToQuery(m.evidenceGuard as never);
 const t=[{id:'target',organization_id:'org',domain:'instruments.example.com'},{id:'foreign',organization_id:'foreign-org',domain:'instruments.example.com'},{id:'elsewhere',organization_id:'org',domain:'other.example.com'}];
 const member=[{target_id:'target',organization_id:'org',mandate_id:'mandate'},{target_id:'elsewhere',organization_id:'org',mandate_id:'mandate'}];
 const siblings=[{id:'sibling',organization_id:'org',mandate_id:'mandate',config:{researchRunId:'root'}},{id:'other-root',organization_id:'org',mandate_id:'mandate',config:{researchRunId:'other-root'}},{id:'foreign-job',organization_id:'foreign-org',mandate_id:'mandate',config:{researchRunId:'root'}},{id:'foreign-mandate',organization_id:'org',mandate_id:'foreign-mandate',config:{researchRunId:'root'}}];
 const row=(id:string,job_id:string,target_id='target',organization_id='org',mandate_id='mandate',evidence={})=>({id,job_id,target_id,organization_id,mandate_id,evidence});
 const findings=[row('own',String(job.id),'unknown'),row('safe','sibling'),row('other-root','other-root'),row('foreign-job','foreign-job'),row('foreign-mandate','foreign-mandate'),row('foreign-evidence','sibling','target','foreign-org'),row('foreign-evidence-mandate','sibling','target','org','foreign-mandate'),row('snippet','sibling','target','org','mandate',{factMetadata:{basis:'search_snippet'}})];
 const offset=query.params.length;const jsons=[findings,t,member,siblings];
 const prefix=`WITH research_findings AS (SELECT * FROM jsonb_to_recordset($${offset+1}::jsonb) AS r(id text, job_id text, target_id text, organization_id text, mandate_id text, evidence jsonb)), targets AS (SELECT * FROM jsonb_to_recordset($${offset+2}::jsonb) AS r(id text, organization_id text, domain text)), mandate_targets AS (SELECT * FROM jsonb_to_recordset($${offset+3}::jsonb) AS r(target_id text, organization_id text, mandate_id text)), research_jobs AS (SELECT * FROM jsonb_to_recordset($${offset+4}::jsonb) AS r(id text, organization_id text, mandate_id text, config jsonb)) SELECT id FROM research_findings WHERE ${query.sql} ORDER BY id`;
 const select=async()=>(await db.query<{id:string}>(prefix,[...query.params,...jsons.map(v=>JSON.stringify(v))])).rows;
 try{
  expect((await select()).map(r=>r.id)).toEqual(['own','safe']);
  t.push({id:'duplicate',organization_id:'org',domain:'www.instruments.example.com'});member.push({target_id:'duplicate',organization_id:'org',mandate_id:'mandate'});
  expect((await select()).map(r=>r.id)).toEqual(['own']);
  member.splice(0,member.length);expect((await select()).map(r=>r.id)).toEqual(['own']);
 }finally{await db.end();}
});

it('includes sibling facts on full field control while keeping lean controls free of evidence reads',async()=>{
 Object.assign(job.config as Record<string,unknown>,{parallelBusinessResearch:true,researchTask:'field',researchRunId:'root'});m.evidence=[{evidence:{kind:'headcount',name:'Headcount',value:'50 employees',quote:'We employ 50 employees.'}}];
 const full=await GET(new Request('https://app/api'),{params:Promise.resolve({jobId:id})});expect((await full.json()).findings).toEqual(m.evidence.map(f=>(f as {evidence:unknown}).evidence));
 const fullSQL=new PgDialect().sqlToQuery(m.evidenceGuard as never).sql;expect(fullSQL).toContain('count(DISTINCT');
 const lean=await GET(new Request('https://app/api?control=1'),{params:Promise.resolve({jobId:id})});expect((await lean.json()).findings).toBeUndefined();expect(new PgDialect().sqlToQuery(m.evidenceGuard as never).sql).not.toContain('count(DISTINCT');
});
