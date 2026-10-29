import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({enabled:vi.fn(),query:vi.fn(),append:vi.fn(),ensure:vi.fn(),workflow:vi.fn(),read:vi.fn()}));
vi.mock('./agent-runtime',()=>({durableAgentEnabled:m.enabled,agentPool:()=>({query:m.query}),agentStore:()=>({appendMessage:m.append})}));
vi.mock('./agent-initial-research',()=>({ensureInitialMandateResearch:m.ensure}));
vi.mock('./acquisition-workflow-research',()=>({ensureWorkflowResearch:m.workflow}));
vi.mock('@/db/acquisition-workflow-store',()=>({AcquisitionWorkflowStore:class{read=m.read}}));
import {observeInitialResearchProgress,observeScheduledInitialResearch} from './agent-initial-research-observer';
const id='00000000-0000-4000-8000-000000000001',thread='00000000-0000-4000-8000-000000000002';
const job={id,organizationId:'org',mandateId:id,createdBy:'actor',config:{}};
const row=()=>({job_id:id,thread_id:thread,organization_id:'org',mandate_id:id,owner_user_id:'actor',status:'extracting',config:{},companies:2,people:3,initial_research:{version:1,requestId:id,creationRevision:'7'},creation_revision:'7'});
let messages:Map<string,unknown>;
beforeEach(()=>{vi.clearAllMocks();messages=new Map();m.enabled.mockReturnValue(true);m.query.mockImplementation(async(sql:string,args:unknown[])=>({rows:sql.includes('AS initial_research')?[row()]:sql.startsWith('SELECT content FROM agent_messages')?(messages.has(String(args[1]))?[{content:messages.get(String(args[1]))}]:[]):[]}));m.append.mockImplementation(async(_thread,key,role,content)=>{expect(role).toBe('assistant');messages.set(key,content);return{id:key};});});
it('appends bounded Companies/People milestones from persisted ownership and never repeats them on callbacks',async()=>{
 expect(await observeInitialResearchProgress(job)).toMatchObject({messages:2});expect(m.append).toHaveBeenCalledTimes(2);
 expect(m.append.mock.calls.map(call=>call[3].text).join(' ')).toContain('Companies');expect(m.append.mock.calls.map(call=>call[3].text).join(' ')).toContain('People');
 await observeInitialResearchProgress(job);expect(m.append).toHaveBeenCalledTimes(2);
 const sql=m.query.mock.calls.find(call=>String(call[0]).includes('AS initial_research'))![0] as string;expect(sql).toContain('JOIN member');expect(sql).toContain('agent.mandate_created');expect(sql).toContain("'initialResearch'");expect(sql).toContain('j.created_by=a.actor_id');
});
it('does not fabricate progress for absent/historical/foreign marker association or native research',async()=>{
 m.query.mockResolvedValue({rows:[]});expect(await observeInitialResearchProgress(job)).toMatchObject({messages:0});expect(m.append).not.toHaveBeenCalled();
 m.query.mockResolvedValue({rows:[{...row(),initial_research:{version:1,requestId:thread,creationRevision:'7'}}]});expect(await observeInitialResearchProgress(job)).toMatchObject({messages:0});expect(m.append).not.toHaveBeenCalled();
 m.query.mockClear();await observeInitialResearchProgress({...job,config:{nativeAgent:{version:1}}});expect(m.query).not.toHaveBeenCalled();
});
it('records a truthful persisted terminal summary once and excludes raw provider errors or data',async()=>{
 m.query.mockImplementation(async(sql:string,args:unknown[])=>({rows:sql.includes('AS initial_research')?[{...row(),status:'partial',config:{providerError:'secret-cookie private@example.invalid'}}]:sql.startsWith('SELECT content FROM agent_messages')?(messages.has(String(args[1]))?[{content:messages.get(String(args[1]))}]:[]):[]}));
 await observeInitialResearchProgress(job);const terminal=m.append.mock.calls.find(call=>call[1].endsWith(':terminal:v2:partial'))!;expect(terminal[3].text).toContain('2 companies');expect(terminal[3].text).toContain('3 people');expect(terminal[3].text).toContain('partial');expect(JSON.stringify(m.append.mock.calls)).not.toContain('secret-cookie');
 await observeInitialResearchProgress(job);expect(m.append.mock.calls.filter(call=>call[1].endsWith(':terminal:v2:partial'))).toHaveLength(1);
});
it('recovers only bounded persisted marker scopes through the existing initial action and isolates failures',async()=>{
 let scopes=true;m.query.mockImplementation(async(sql:string,args:unknown[])=>{if(sql.includes('LIMIT 10')&&scopes){scopes=false;return{rows:[{organization_id:'org',owner_user_id:'actor',mandate_id:id},{organization_id:'org',owner_user_id:'actor',mandate_id:thread}]};}return{rows:sql.includes('AS initial_research')?[row()]:sql.startsWith('SELECT content FROM agent_messages')?(messages.has(String(args[1]))?[{content:messages.get(String(args[1]))}]:[]):[]};});
 m.ensure.mockRejectedValueOnce(Error('private SQL')).mockResolvedValueOnce({requestId:thread,status:'paused'});
 expect(await observeScheduledInitialResearch()).toMatchObject({checked:2,recovered:0});expect(m.ensure).toHaveBeenCalledTimes(2);expect(m.ensure.mock.calls[0].slice(1)).toEqual([{organizationId:'org',userId:'actor'},id]);
});

it('describes a saved queued root as queued rather than executing research',async()=>{
 m.query.mockImplementation(async(sql:string)=>({rows:sql.includes('AS initial_research')?[{...row(),status:'queued',companies:0,people:0}]:[]}));await observeInitialResearchProgress(job);
 expect(m.append).toHaveBeenCalledOnce();expect(m.append.mock.calls[0][3].text).toContain('queued');expect(m.append.mock.calls[0][3].text).not.toContain('is running');
});
it('waits for outstanding basic People work before recording the final status and counts',async()=>{
 let current={...row(),status:'partial',config:{includeCompanyPeople:true,companyPeopleProgress:{settled:false}},people:1};
 m.query.mockImplementation(async(sql:string,args:unknown[])=>({rows:sql.includes('AS initial_research')?[current]:sql.startsWith('SELECT content FROM agent_messages')?(messages.has(String(args[1]))?[{content:messages.get(String(args[1]))}]:[]):[]}));
 await observeInitialResearchProgress(job);expect(m.append.mock.calls.some(call=>call[1].includes(':terminal:'))).toBe(false);
 current={...current,people:7,config:{includeCompanyPeople:true,companyPeopleProgress:{settled:true}}};await observeInitialResearchProgress(job);
 const final=m.append.mock.calls.filter(call=>call[1].includes(':terminal:'));expect(final).toHaveLength(1);expect(final[0][3].text).toContain('7 people');
});
it('reports only the latest bounded growth bucket per category without repeating unchanged buckets',async()=>{
 let current={...row(),companies:23,people:52,config:{firmableSearchPages:{'0':{records:Array.from({length:7},(_,n)=>({id:'f'+n}))}}}};
 m.query.mockImplementation(async(sql:string,args:unknown[])=>({rows:sql.includes('AS initial_research')?[current]:sql.startsWith('SELECT content FROM agent_messages')?(messages.has(String(args[1]))?[{content:messages.get(String(args[1]))}]:[]):[]}));
 expect(await observeInitialResearchProgress(job)).toEqual({messages:3});expect(m.append.mock.calls.map(call=>call[1])).toEqual([`initial-research:${id}:candidates:5`,`initial-research:${id}:companies:20`,`initial-research:${id}:people:50`]);
 expect(m.append.mock.calls[1][3].text).toContain('23 company');expect(m.append.mock.calls[2][3].text).toContain('52 people');
 current={...current,companies:24,people:53};expect(await observeInitialResearchProgress(job)).toEqual({messages:0});
 current={...current,companies:50,people:100};expect(await observeInitialResearchProgress(job)).toEqual({messages:2});
});
it('corrects the old terminal summary once with saved candidate count and sanitized operational blocker',async()=>{
 messages.set(`initial-research:${id}:terminal:partial`,{text:'old incomplete summary'});
 const current={...row(),status:'partial',companies:0,people:0,config:{webSearchPages:{0:{ok:true,rows:Array.from({length:17},(_,n)=>({domain:`c${n}.example`}))},1:{ok:false,category:'domain_backoff',error:'secret-cookie'}},hybridResult:{stopReason:'interrupted',interrupted:2,unprocessed:15,error:'secret-cookie'}}};
 m.query.mockImplementation(async(sql:string,args:unknown[])=>({rows:sql.includes('AS initial_research')?[current]:sql.startsWith('SELECT content FROM agent_messages')?(messages.has(String(args[1]))?[{content:messages.get(String(args[1]))}]:[]):[]}));
 expect(await observeInitialResearchProgress(job)).toEqual({messages:1});const content=messages.get(`initial-research:${id}:terminal:v2:partial`) as {text:string};expect(content.text).toContain('17 candidate companies');expect(content.text).toContain('0 companies and 0 people');expect(content.text).toContain('profile retrieval was interrupted');expect(content.text).toContain('reader backoff');expect(JSON.stringify(content)).not.toContain('secret-cookie');
 expect(await observeInitialResearchProgress(job)).toEqual({messages:0});
});

it('continues normal progress events for research explicitly started from the welcome screen',async()=>{
 m.query.mockImplementation(async(sql:string,args:unknown[])=>({rows:sql.includes('AS initial_research')?[{...row(),initial_research:{...row().initial_research,startOn:'chat'}}]:sql.startsWith('SELECT content FROM agent_messages')?(messages.has(String(args[1]))?[{content:messages.get(String(args[1]))}]:[]):[]}));
 expect(await observeInitialResearchProgress(job)).toEqual({messages:2});
});

it('projects the original managed research execution without enabling outreach or legacy messages',async()=>{
 const execution={id,mandateId:id,preset:'live-research-test'};m.read.mockResolvedValue(execution);m.enabled.mockReturnValue(false);
 await observeInitialResearchProgress({...job,workflowExecutionId:id});
 expect(m.read).toHaveBeenCalledWith(id);expect(m.workflow).toHaveBeenCalledWith(expect.anything(),{organizationId:'org',userId:'actor'},execution);expect(m.append).not.toHaveBeenCalled();
});
it('rejects a managed completion whose original execution belongs to another mandate',async()=>{
 m.read.mockResolvedValue({id,mandateId:thread});m.workflow.mockClear();await observeInitialResearchProgress({...job,workflowExecutionId:id});expect(m.workflow).not.toHaveBeenCalled();
});
