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
let renderer:ReactTestRenderer;
const mandateId='20000000-0000-4000-8000-000000000002';
beforeEach(()=>{vi.clearAllMocks();m.storage.clear();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',vi.fn());vi.stubGlobal('sessionStorage',{getItem:(k:string)=>m.storage.get(k)??null,setItem:(k:string,v:string)=>m.storage.set(k,v),removeItem:(k:string)=>m.storage.delete(k)});vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(async()=>{if(renderer)await act(()=>renderer.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();});
async function mount(agent=false){await act(()=>{renderer=create(<HomeMandateCreate mandates={[]} agentModeEnabled nativeAgentEnabled sharedWorkflowEnabled/>)});if(agent)await act(()=>renderer.root.findByType(AgentModeToggle).props.onChange(true));}
function button(label:string){return renderer.root.findAllByType('button').find(b=>b.children.join('')===label)!;}
function accept(){vi.mocked(fetch).mockImplementationOnce(async(_url,init)=>{const body=JSON.parse(init!.body as string);return Response.json({id:body.requestId,mandateId,preset:body.preset,presentation:body.presentation,state:'accepted',revision:1});});}
it.each([false,true])('Run demo directly admits a saved source and preserves presentation (agent=%s)',async agent=>{await mount(agent);accept();await act(async()=>{button('Run demo').props.onClick();});expect(fetch).toHaveBeenCalledOnce();const [url,init]=vi.mocked(fetch).mock.calls[0];expect(url).toBe('/api/acquisition-workflows');expect(JSON.parse(init!.body as string)).toEqual({requestId:expect.any(String),preset:'demo',presentation:agent?'agent':'workspace'});expect(m.push).toHaveBeenCalledWith(agent?`/mandates/${mandateId}/agent`:`/mandates/${mandateId}?tab=targets`);expect(m.storage.size).toBe(0);});
it('Find companies submits the generated brief through the same live command',async()=>{await mount();await act(()=>renderer.root.findByProps({id:'mandate-description'}).props.onChange({target:{value:'Established commercial laundry companies in Victoria.'}}));vi.mocked(fetch).mockResolvedValueOnce(Response.json({brief:emptyBrief()}));accept();await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}});});expect(vi.mocked(fetch).mock.calls.map(([url])=>url)).toEqual(['/api/mandates/generate','/api/acquisition-workflows']);expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toMatchObject({preset:'live',brief:emptyBrief(),presentation:'workspace'});});
it('Testing offers live research without outreach and opens the result table',async()=>{await mount(true);await act(()=>renderer.root.findByProps({id:'mandate-description'}).props.onChange({target:{value:'Established commercial laundry companies in Victoria.'}}));vi.mocked(fetch).mockResolvedValueOnce(Response.json({brief:emptyBrief()}));accept();await act(async()=>{button('Test live research').props.onClick();});expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toMatchObject({preset:'live-research-test',presentation:'agent'});expect(m.push).toHaveBeenCalledWith(`/mandates/${mandateId}?tab=targets`);});
it('keeps an uncertain request across refresh and retries the identical body',async()=>{await mount();vi.mocked(fetch).mockRejectedValueOnce(Error('network')).mockResolvedValueOnce(Response.json({status:'missing'}));await act(async()=>{button('Run demo').props.onClick();});const first=vi.mocked(fetch).mock.calls[0][1]!.body;expect(m.storage.get(workflowPendingStorageKey)).toBe(first);await act(()=>renderer.unmount());await mount();expect(JSON.stringify(renderer.toJSON())).toContain('Retry workflow');accept();await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}});});expect(vi.mocked(fetch).mock.calls.at(-1)![1]!.body).toBe(first);expect(m.push).toHaveBeenCalledOnce();});
it('deduplicates rapid clicks before state commits',async()=>{await mount();accept();const click=button('Run demo').props.onClick;await act(async()=>{click();click();});expect(fetch).toHaveBeenCalledOnce();});
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
