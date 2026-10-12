import {expect,it} from 'vitest';
import {localBenchmarkDatabase,designSnapshot,compareDesigns,persistedDataCompletion} from './research-design-metrics.mjs';
it('cannot target an existing app/production database',()=>{
 expect(()=>localBenchmarkDatabase('project_acquire')).toThrow();expect(()=>localBenchmarkDatabase('evil;DROP DATABASE')).toThrow();expect(localBenchmarkDatabase('project_acquire_bench_b_123')).toContain('127.0.0.1:5434');
});
it('does not treat a partial root with active children as finished or inherited evidence as retrieved',()=>{
 const root={id:'root',created_at:0,updated_at:500,status:'partial',pages:0,model_calls:0,config:{researchRunId:'root',automaticDeadline:10000}};
 const child={...root,id:'child',status:'extracting',config:{researchRunId:'root',researchField:'abn',targetId:'t',companyDomain:'example.com'}};
 const s=designSnapshot({jobs:[root,child],findings:[{job_id:'old',target_id:'t',evidence:{kind:'abn'}}],fieldSatisfied:(_f,e)=>e.length>0,now:1000});expect(s.finished).toBe(false);expect(s.coverage.abn).toEqual({found:0,total:1,percent:0});
});
it('rejects comparisons with different starting state or incomplete runs',()=>{
 const a={manifest:{caseHash:'same',baselineHash:'one',providerHash:'same',observerHash:'same'},summary:{finished:true,elapsedMs:10}};
 expect(compareDesigns(a,{...a,manifest:{...a.manifest,baselineHash:'two'}}).comparable).toBe(false);
 expect(compareDesigns(a,{...a,summary:{finished:false}}).comparable).toBe(false);
 expect(compareDesigns(a,{...a,summary:{finished:true,elapsedMs:5}}).durationRatio).toBe(.5);
});

it('deduplicates observed spans and separates normal deferrals from request failures',async()=>{
 const {observedDesignMetrics}=await import('./research-design-metrics.mjs');
 const span={event:'segment_finished',id:'span',jobId:'root',segment:'extraction',elapsedMs:10};
 const log=[span,span,{event:'reader_deferred',jobId:'root',category:'reader_busy'},{event:'request_failed',jobId:'root',requestId:'r',provider:'openrouter',operation:'extract',httpStatus:404}].map(e=>'research-provider '+JSON.stringify(e)).join('\n');
 const r=observedDesignMetrics(log,['root']);expect(r.stages.extraction.count).toBe(1);expect(r.deferrals.reader_busy).toBe(1);expect(r.failedRequestEvents['openrouter:extract:404']).toBe(1);
});
it('counts corpus evidence linked during persistence even without a field job targetId',()=>{const root={id:'root',status:'partial',created_at:new Date(0),updated_at:new Date(100),pages:0,model_calls:0,config:{researchRunId:'root',automaticDeadline:1000}};const company={...root,id:'company',status:'complete',config:{researchRunId:'root',researchTask:'company',companyDomain:'example.com'}};const s=designSnapshot({jobs:[root,company],findings:[{job_id:'company',target_id:'t',evidence:{kind:'identifier'}}],fieldSatisfied:(_f,e)=>e.length>0,now:100});expect(s.coverage.abn).toEqual({found:1,total:1,percent:100});});
it('counts verified candidate-company evidence before a mandate target is created',()=>{const root={id:'root',status:'partial',created_at:new Date(0),updated_at:new Date(100),pages:0,model_calls:0,config:{researchRunId:'root',automaticDeadline:1000}};const company={...root,id:'company',status:'complete',config:{researchRunId:'root',researchTask:'company',companyDomain:'example.com'}};const s=designSnapshot({jobs:[root,company],findings:[{job_id:'company',target_id:null,evidence:{kind:'identifier'}}],fieldSatisfied:(_f,e)=>e.length>0,now:100});expect(s.coverage.abn.found).toBe(1);expect(s.qualifiedCompanies).toBe(0);});

it('waits for F people sync even after company research settles',()=>{
 const root={id:'root',status:'complete',created_at:new Date(0),updated_at:new Date(100),pages:0,model_calls:0,config:{researchRunId:'root',pipelineDesign:'hybrid-firmable-v1',includeCompanyPeople:true,parallelResearchSettled:true,automaticDeadline:1000}};
 const pending={status:'running',profiles_saved:2,updated_at:new Date(200)};
 const s=designSnapshot({jobs:[root],peopleRuns:[pending],findings:[],fieldSatisfied:()=>false,now:300});
 expect(s.finished).toBe(false);expect(s.active).toBe(1);expect(s.capabilities.people).toBe('requested');
 const final=designSnapshot({jobs:[root],peopleRuns:[{...pending,status:'complete'}],findings:[],fieldSatisfied:()=>false,now:300});
 expect(final.finished).toBe(true);expect(final.elapsedMs).toBe(200);
});

it('separates bands, missing data, real contacts, and requested versus saved coverage',()=>{
 const targets=[{id:'one',company_name:'One',domain:'one.au',identifiers:{abn:'123'},firmographics:{state:'Unknown',headcount:{value:null},headcountBand:{value:{label:'20–50'}},revenue:{value:{kind:'band',label:'3m–5m'}},establishedYear:{value:null}}},{id:'two',company_name:'Two',domain:'two.au',firmographics:{state:'VIC'}}];
 const contacts=[{target_id:'one',display_name:'Real Person',fictionalised:false,personal_data:{email:{value:'person@example.com'}}},{target_id:'two',display_name:'Demo Person',fictionalised:true,personal_data:{email:'demo@example.com'}}];
 const s=persistedDataCompletion(targets,contacts,20);
 expect(s.fields.headcount).toMatchObject({found:1,percentOfSaved:50,percentOfRequested:5});expect(s.headcountExact).toBe(0);expect(s.headcountBand).toBe(1);expect(s.revenueBands).toBe(1);expect(s.fields.location.found).toBe(1);expect(s.fields.people.found).toBe(1);expect(s.contactsWithEmail).toBe(1);expect(s.fields.founded.found).toBe(0);
});
