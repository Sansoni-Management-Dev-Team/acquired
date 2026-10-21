import {describe,expect,it} from 'vitest';
import type {ResearchConfig} from './research';
import {initialResearchOutcome} from './initial-research-outcome';
const config=(value:unknown)=>value as ResearchConfig;
describe('initial research outcome read projection',()=>{
 it('keeps saved candidate discovery separate from available Companies and People and classifies interrupted reader work',()=>{
  const value=initialResearchOutcome({status:'partial',companies:0,people:0,config:config({webSearchPages:{0:{ok:true,rows:Array.from({length:17},(_,n)=>({domain:`c${n}.example`}))},1:{ok:false,category:'domain_backoff',error:'private-cookie private@example.invalid'}},hybridResult:{stopReason:'interrupted',interrupted:2,unprocessed:15,error:'private-cookie'}})});
  expect(value).toEqual({candidates:17,companies:0,people:0,blocker:{code:'research_interrupted',message:'Company profile retrieval was interrupted. Web discovery also encountered temporary reader backoff.'}});expect(JSON.stringify(value)).not.toContain('private');
 });
 it('uses only a versioned allowlisted persisted Firmable failure, never guesses reconnect from arbitrary errors',()=>{
  expect(initialResearchOutcome({status:'partial',companies:0,people:0,config:config({operationalIssues:[{version:1,provider:'firmable',category:'reconnect_required',status:401}]})}).blocker).toEqual({code:'firmable_reconnect_required',message:'The saved Firmable connection needs renewal before company profiles can be retrieved.'});
  expect(initialResearchOutcome({status:'partial',companies:0,people:0,config:config({providerError:'Firmable reconnect_required cookie=secret'})}).blocker?.code).toBe('research_incomplete');
  expect(JSON.stringify(initialResearchOutcome({status:'partial',companies:0,people:0,config:config({operationalIssues:[{version:1,provider:'firmable',category:'cookie=secret'}]})}))).not.toContain('secret');
 });
 it('does not turn completed research or no saved failure into a fabricated provider outage',()=>{
  expect(initialResearchOutcome({status:'complete',companies:2,people:3,config:config({})})).toEqual({candidates:0,companies:2,people:3});
  expect(initialResearchOutcome({status:'queued',companies:0,people:0,config:config({})}).blocker).toBeUndefined();
 });
});
