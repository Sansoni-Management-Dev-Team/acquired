import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRun,applyProgress,report,harness,sourceRelevant} from '../dist/mandate-harness.mjs';
const mandate=JSON.parse(await readFile(new URL('./mandates/aged-care-software.json',import.meta.url),'utf8'));
test('screenshot brief and explicit research bounds survive job creation',()=>{
 const run=createRun(mandate,1000);
 assert.equal(run.config.researchScope,mandate.brief);assert.equal(run.config.geography,'National');assert.equal(run.deadline,361000);assert.equal(run.config.findPeople,false);assert.equal(run.mandate.criteria.annualRevenueAud.min,3000000);
 assert.throws(()=>createRun({...mandate,maxSearchQueries:3}));
 assert.throws(()=>createRun({...mandate,budget:{...mandate.budget,maxPages:100}}));
});
test('callback revisions are idempotent and reports require actual supported findings',()=>{
 const run=createRun(mandate),event={revision:1,status:'crawling',pages:1,modelCalls:1,message:'read',page:{url:'https://supplier.com.au/',markdown:'Our aged care software supports care providers.',observedAt:new Date().toISOString(),truncated:false,findings:[{kind:'capability',relevance:'relevant',name:'Software',value:'aged care software',quote:'Our aged care software supports care providers.',website:'https://supplier.com.au/'}]}};
 applyProgress(run,event);applyProgress(run,event);assert.equal(run.findings.length,1);assert.equal(run.progress.length,1);
 assert.throws(()=>applyProgress(run,{...event,message:'different'}),/Conflicting/);
 assert.equal(report(run,'complete').passed,false);
 run.searches=[{seedCount:1}];applyProgress(run,{revision:2,status:'partial',pages:1,modelCalls:1,message:'budget reached'});
 assert.equal(report(run,'complete').passed,false);
 run.findings.push({...run.findings[0],kind:'company',name:'Supplier',value:'Supplier'});
 assert.equal(report(run,'complete').passed,true);
 const invalid=createRun(mandate);applyProgress(invalid,{...event,page:{...event.page,markdown:'Something else entirely.'}});assert.equal(invalid.findings[0].quoteSupported,false);assert.equal(report(invalid,'complete').checks.allQuotesSupported,false);
});
test('authenticated file-backed callbacks preserve state and do not repeat a retried search',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'acquire-mandate-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;
 const server=await harness({secret:'test',outputDir:dir,fetcher:async()=>{calls++;return Response.json({results:[{url:'https://supplier.com.au/',title:'Care Software | Supplier',snippet:'Aged care software support in Australia.'}]})}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
 const origin=`http://127.0.0.1:${server.address().port}`,headers={authorization:'Bearer test','content-type':'application/json'};
 assert.equal((await fetch(`${origin}/test/runs`,{method:'POST',body:JSON.stringify(mandate)})).status,401);
 const created=await fetch(`${origin}/test/runs`,{method:'POST',headers,body:JSON.stringify(mandate)}).then(r=>r.json());
 for(let i=0;i<2;i++){const response=await fetch(`${origin}/api/research/internal/${created.id}`,{method:'POST',headers,body:JSON.stringify({action:'discover',browserReservation:'one-reservation'})});assert.equal(response.status,200);assert.equal((await response.json()).seeds.length,1)}
 assert.equal(calls,1);
 const restarted=await harness({secret:'test',outputDir:dir,fetcher:async()=>{throw Error('must not repeat')}});
 await new Promise(resolve=>restarted.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{restarted.closeAllConnections();restarted.close(resolve)}));
 const state=await fetch(`http://127.0.0.1:${restarted.address().port}/test/runs/${created.id}`,{headers}).then(r=>r.json());assert.equal(state.searches.length,1);assert.equal(state.seeds[0],'https://supplier.com.au/');
});

test('incidental aged matches cannot qualify as software discovery sources',()=>{
 assert.equal(sourceRelevant({title:'AGED definition',snippet:'Aged means old',url:'https://dictionary.cambridge.org/'},mandate),false);
 assert.equal(sourceRelevant({title:'Supplier',snippet:'Aged care software support in Australia',url:'https://supplier.com.au/'},mandate),true);
});

test('successful HTTP searches distinguish irrelevant responses from usable candidates',async()=>{
 const {classifyDiscovery}=await import('../dist/mandate-harness.mjs');
 const irrelevant=classifyDiscovery([{title:'AGED definition',snippet:'Aged means old',url:'https://dictionary.cambridge.org/'}],mandate);
 assert.equal(irrelevant.quality.category,'irrelevant_results');assert.equal(irrelevant.quality.relevantRows,0);assert.match(irrelevant.warning,/none matched/i);assert.deepEqual(irrelevant.seeds,[]);
 const directory=classifyDiscovery([{title:'Aged care software',snippet:'Aged care software providers in Australia',url:'https://www.servicesaustralia.gov.au/software-for-aged-care/'}],mandate);
 assert.equal(directory.quality.category,'no_company_candidates');assert.equal(directory.quality.relevantRows,1);
 const usable=classifyDiscovery([{title:'Supplier',snippet:'Aged care software support in Australia',url:'https://supplier.com.au/'}],mandate);
 assert.equal(usable.quality.category,'usable');assert.deepEqual(usable.seeds,['https://supplier.com.au/']);assert.equal(usable.warning,undefined);
});

test('web research seeds preserve the discovered host and page instead of a Firmable identity URL',async()=>{
 const {classifyDiscovery}=await import('../dist/mandate-harness.mjs');
 const found=classifyDiscovery([{title:'Care Software',snippet:'Aged care software implementation and support',url:'https://www.caresoftware.com.au/solutions/aged-care/'}],mandate);
 assert.deepEqual(found.seeds,['https://www.caresoftware.com.au/solutions/aged-care/']);
});

test('an exhausted provider stops the next discovery query without fallback',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'acquire-quota-'));t.after(()=>rm(dir,{recursive:true,force:true}));let calls=0;
 const server=await harness({secret:'test',outputDir:dir,fetcher:async()=>{calls++;return Response.json({provider:'tavily',category:'provider_usage_limit',upstreamStatus:432},{status:402})}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
 const origin=`http://127.0.0.1:${server.address().port}`,headers={authorization:'Bearer test','content-type':'application/json'};
 const created=await fetch(`${origin}/test/runs`,{method:'POST',headers,body:JSON.stringify(mandate)}).then(r=>r.json());
 for(const browserReservation of ['first','second']){const response=await fetch(`${origin}/api/research/internal/${created.id}`,{method:'POST',headers,body:JSON.stringify({action:'discover',browserReservation})}).then(r=>r.json());assert.equal(response.more,false);assert.match(response.warning,/provider_usage_limit/)}
 assert.equal(calls,1);
});
