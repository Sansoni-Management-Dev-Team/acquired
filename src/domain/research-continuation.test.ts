import {expect,it} from 'vitest';
import {automaticContinuation} from './research-continuation';
import type {ResearchConfig} from './research';
const config:ResearchConfig={approved:true,discover:true,seeds:[],searchTerms:['sensors'],geography:'Australia',purpose:'people',budget:{maxPages:5,maxDomains:3,maxModelCalls:5,maxMinutes:10},runtime:{visited:['https://example.com/','https://example.com/about'],remaining:['https://example.com/team'],attempts:[{url:'https://example.com/',status:'read',reason:'Read'},{url:'https://example.com/about',status:'failed',reason:'Stopped'}]}};
const job={id:'parent',status:'partial',message:'Worker request budget reached',createdAt:new Date(0),modelCalls:1,config};
it('resumes unread pages with only unused page, model and time allowance',()=>{
 const next=automaticContinuation(job,60000)!;
 expect(next.budget).toEqual({maxPages:3,maxDomains:3,maxModelCalls:4,maxMinutes:9});
 expect(next.discover).toBe(false);
 expect(next.runtime?.visited).toEqual(['https://example.com/']);
 expect(next.runtime?.remaining).toEqual(['https://example.com/about','https://example.com/team']);
 expect(next.autoDomains).toEqual(['example.com']);
});
it('does not restart cancelled, exhausted or expired jobs',()=>{
 expect(automaticContinuation({...job,status:'cancelled'},60000)).toBeNull();
 expect(automaticContinuation(job,600000)).toBeNull();
 expect(automaticContinuation({...job,config:{...config,budget:{...config.budget,maxPages:2}}},60000)).toBeNull();
});
it('does not loop without progress or resume unrelated failures',()=>{
 expect(automaticContinuation({...job,message:'No evidence'},60000)).toBeNull();
 expect(automaticContinuation({...job,config:{...config,runtime:{...config.runtime!,attempts:[]}}},60000)).toBeNull();
});
it('carries root identity and domain usage through subsequent executions',()=>{
 const next=automaticContinuation({...job,config:{...config,autoRoot:'original',autoDomains:['first.example.com']}},60000)!;
 expect(next.autoRoot).toBe('original');expect(next.autoDomains).toEqual(['first.example.com','example.com']);
});

it('caps automatic continuations when admission repeatedly makes no progress',()=>{
 const blocked = {...job,message:'Browser admission deferred',config:{...config,admissionContinuations:2,runtime:{visited:[],remaining:['https://example.com/'],attempts:[{url:'https://example.com/',status:'pending' as const,reason:'Waiting'}]}}};
 expect(automaticContinuation(blocked,60000)).toBeNull();
 expect(automaticContinuation({...job,config:{...config,admissionContinuations:2}},60000)?.admissionContinuations).toBe(0);
});

it('resumes fallback admission waits within the same bounded continuation policy',()=>{
 const waiting={...job,message:'Fallback reader admission deferred; continue with a fresh request budget',config:{...config,runtime:{visited:[],remaining:['https://example.com/'],attempts:[{url:'https://example.com/',status:'pending' as const,reason:'Waiting'}]}}};
 expect(automaticContinuation(waiting,60000)?.runtime?.remaining).toContain('https://example.com/');
 expect(automaticContinuation({...waiting,config:{...waiting.config,admissionContinuations:2}},60000)).toBeNull();
});

it.each(['website','page','field'] as const)('never recursively starts discovery batches from parallel %s tasks', researchTask=>{
 const parallel={...config,mode:'automatic' as const,purpose:undefined,researchTask,parallelBusinessResearch:true,discoveryPending:true,automaticDeadline:900000,automaticPageLimit:100};
 expect(automaticContinuation({...job,config:parallel,message:'No evidence'},60000)).toBeNull();
});

const capacityConfig = () => ({...config, mode:'automatic', parallelBusinessResearch:true, researchTask:'field', researchField:'email', targetedFollowup:true, targetedSearchDeferred:true, followupPlannerUsed:true, automaticDeadline:300000, followupSearchCounts:{email:1}, followupExhaustedFields:[], performanceFlags:{telemetryBatching:true,progressCoalescing:true,schedulerCoalescing:true}, runtime:{remaining:[],visited:[],attempts:[]}} as ResearchConfig);
it('resumes an explicitly deferred empty field search within its original deadline and unused budgets',()=>{
 const before=capacityConfig();const next=automaticContinuation({...job,config:before,message:'Browser admission deferred; targeted search capacity remains busy'},60000)!;
 expect(next).not.toBeNull();expect(next.seeds).toEqual([]);expect(next.budget).toEqual({...before.budget,maxMinutes:4,maxModelCalls:4});
 expect(next.admissionContinuations).toBe(1);expect(next.followupPlannerUsed).toBe(true);expect(next.targetedSearchDeferred).toBe(false);expect(next.followupSearchCounts).toEqual({email:1});expect(next.followupExhaustedFields).toEqual([]);expect(next.performanceFlags).toEqual(before.performanceFlags);
});
it('does not renew the absolute deadline or exceed the no-progress cap for empty deferred searches',()=>{
 const before=capacityConfig();
 expect(automaticContinuation({...job,config:{...before,admissionContinuations:2}},60000)).toBeNull();
 expect(automaticContinuation({...job,config:before},300000)).toBeNull();
 expect(automaticContinuation({...job,config:before},250000)).toBeNull();
});
it('requires an explicit field-search deferral before resuming an empty runtime',()=>{
 const before=capacityConfig();
 for(const changed of [{targetedSearchDeferred:false},{targetedFollowup:false},{researchTask:'page' as const}])expect(automaticContinuation({...job,config:{...before,...changed}},60000)).toBeNull();
});

it('uses structured capacity state rather than requiring human status wording',()=>{
 expect(automaticContinuation({...job,config:capacityConfig(),message:'Waiting for search capacity'},60000)).not.toBeNull();
});
