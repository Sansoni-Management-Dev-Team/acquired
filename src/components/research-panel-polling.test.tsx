import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {ResearchJob,ResearchPanelData} from './research-panel';
const m=vi.hoisted(()=>({poll:vi.fn()}));
vi.mock('./use-active-polling',()=>({useActivePolling:m.poll}));
import {ResearchPanel} from './research-panel';
const job:ResearchJob={id:'root',status:'crawling',pages:0,modelCalls:0,message:'Reading',createdAt:'2026-09-30',seeds:[],config:{approved:true,searchTerms:[],seeds:[],geography:'AU',discover:false,budget:{maxPages:5,maxModelCalls:5,maxDomains:5,maxMinutes:5}}};
const snapshot=(overrides:Partial<ResearchPanelData>={}):ResearchPanelData=>({enabled:true,active:true,jobs:[job],findings:[],results:[],...overrides});
beforeEach(()=>{vi.resetAllMocks();});afterEach(()=>{vi.unstubAllGlobals();});
it('shows the company pipeline layout before the first research snapshot arrives', () => {
 const html=renderToStaticMarkup(<ResearchPanel mandateId="mandate" startedRunId="root" showStartAction={false} onResultsChanged={()=>{}} />);
 for(const label of ['Searching for businesses','Finding headcounts','Finding revenue bands','Verifying ABNs','Finding people and emails','Saving company results']) expect(html).toContain(label);
 expect(html).toContain('0 companies researched');
 expect(html).toContain('0 companies saved');
 expect(html).not.toContain('Stage 1 of 4');
 expect(html).not.toContain('Find candidates');
 expect(html).not.toContain('aria-valuenow');
});
async function observe(responses:ResearchPanelData[]) {
 const changed=vi.fn();
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>Response.json(responses.shift())));
 renderToStaticMarkup(<ResearchPanel mandateId="mandate" onResultsChanged={changed} hideProgress />);
 const refresh=m.poll.mock.calls[0][0];
 while(responses.length) await refresh();
 return changed.mock.calls.map(c=>c[1]);
}
it('loads initial research without refreshing an already loaded workspace and ignores historical/status-only polls',async()=>{
 expect(await observe([snapshot(),snapshot(),snapshot({jobs:[{...job,status:'extracting',pages:3,message:'Extracting'}]})])).toEqual([false,false,false]);
});
it('refreshes for new evidence, saved companies and terminal lifecycle changes',async()=>{
 const evidence={id:'finding',jobId:'root',targetId:'target',sourceUrl:'https://example.com',observedAt:'2026-09-30',evidence:{kind:'company',name:'Example',value:'Example',quote:'Example source quote',website:'https://example.com'}} as ResearchPanelData['findings'][number];
 const baseline=snapshot();const found=snapshot({findings:[evidence]});const company=snapshot({findings:[evidence],jobs:[{...job,config:{...job.config,newBusinessIds:['target']}}]});
 expect(await observe([baseline,found,company,{...company,active:false,jobs:[{...company.jobs[0],status:'complete'}]}])).toEqual([false,true,true,true]);
});
it('ignores zero-result bookkeeping and reordered historical jobs',async()=>{
 const second={...job,id:'second',status:'complete'};
 expect(await observe([snapshot({jobs:[job,second]}),snapshot({jobs:[second,job],results:[{jobId:'root',added:0,updated:0,people:0}]})])).toEqual([false,false]);
});

it('does not refresh memberships for candidate admission or counters without results', async () => {
 const candidate={...job,id:'candidate',config:{...job.config,discoveryCandidate:true}};
 expect(await observe([snapshot(),snapshot({jobs:[job,candidate]}),snapshot({jobs:[job,{...candidate,pages:1,message:'Extracting',status:'extracting'}]})])).toEqual([false,false,false]);
});
it('refreshes when a saved finding is attached to a company', async () => {
 const finding={id:'finding',jobId:'root',sourceUrl:'https://example.com',observedAt:'2026-09-30',evidence:{kind:'company',name:'Example',value:'Example',quote:'Example source quote',website:'https://example.com'}} as ResearchPanelData['findings'][number];
 expect(await observe([snapshot({findings:[finding]}),snapshot({findings:[{...finding,targetId:'target'}]})])).toEqual([false,true]);
});
