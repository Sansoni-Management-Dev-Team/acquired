import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {emptyBrief} from '@/domain/acquisition';
const m=vi.hoisted(()=>({push:vi.fn(),upsert:vi.fn(),storage:new Map<string,string>()}));
vi.mock('next/link',()=>({default:({href,children}:{href:string;children:React.ReactNode})=><a href={href}>{children}</a>}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:m.push})}));
vi.mock('./detail-tooltip',()=>({DetailTooltip:({children}:{children:React.ReactNode})=><>{children}</>}));
vi.mock('@/lib/mandate-cache',()=>({useMandateCache:{getState:()=>({upsert:m.upsert})}}));
import {HomeMandateCreate} from './home-mandate-create';
import {AgentModeToggle} from './agent-mode';
import {workflowPendingStorageKey} from '@/lib/acquisition-workflow-request';
import {readMandateSearch,continueMandateSearch} from '@/lib/mandate-search-launch';
let renderer:ReactTestRenderer;
const mandateId='20000000-0000-4000-8000-000000000002';
beforeEach(()=>{vi.clearAllMocks();m.storage.clear();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',vi.fn());vi.stubGlobal('sessionStorage',{getItem:(k:string)=>m.storage.get(k)??null,setItem:(k:string,v:string)=>m.storage.set(k,v),removeItem:(k:string)=>m.storage.delete(k)});vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(async()=>{if(renderer)await act(()=>renderer.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();});
async function mount(agent=false){await act(()=>{renderer=create(<HomeMandateCreate mandates={[]} agentModeEnabled nativeAgentEnabled sharedWorkflowEnabled/>)});if(agent)await act(()=>renderer.root.findByType(AgentModeToggle).props.onChange(true));}
function button(label:string){return renderer.root.findAllByType('button').find(b=>b.children.join('')===label)!;}
function accept(){vi.mocked(fetch).mockImplementationOnce(async(_url,init)=>{const body=JSON.parse(init!.body as string);return Response.json({id:body.requestId,mandateId,preset:body.preset,presentation:body.presentation,state:'accepted',revision:1});});}
it.each([false,true])('Run demo directly admits a saved source and preserves presentation (agent=%s)',async agent=>{await mount(agent);accept();await act(async()=>{button('Run demo').props.onClick();});expect(fetch).toHaveBeenCalledOnce();const [url,init]=vi.mocked(fetch).mock.calls[0];expect(url).toBe('/api/acquisition-workflows');expect(JSON.parse(init!.body as string)).toEqual({requestId:expect.any(String),preset:'demo',presentation:agent?'agent':'workspace'});expect(m.push).toHaveBeenCalledWith(agent?`/mandates/${mandateId}/agent`:`/mandates/${mandateId}/companies`);expect(m.storage.size).toBe(0);});
function staged(){const path=m.push.mock.calls.at(-1)![0] as string;const id=path.split('/')[2].split('?')[0];return readMandateSearch(id)!;}
it('Find companies routes before preparation, then the search page admits the frozen brief',async()=>{
 await mount();await act(()=>renderer.root.findByProps({id:'mandate-description'}).props.onChange({target:{value:'Established commercial laundry companies in Victoria.'}}));
 await act(()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
 expect(fetch).not.toHaveBeenCalled();const draft=staged();expect(draft).toMatchObject({preset:'live',presentation:'workspace',description:'Established commercial laundry companies in Victoria.'});
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({status:'missing'})).mockResolvedValueOnce(Response.json({brief:emptyBrief()})).mockResolvedValueOnce(Response.json({id:draft.requestId,mandateId:draft.requestId,preset:'live',presentation:'workspace',state:'accepted',revision:1}));
 await continueMandateSearch(draft.requestId);
 expect(vi.mocked(fetch).mock.calls.map(([url])=>url)).toEqual([`/api/acquisition-workflows?requestId=${draft.requestId}`,'/api/mandates/generate','/api/acquisition-workflows']);
 expect(JSON.parse(vi.mocked(fetch).mock.calls[2][1]!.body as string)).toMatchObject({requestId:draft.requestId,preset:'live',presentation:'workspace',brief:emptyBrief()});
});
it('Testing preserves research-only mode and the selected agent presentation in its staged run',async()=>{
 await mount(true);await act(()=>renderer.root.findByProps({id:'mandate-description'}).props.onChange({target:{value:'Established commercial laundry companies in Victoria.'}}));
 await act(()=>renderer.root.findByProps({'aria-label':'Run test: live research only'}).props.onClick());
 expect(fetch).not.toHaveBeenCalled();expect(staged()).toMatchObject({preset:'live-research-test',presentation:'agent'});
});
it('keeps an uncertain request across refresh and retries the identical body',async()=>{await mount();vi.mocked(fetch).mockRejectedValueOnce(Error('network')).mockResolvedValueOnce(Response.json({status:'missing'}));await act(async()=>{button('Run demo').props.onClick();});const first=vi.mocked(fetch).mock.calls[0][1]!.body;expect(m.storage.get(workflowPendingStorageKey)).toBe(first);await act(()=>renderer.unmount());await mount();expect(JSON.stringify(renderer.toJSON())).toContain('Retry workflow');accept();await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}});});expect(vi.mocked(fetch).mock.calls.at(-1)![1]!.body).toBe(first);expect(m.push).toHaveBeenCalledOnce();});
it('deduplicates rapid clicks before state commits',async()=>{await mount();accept();const click=button('Run demo').props.onClick;await act(async()=>{click();click();});expect(fetch).toHaveBeenCalledOnce();});
it('lets a user type a new brief after restoring an uncertain request without reusing its identity',async()=>{
 const oldBody=JSON.stringify({requestId:'10000000-0000-4000-8000-000000000001',preset:'demo',presentation:'workspace'});
 m.storage.set(workflowPendingStorageKey,oldBody);
 await mount();
 expect(renderer.root.findByProps({id:'mandate-description'}).props.readOnly).toBe(false);
 await act(()=>renderer.root.findByProps({id:'mandate-description'}).props.onChange({target:{value:'Commercial refrigeration businesses in Queensland.'}}));
 expect(m.storage.has(workflowPendingStorageKey)).toBe(false);
 expect(renderer.root.findByType(AgentModeToggle).props.disabled).toBe(false);
 expect(fetch).not.toHaveBeenCalled();
 await act(()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
 const submitted=staged();expect(submitted.requestId).not.toBe(JSON.parse(oldBody).requestId);expect(submitted.preset).toBe('live');expect(fetch).not.toHaveBeenCalled();
});
it('can explicitly leave saved-request recovery without submitting or cancelling work',async()=>{
 m.storage.set(workflowPendingStorageKey,JSON.stringify({requestId:'10000000-0000-4000-8000-000000000001',preset:'demo',presentation:'agent'}));
 await mount();
 await act(()=>button('Start a new mandate').props.onClick());
 expect(m.storage.has(workflowPendingStorageKey)).toBe(false);
 expect(renderer.root.findByProps({id:'mandate-description'}).props.readOnly).toBe(false);
 expect(renderer.root.findByType(AgentModeToggle).props.disabled).toBe(false);
 expect(JSON.stringify(renderer.toJSON())).not.toContain('Retry workflow');
 expect(fetch).not.toHaveBeenCalled();
});
it('can recover an existing pending request after new workflows are disabled',async()=>{
 const body=JSON.stringify({requestId:'10000000-0000-4000-8000-000000000001',preset:'demo',presentation:'agent'});
 m.storage.set(workflowPendingStorageKey,body);
 await act(()=>{renderer=create(<HomeMandateCreate mandates={[]} agentModeEnabled nativeAgentEnabled sharedWorkflowEnabled={false}/>);});
 expect(JSON.stringify(renderer.toJSON())).toContain('Retry workflow');
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({error:'Shared workflows are unavailable.'},{status:404})).mockResolvedValueOnce(Response.json({id:JSON.parse(body).requestId,mandateId,preset:'demo',presentation:'agent',state:'ready',revision:2}));
 await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}});});
 expect(vi.mocked(fetch).mock.calls[0][1]!.body).toBe(body);
 expect(m.push).toHaveBeenCalledWith(`/mandates/${mandateId}/agent`);
});
it('offers 20 sample mandates, fills the chosen brief without requests, and runs it through live research only',async()=>{
 await mount();
 const picker=renderer.root.findByProps({id:'research-test-mandate'});
 expect(picker.findAllByType('option')).toHaveLength(21);
 await act(()=>picker.props.onChange({target:{value:'commercial-refrigeration'}}));
 expect(fetch).not.toHaveBeenCalled();
 expect(renderer.root.findByProps({'aria-label':'Run test: live research only'}).props.disabled).toBe(false);
 await act(()=>renderer.root.findByProps({'aria-label':'Run test: live research only'}).props.onClick());
 const draft=staged();expect(draft.description).toContain('commercial refrigeration');expect(draft.description).toContain('QLD');expect(draft.description).toContain('AUD');
 expect(draft.preset).toBe('live-research-test');expect(fetch).not.toHaveBeenCalled();
});
it('choosing a sample leaves old request recovery and starts a fresh research-only request',async()=>{
 const requestId='10000000-0000-4000-8000-000000000001';m.storage.set(workflowPendingStorageKey,JSON.stringify({requestId,preset:'demo',presentation:'agent'}));
 await mount();await act(()=>renderer.root.findByProps({id:'research-test-mandate'}).props.onChange({target:{value:'fire-protection'}}));
 expect(m.storage.has(workflowPendingStorageKey)).toBe(false);expect(fetch).not.toHaveBeenCalled();
 await act(()=>renderer.root.findByProps({'aria-label':'Run test: live research only'}).props.onClick());
 expect(staged().requestId).not.toBe(requestId);expect(staged().preset).toBe('live-research-test');expect(fetch).not.toHaveBeenCalled();
});
it('can step through all 20 samples without starting jobs and returns to a custom brief on editing',async()=>{
 await mount();
 const ids:string[]=[];
 expect(renderer.root.findByProps({'aria-label':'Previous sample mandate'}).props.disabled).toBe(true);
 for(let i=0;i<20;i++){
  await act(()=>renderer.root.findByProps({'aria-label':'Next sample mandate'}).props.onClick());
  ids.push(renderer.root.findByProps({id:'research-test-mandate'}).props.value);
 }
 expect(new Set(ids).size).toBe(20);expect(renderer.root.findByProps({'aria-label':'Next sample mandate'}).props.disabled).toBe(true);
 await act(()=>renderer.root.findByProps({'aria-label':'Previous sample mandate'}).props.onClick());expect(renderer.root.findByProps({id:'research-test-mandate'}).props.value).toBe(ids[18]);
 await act(()=>renderer.root.findByProps({id:'mandate-description'}).props.onChange({target:{value:'My edited acquisition brief.'}}));
 expect(renderer.root.findByProps({id:'research-test-mandate'}).props.value).toBe('');expect(fetch).not.toHaveBeenCalled();
});
it('remembers the current sample when returning home so the next test advances to the following brief',async()=>{
 await mount();await act(()=>renderer.root.findByProps({id:'research-test-mandate'}).props.onChange({target:{value:'fire-protection'}}));
 await act(()=>renderer.unmount());await mount();
 expect(renderer.root.findByProps({id:'research-test-mandate'}).props.value).toBe('fire-protection');
 await act(()=>renderer.root.findByProps({'aria-label':'Next sample mandate'}).props.onClick());expect(renderer.root.findByProps({id:'research-test-mandate'}).props.value).toBe('water-treatment');expect(fetch).not.toHaveBeenCalled();
});
it('does not let a remembered sample overwrite recovery of an existing saved workflow request',async()=>{
 await mount();await act(()=>renderer.root.findByProps({id:'research-test-mandate'}).props.onChange({target:{value:'fire-protection'}}));await act(()=>renderer.unmount());
 const original=JSON.stringify({requestId:'10000000-0000-4000-8000-000000000001',preset:'demo',presentation:'agent'});m.storage.set(workflowPendingStorageKey,original);
 await mount();expect(renderer.root.findByProps({id:'research-test-mandate'}).props.value).toBe('');expect(m.storage.get(workflowPendingStorageKey)).toBe(original);expect(fetch).not.toHaveBeenCalled();
});
it('routes to the stable search step immediately before generation or admission begins',async()=>{
 await mount();await act(()=>renderer.root.findByProps({id:'mandate-description'}).props.onChange({target:{value:'Commercial maintenance companies in Queensland.'}}));
 await act(()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
 expect(fetch).not.toHaveBeenCalled();expect(m.push).toHaveBeenCalledWith(expect.stringMatching(/^\/mandates\/[a-f0-9-]{36}\?tab=search\+enrich$/));
});

it('keeps the live launch locked through navigation so rapid clicks reserve only one identity',async()=>{
 await mount();await act(()=>renderer.root.findByProps({id:'mandate-description'}).props.onChange({target:{value:'Commercial maintenance companies in Queensland.'}}));
 const submit=renderer.root.findByType('form').props.onSubmit;await act(()=>{submit({preventDefault(){}});submit({preventDefault(){}});});
 expect(m.push).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
});
it('returns from home recovery to the same staged search after a refresh without submitting a placeholder',async()=>{
 await mount(true);await act(()=>renderer.root.findByProps({id:'mandate-description'}).props.onChange({target:{value:'Commercial maintenance companies in Queensland.'}}));
 await act(()=>renderer.root.findByProps({'aria-label':'Run test: live research only'}).props.onClick());const first=staged();
 await act(()=>renderer.unmount());await mount();await act(()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
 expect(staged()).toEqual(first);expect(m.push.mock.calls[1][0]).toBe(m.push.mock.calls[0][0]);expect(fetch).not.toHaveBeenCalled();
});
