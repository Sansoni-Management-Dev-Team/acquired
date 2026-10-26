import {expect,it} from 'vitest';
import {mandateResearchStatus} from './mandate-research-status';

const complete={status:'complete',queued:0,active:0,partial:0,failed:0,cancelled:0};
it('does not call discovery complete while enrichment or people work remains',()=>{
  for(const change of [{active:1},{queued:1},{people:{settled:false,queued:3}}])expect(mandateResearchStatus({...complete,...change})).toBe('running');
  expect(mandateResearchStatus(complete)).toBe('complete');
});
it('keeps incomplete terminal enrichment distinct from a successful run',()=>{
  for(const change of [{partial:1},{failed:1},{cancelled:1},{people:{settled:true,admissionIncomplete:2}}])expect(mandateResearchStatus({...complete,...change})).toBe('partial');
});
it.each([
  [null,'not_started'],['queued','queued'],['discovering','running'],['crawling','running'],['extracting','running'],['complete','complete'],['partial','partial'],['failed','failed'],['cancelled','cancelled'],
])('presents saved %s as %s',(status,expected)=>expect(mandateResearchStatus({...complete,status})).toBe(expected));
it('keeps an explicitly cancelled root cancelled despite outstanding child records',()=>{
  expect(mandateResearchStatus({...complete,status:'cancelled',queued:2,people:{settled:false}})).toBe('cancelled');
});
