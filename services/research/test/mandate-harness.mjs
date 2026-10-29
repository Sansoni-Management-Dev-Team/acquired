// A file-backed substitute for Acquire's callback API. Executes real web research;
// it does not simulate provider results or write to an Acquire database.
import {createServer} from 'node:http';
import {createAcquireBridge} from '../src/acquire-bridge.mjs';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {researchStartSchema,progressSchema,publicResearchUrl} from '../../../src/domain/research.ts';
import {discoveryQueryPlan,seedRelevant} from '../../../src/adapters/business-web-search.ts';
import {ownCompany,relevantBusiness} from '../../../src/domain/business-research.ts';
import {webCompanyRows} from '../../../src/domain/web-firmable-pipeline.ts';

const terminal=new Set(['complete','partial','failed','cancelled']);
const uuid=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
export function createRun(mandate,now=Date.now()) {
  if(typeof mandate?.brief!=='string'||!mandate.brief.trim()||mandate.brief.length>960)throw Error('A mandate brief of 1–960 characters is required');
  if(!Number.isInteger(mandate.maxSearchQueries)||mandate.maxSearchQueries<1||mandate.maxSearchQueries>2)throw Error('This smoke test permits one or two search queries');
  const id=randomUUID();
  const parsed=researchStartSchema.parse({requestId:id,seeds:[],searchTerms:mandate.searchTerms,researchScope:mandate.brief,geography:mandate.geography,discover:true,strategy:'discover',workflow:'business',approved:true,findPeople:false,budget:mandate.budget});
  const {requestId,...config}=parsed;
  return {id,mandate,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),deadline:now+config.budget.maxMinutes*60000,config:{...config,researchRunId:id,adaptiveDiscovery:false},status:'queued',revision:0,pages:0,modelCalls:0,seeds:[],findings:[],searches:[],progress:[],timings:[]};
}
export function applyProgress(run,payload) {
  const event=progressSchema.parse(payload);
  if(event.revision<run.revision)return {duplicate:true};
  if(event.revision===run.revision){
    if(JSON.stringify(run.progress.at(-1))!==JSON.stringify(event))throw Object.assign(Error('Conflicting progress revision'),{status:409});
    return {duplicate:true};
  }
  if(terminal.has(run.status))throw Object.assign(Error('Job is already terminal'),{status:409});
  run.progress.push(event);run.revision=event.revision;run.status=event.status;run.pages=event.pages;run.modelCalls=event.modelCalls;run.message=event.message;run.updatedAt=new Date().toISOString();
  if(event.runtime)run.config.runtime=event.runtime;
  if(event.page){
    const markdown=event.page.markdown.replace(/\s+/g,' ').toLowerCase();
    for(const finding of event.page.findings){
      // The worker validates evidence too; independently check quoted support.
      const supported=markdown.includes(finding.quote.replace(/\s+/g,' ').toLowerCase());
      const record={...finding,sourceUrl:event.page.url,observedAt:event.page.observedAt,quoteSupported:supported};
      if(!run.findings.some(f=>f.kind===record.kind&&f.name===record.name&&f.value===record.value&&f.sourceUrl===record.sourceUrl))run.findings.push(record);
    }
  }
  return {duplicate:false};
}
export function sourceRelevant(result,mandate) {
  const text=`${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  return seedRelevant(result,mandate.searchTerms)&&(mandate.sourceRelevanceGroups||[]).every(group=>group.some(term=>text.includes(term.toLowerCase())));
}
export function classifyDiscovery(results,mandate) {
  const relevant=results.filter(row=>sourceRelevant(row,mandate));
  const companies=webCompanyRows(relevant);
  // Domain normalization identifies/deduplicates companies; crawling must keep
  // the actual discovered host and page, not the Firmable lookup homepage.
  const seeds=companies.map(row=>publicResearchUrl(row.discovery.url)).filter(Boolean);
  const category=!results.length?'empty_results':!relevant.length?'irrelevant_results':!companies.length?'no_company_candidates':'usable';
  const warning=category==='irrelevant_results'?`Search returned ${results.length} results but none matched this mandate's sector and software terms`
    :category==='no_company_candidates'?'Search returned relevant sources but no eligible company websites'
    :category==='empty_results'?'Search returned no results':undefined;
  return {seeds,quality:{category,receivedRows:results.length,relevantRows:relevant.length,candidateRows:companies.length},warning};
}
export function report(run,workflowStatus) {
  const supported=run.findings.filter(f=>f.quoteSupported);
  const domains=[...new Set(supported.map(f=>new URL(f.sourceUrl).origin))];
  const relevantCompanyEvidence=domains.some(origin=>{const findings=supported.filter(f=>new URL(f.sourceUrl).origin===origin);return ownCompany(findings,origin)&&relevantBusiness(findings)});
  const checks={workflowCompleted:workflowStatus==='complete',researchFinished:['complete','partial'].includes(run.status),liveSearchReturnedSeeds:run.searches.some(s=>s.seedCount>0),pagesRead:run.pages>0,supportedFindings:run.findings.some(f=>f.quoteSupported),allQuotesSupported:run.findings.every(f=>f.quoteSupported),withinModelBudget:run.modelCalls<=run.config.budget.maxModelCalls,withinPageBudget:run.pages<=run.config.budget.maxPages,relevantCompanyEvidence};
  return {version:1,jobId:run.id,mandate:run.mandate,scope:'Bounded public-web discovery and extraction through the original AcquireResearch workflow. File-backed Acquire callbacks; no Firmable enrichment, canonical Acquire persistence or full automatic pipeline parity.',workflowStatus,researchStatus:run.status,passed:Object.values(checks).every(Boolean),checks,pages:run.pages,modelCalls:run.modelCalls,searches:run.searches,findings:run.findings,message:run.message,financialFit:'Not established by this smoke test. Revenue, EBITDA and headcount requirements remain criteria, not verified company facts.',createdAt:run.createdAt,updatedAt:run.updatedAt};
}
export async function harness({secret,outputDir,fetcher=fetch,workerOrigin='http://127.0.0.1:8787'}) {
  await mkdir(outputDir,{recursive:true,mode:0o700});
  // Serialize file-backed mutations: callback retries cannot race a newer snapshot.
  let tail=Promise.resolve();
  const transaction=work=>{const result=tail.then(work);tail=result.catch(()=>{});return result};
  const file=id=>{if(!uuid.test(id))throw Object.assign(Error('Invalid job ID'),{status:400});return resolve(outputDir,id+'.json')};
  const load=async id=>JSON.parse(await readFile(file(id),'utf8'));
  const save=async run=>{const path=file(run.id);await writeFile(path+'.tmp',JSON.stringify(run,null,2)+'\n',{mode:0o600});await rename(path+'.tmp',path)};
  const server=createServer(async(req,res)=>{
    const reply=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))};
    try{
      if(req.headers.authorization!==`Bearer ${secret}`)return reply(401,{error:'Unauthorized'});
      let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>256*1024)return reply(413,{error:'Request too large'})}
      let body;try{body=text?JSON.parse(text):{}}catch{return reply(400,{error:'Invalid JSON'})}
      const path=new URL(req.url,'http://localhost').pathname;
      if(path==='/test/runs'&&req.method==='POST')return await transaction(async()=>{const run=createRun(body);await save(run);reply(201,{id:run.id,deadline:run.deadline})});
      const testMatch=path.match(/^\/test\/runs\/([a-f\d-]+)$/i);
      if(testMatch&&req.method==='GET')return reply(200,await load(testMatch[1]));
      if(path==='/api/research/internal/background')return reply(200,{ok:true,scheduledJobs:0});
      const match=path.match(/^\/api\/research\/internal\/([a-f\d-]+)(\/timings)?$/i);
      if(!match)return reply(404,{error:'Not found'});
      await transaction(async()=>{
        const run=await load(match[1]);
        const control=()=>({status:run.status,config:run.config,seeds:run.seeds,deadline:run.deadline,findings:run.findings,updatedAt:run.updatedAt});
        if(req.method==='GET'&&!match[2])return reply(200,control());
        if(req.method!=='POST')return reply(405,{error:'Use GET or POST'});
        if(match[2]){run.timings.push(...(body.spans||[]));await save(run);return reply(200,{ok:true})}
        if(['discovery-sources','discovery-persist'].includes(body.action))return reply(200,{pending:false});
        if(body.action==='discover'){
          if(run.providerBlocked)return reply(200,{seeds:run.seeds,more:false,warning:run.providerBlocked});
          const plan=discoveryQueryPlan(run.config.searchTerms,run.config.geography).slice(0,run.mandate.maxSearchQueries);
          const key=body.browserReservation;
          if(typeof key!=='string'||key.length>300)throw Error('Worker search reservation required');
          const previous=run.searches.find(search=>search.reservation===key);
          if(previous)return reply(200,{seeds:run.seeds,more:run.searches.length<plan.length,warning:previous.status==='started'?'Prior search outcome is uncertain; not repeated':previous.warning||previous.error});
          const query=plan[run.searches.length];
          if(!query||Date.now()>=run.deadline)return reply(200,{seeds:run.seeds,more:false});
          // One physical search per callback keeps it inside Acquire's 55s deadline.
          // Persist admission before dispatch so retries never spend the query twice.
          const attempt={query:query.query,page:query.page,reservation:key,startedAt:new Date().toISOString(),status:'started',seedCount:0};run.searches.push(attempt);await save(run);
          try{
            const response=await fetcher(`${workerOrigin}/search`,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json','x-research-job-id':run.id,'x-research-browser-reservation':key},body:JSON.stringify(query),signal:AbortSignal.timeout(50000)});
            const result=await response.json();
            if(!response.ok){
              const category=['provider_usage_limit','provider_authentication','rate_limited'].includes(result.category)?result.category:'provider_error';
              Object.assign(attempt,{category,provider:result.provider,upstreamStatus:result.upstreamStatus});
              const message=`Worker search failed (${category}, HTTP ${response.status})`;
              if(['provider_usage_limit','provider_authentication'].includes(category))run.providerBlocked=message;
              throw Error(message);
            }
            if(!Array.isArray(result.results))throw Error('Worker returned invalid search results');
            const discovery=classifyDiscovery(result.results,run.mandate);
            run.seeds=[...new Set([...run.seeds,...discovery.seeds])];
            Object.assign(attempt,{seedCount:discovery.seeds.length,status:'completed',provider:result.provider||'local',results:result.results,quality:discovery.quality,warning:discovery.warning});
          }catch(error){attempt.status='failed_or_uncertain';attempt.error=error.message}
          await save(run);
          return reply(200,{seeds:run.seeds,more:!run.providerBlocked&&run.searches.length<plan.length,warning:attempt.warning||attempt.error});
        }
        if(body.action)return reply(400,{error:'Unsupported harness callback action'});
        applyProgress(run,body);await save(run);reply(200,{control:control(),timingAcceptedIds:(body.timingSpans||[]).map(s=>s.id)});
      });
    }catch(error){reply(error.code==='ENOENT'?404:error.status||400,{error:error.name==='ZodError'?'Invalid research payload':error.message})}
  });
  return server;
}
// Fixed proxies let the unchanged worker keep its existing loopback-only policy.
export function providerProxy(port,upstream,fetcher=fetch) {
  const allowed=port===7000?new Set(['/duckduckgo/search','/google/search']):new Set(['/crawl']);
  return createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost');
    if(!allowed.has(path.pathname)){res.writeHead(404);res.end();return}
    try{
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536){res.writeHead(413);res.end();return}chunks.push(chunk)}
      const body=Buffer.concat(chunks);
      const response=await fetcher(new URL(path.pathname+path.search,upstream),{method:req.method,headers:{'content-type':'application/json'},...(body.length?{body}:{}),redirect:'manual',signal:AbortSignal.timeout(46000)});
      if(response.status>=300&&response.status<400){res.writeHead(502);res.end();return}
      res.writeHead(response.status,{'content-type':response.headers.get('content-type')||'application/json'});res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.writeHead(502,{'content-type':'application/json'});res.end('{"error":"Local provider unavailable"}')}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const secret=process.env.RESEARCH_SERVICE_SECRET;if(!secret)throw Error('Harness service secret required');
  const mode=process.env.HARNESS_MODE||'test';
  if(!['test','acquire-isolated','acquire-production'].includes(mode))throw Error('Unknown harness mode');
  const server=mode!=='test'
    ?createAcquireBridge({workerSecret:secret,appSecret:process.env.HARNESS_ACQUIRE_SECRET,appFirmableSecret:process.env.HARNESS_ACQUIRE_FIRMABLE_SECRET,appOrigin:process.env.HARNESS_ACQUIRE_ORIGIN,appSite:process.env.HARNESS_ACQUIRE_SITE,production:mode==='acquire-production'})
    :await harness({secret,outputDir:process.env.HARNESS_OUTPUT_DIR||'/output'});
  server.listen(3100,'0.0.0.0',()=>console.info(mode==='test'?'File-backed mandate callbacks ready':'Acquire callback relay ready'));
  if(mode==='test'&&process.env.HARNESS_READER_PROXY!=='false')providerProxy(18083,'http://host.docker.internal:18083').listen(18083,'127.0.0.1');
}
