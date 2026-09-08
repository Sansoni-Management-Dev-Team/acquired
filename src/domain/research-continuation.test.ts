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
