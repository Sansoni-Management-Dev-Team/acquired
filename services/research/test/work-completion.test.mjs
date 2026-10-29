import{test}from'node:test';
import assert from'node:assert/strict';
import worker,{AcquireResearch,FirmableRefresh}from'../dist/worker.mjs';
import{durationMs}from'../src/runtime.mjs';
const id='00000000-0000-4000-8000-000000000001';
const env={LOCAL_DEVELOPMENT:'true',APP_ORIGIN:'http://127.0.0.1:3100',SERVICE_SECRET:'synthetic-work-completion'};
const config={completionPolicy:'work-items',researchRunId:id,automaticDeadline:1,mode:'automatic',workflow:'business',discover:true,approved:true,seeds:[],searchTerms:['Fire protection'],geography:'Australia',pipelineDesign:'hybrid-firmable-v1',targetBusinesses:20,budget:{maxPages:10,maxDomains:10,maxMinutes:15,maxModelCalls:0},companyDiscoveryPolicy:{version:5,countryScope:'AU',desiredSourceCompanies:20,maxProfiledCompanies:800,firmablePageSize:100,maxFirmablePages:2,maxFirmableRows:200,maxWebQueries:6,maxWebRowsPerQuery:100,queryOrder:'subsector_round_robin',profileSelection:{strategy:'all_discovered',identity:'firmable_id_then_domain',companyOnly:false},automaticPeople:{version:1,maxCompanies:800,maxSearchPagesPerCompany:1,searchPageSize:50,maxContactsPerCompany:3,includePhones:false}}};
function setup(t,handler){
 const fetch=globalThis.fetch,now=Date.now;let clock=1000000;const waits=[],steps=[];
 globalThis.fetch=handler;Date.now=()=>clock;
 t.after(()=>{globalThis.fetch=fetch;Date.now=now;});
 return{advance:ms=>{clock+=ms},waits,steps,step:{do:async(name,options,fn)=>{steps.push(name);return(typeof options==='function'?options:fn)()},sleep:async(name,ms)=>{const amount=durationMs(ms);waits.push({name,ms:amount});clock+=amount}}};
}
test('packaged workflow saves all 85 companies even when work takes 85 minutes and skips unnecessary web discovery',async t=>{
 let saved=0,web=0,finish;let runtime;
 runtime=setup(t,async(url,options)=>{
  if(String(url).endsWith('/timings'))return Response.json({ok:true});
  if(!options?.body)return Response.json({status:'extracting',updatedAt:new Date(Date.now()).toISOString(),deadline:null,config,seeds:[]});
  const body=JSON.parse(options.body);
  if(body.action==='e-plan')return Response.json([{query:'Additional fire companies',page:1}]);
  if(body.action==='d-search')return Response.json({records:Array.from({length:85},(_,i)=>({id:`f${i+1}`,name:`Company ${i+1}`,website:`https://company${i+1}.com.au`})),totalCompany:85});
  if(body.action==='d-company'){saved++;runtime.advance(60000);return Response.json({ok:true,saved:true,matched:true});}
  if(body.action==='e-search'){web++;return Response.json({rows:[],ok:true});}
  if(body.action==='f-finish'){finish=body.result;return Response.json({ok:true});}
  throw Error('Unexpected callback '+body.action);
 });
 await new AcquireResearch({},env).run({payload:{jobId:id}},runtime.step);
 assert.equal(saved,85);assert.equal(web,0);assert.equal(finish.saved,85);assert.equal(finish.unprocessed,0);assert.equal(finish.stopReason,'exhausted');
});
test('packaged workflow continues checkpointed company fields after a durable wait and observes cancellation',async t=>{
 let calls=0,cancelled=false;const fieldConfig={...config,companyBackgroundResearch:{version:1,fields:['company_emails'],sourceRootId:id}};
 const runtime=setup(t,async(url,options)=>{
  if(String(url).endsWith('/timings'))return Response.json({ok:true});
  if(!options?.body)return Response.json({status:cancelled?'cancelled':'extracting',deadline:null,config:fieldConfig,seeds:[]});
  const body=JSON.parse(options.body);assert.equal(body.action,'company-background-research');calls++;
  return Response.json(calls===1?{deferred:true,retryAfterMs:5000}:{accepted:true,status:'complete'});
 });
 assert.equal((await new AcquireResearch({},env).run({payload:{jobId:id}},runtime.step)).status,'complete');
 assert.equal(calls,2);assert.equal(runtime.waits[0].ms,5000);assert.ok(runtime.steps.includes('company-background-attempt-1'));
 calls=0;const sleep=runtime.step.sleep;runtime.step.sleep=async(...args)=>{await sleep(...args);cancelled=true};
 assert.deepEqual(await new AcquireResearch({},env).run({payload:{jobId:id}},runtime.step),{stopped:true});assert.equal(calls,1);
});
test('packaged people workflow respects provider Retry-After without failing or revealing profiles again',async t=>{
 let companies=0;
 const runtime=setup(t,async(_url,options)=>{
  if(!options?.body)return Response.json({status:'running'});
  const body=JSON.parse(options.body);
  if(body.action==='company'){companies++;return companies===1?Response.json({provider:'firmable',category:'rate_limited',retryAfterMs:75000},{status:429}):Response.json({companyId:'f1'});}
  if(body.action==='people-page')return Response.json({found:0,nextOffset:100,complete:true});
  if(body.action==='finalize-search')return Response.json({found:0,nextOffset:0,complete:true});
  if(body.action==='complete')return Response.json({saved:0,found:0});
  throw Error('Unexpected callback '+body.action);
 });
 assert.deepEqual(await new FirmableRefresh({},env).run({payload:{runId:id,mandateId:id}},runtime.step),{saved:0,found:0});assert.equal(companies,2);assert.equal(runtime.waits[0].ms,75000);
});
test('the packaged recovery endpoint cannot terminate healthy finite work from an old timestamp',async t=>{
 let terminated=0;
 setup(t,async()=>Response.json({status:'extracting',updatedAt:new Date(0).toISOString(),deadline:null,config,seeds:[]}));
 const response=await worker.fetch(new Request(`http://worker/jobs/${id}`,{method:'POST',headers:{authorization:`Bearer ${env.SERVICE_SECRET}`,'content-type':'application/json'},body:JSON.stringify({action:'recover-stalled'})}),{...env,RESEARCH:{get:async()=>({terminate:async()=>{terminated++}})}});
 assert.deepEqual(await response.json(),{recovered:false});assert.equal(terminated,0);
});
