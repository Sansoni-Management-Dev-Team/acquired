import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {AgentSnapshot} from '@/domain/agent-mode';
import type {ResearchJob} from './research-panel';

vi.mock('next/link',()=>({default:({href,children}:{href:string;children:React.ReactNode})=><a href={href}>{children}</a>}));
vi.mock('@/lib/agent-activity-poller',()=>({startAgentActivityPolling:()=>()=>{}}));
vi.mock('./agent-controls-panel',()=>({AgentControlsPanel:({children}:{children:(setup:React.ReactNode)=>React.ReactNode})=>children(null)}));
vi.mock('./company-identity-reviews',()=>({CompanyIdentityReviews:()=>null}));
vi.mock('./agent-brief-review',()=>({AgentBriefReview:()=>null}));
import {AgentWorkspace} from './agent-workspace';

const mandateId='10000000-0000-4000-8000-000000000001';
const jobId='10000000-0000-4000-8000-000000000002';
const initial:AgentSnapshot={mandate:{id:mandateId,name:'Synthetic research',description:'Australian packaging companies'},scope:'research-only',research:{total:1,queued:0,active:1,complete:0,needsReview:0,cancelled:0},jobs:[],links:{brief:'/',companies:`/mandates/${mandateId}/companies`}};
const conversation={threadId:'saved-thread',messages:[{id:'saved-message',role:'assistant' as const,content:'Your saved research conversation.'}]};
let tree:ReactTestRenderer|undefined;
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.stubGlobal('document',{hidden:false,addEventListener:vi.fn(),removeEventListener:vi.fn()});
 vi.stubGlobal('fetch',vi.fn());
 vi.spyOn(console,'error').mockImplementation(()=>{});
});
afterEach(async()=>{if(tree)await act(()=>tree!.unmount());tree=undefined;vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
function savedResearch(status:ResearchJob['status']){
 const root:ResearchJob={id:jobId,status,config:{approved:true,seeds:[],searchTerms:['packaging'],geography:'Australia',discover:true,budget:{maxPages:5,maxDomains:5,maxMinutes:10,maxModelCalls:5},pipelineDesign:'firmable-v1',researchRunId:jobId,includeCompanyPeople:false,parallelResearchSettled:status!=='extracting'},seeds:[],createdAt:'2026-10-27T00:00:00Z',updatedAt:'2026-10-27T00:01:00Z',pages:0,modelCalls:0,message:status==='partial'?'Saved source coverage needs review':'Saved company retrieval',discovery:{candidates:2,firmablePages:1,webQueries:0,webFailures:0}};
 const unrelated={...root,id:'10000000-0000-4000-8000-000000000003',discovery:{candidates:99,firmablePages:1,webQueries:0,webFailures:0},config:{...root.config,researchRunId:'10000000-0000-4000-8000-000000000003'}};
 return {enabled:true,active:status==='extracting',jobs:[unrelated,root],companyJobs:[],peopleJobs:[],findings:[]};
}
it.each([['extracting','Finding businesses'],['complete','Research complete'],['partial','Finished with issues'],['failed','Research failed']] as const)('keeps the actual %s research card inside the saved conversation for its original job',async(status,title)=>{
 vi.mocked(fetch).mockResolvedValue(Response.json(savedResearch(status)));
 await act(async()=>{tree=create(<AgentWorkspace initial={{...initial,initialResearch:{requestId:jobId,jobId,status,source:'live'}}} conversation={conversation}/>);});
 const transcript=tree!.root.findByProps({role:'log','aria-label':'Conversation messages'});
 expect(transcript.findByProps({'aria-label':'Company research progress'})).toBeDefined();
 const text=JSON.stringify(tree!.toJSON());
 expect(text).toContain(title);expect(text).toContain('2 businesses found');expect(text).not.toContain('99 businesses found');
 expect(text).toContain(conversation.messages[0].content);
 expect(vi.mocked(fetch).mock.calls.map(([url,options])=>[url,options?.method??'GET'])).toEqual([[`/api/mandates/${mandateId}/research`,'GET']]);
 expect(tree!.root.findAllByType('button').some(button=>/Find & research|Stop research|Reconnect job|Retry failed pages/.test(String(button.props.children)))).toBe(false);
});
it.each(['preparation','awaiting_start','cached','no_job'] as const)('does not mount a live progress reader or start work for %s',async phase=>{
 const pending=phase==='awaiting_start',cached=phase==='cached';
 await act(async()=>{tree=create(<AgentWorkspace initial={{...initial,initialResearch:{requestId:jobId,...(phase!=='no_job'?{jobId}:{}),status:pending?'awaiting_start':'complete',source:cached?'cached':'live'}}} {...(phase==='preparation'?{preparation:{onStart:vi.fn(),busy:false,researchOnly:true}}:{conversation})}/>);});
 expect(tree!.root.findAllByProps({'aria-label':'Company research progress'})).toHaveLength(0);
 expect(fetch).not.toHaveBeenCalled();
});
it('updates the same card to its saved terminal outcome and restores it once on refresh using GET only',async()=>{
 vi.useFakeTimers();let reads=0;
 vi.mocked(fetch).mockImplementation(async()=>Response.json(savedResearch(reads++===0?'extracting':'complete')));
 const view=<AgentWorkspace initial={{...initial,initialResearch:{requestId:jobId,jobId,status:'extracting',source:'live'}}} conversation={conversation}/>;
 await act(async()=>{tree=create(view);});
 expect(JSON.stringify(tree!.toJSON())).toContain('Finding businesses');
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 expect(JSON.stringify(tree!.toJSON())).toContain('Research complete');
 expect(tree!.root.findAllByProps({'aria-label':'Company research progress'})).toHaveLength(1);
 await act(()=>tree!.unmount());
 await act(async()=>{tree=create(view);});
 expect(JSON.stringify(tree!.toJSON())).toContain('Research complete');
 expect(tree!.root.findAllByProps({'aria-label':'Company research progress'})).toHaveLength(1);
 expect(vi.mocked(fetch).mock.calls.every(([url,options])=>url===`/api/mandates/${mandateId}/research`&&options?.method==='GET')).toBe(true);
});
