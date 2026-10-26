import React,{StrictMode} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {emptyBrief} from '@/domain/acquisition';
import {readMandateSearch,stageMandateSearch} from '@/lib/mandate-search-launch';
const m=vi.hoisted(()=>({refresh:vi.fn(),push:vi.fn(),replace:vi.fn(),storage:new Map<string,string>()}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:m.refresh,push:m.push,replace:m.replace})}));
vi.mock('next/link',()=>({default:({href,children}:{href:string;children:React.ReactNode})=><a href={href}>{children}</a>}));
import {AgentMandatePreparation} from './agent-mandate-preparation';
const id='10000000-0000-4000-8000-000000000001',ownerScope='["owner","org","session"]';
const description='Commercial laundry companies in Queensland.';
const input={requestId:id,preset:'live-research-test' as const,presentation:'agent' as const,description,ownerScope};
const saved={id,mandateId:id,preset:input.preset,presentation:'agent',state:'accepted',revision:1};
let renderer:ReactTestRenderer;
beforeEach(()=>{vi.clearAllMocks();m.storage.clear();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('sessionStorage',{getItem:(key:string)=>m.storage.get(key)??null,setItem:(key:string,value:string)=>{m.storage.set(key,value);},removeItem:(key:string)=>{m.storage.delete(key);}});vi.stubGlobal('fetch',vi.fn());vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(async()=>{if(renderer)await act(()=>renderer.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();});
async function mount(){await act(()=>{renderer=create(<StrictMode><AgentMandatePreparation mandateId={id} ownerScope={ownerScope}/></StrictMode>);});}
function startButton(){return renderer.root.findAllByType('button').find(button=>button.props.children==='Start'||button.props.children==='Retry')!;}
function start(){return startButton().props.onClick();}
function accept(){vi.mocked(fetch).mockImplementation(async(url,options)=>String(url)==='/api/acquisition-session'?Response.json({scope:ownerScope}):String(url).includes('?requestId=')?Response.json({status:'missing'}):String(url).endsWith('/generate')?Response.json({brief:emptyBrief()}):Response.json({...saved,id:JSON.parse(String(options!.body)).requestId}));}
it('shows the existing chat workspace, original brief and welcome Start without generating or admitting on mount',async()=>{
 stageMandateSearch(input);await mount();
 expect(JSON.stringify(renderer.toJSON())).toContain(description);expect(JSON.stringify(renderer.toJSON())).toContain('Hi, I’m Acquire.');
 expect(renderer.root.findByProps({'aria-label':'Mandate conversation'})).toBeDefined();
 expect(renderer.root.findByProps({role:'log'}).findByProps({'aria-label':'Welcome to Acquire'})).toBeDefined();
 expect(startButton().props.children).toBe('Start');
 expect(JSON.stringify(renderer.toJSON())).not.toContain('Your agent workspace');
 expect(JSON.stringify(renderer.toJSON())).toContain('no outreach is sent');expect(fetch).not.toHaveBeenCalled();expect(m.refresh).not.toHaveBeenCalled();
});
it('starts only on click and refreshes the same clean agent URL after the same research-only request is saved',async()=>{
 stageMandateSearch(input);await mount();accept();
 const click=startButton().props.onClick;await act(async()=>{click();click();});
 expect(vi.mocked(fetch).mock.calls.map(([url])=>url)).toEqual(['/api/acquisition-session',`/api/acquisition-workflows?requestId=${id}`,'/api/mandates/generate','/api/acquisition-workflows']);
 expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body))).toMatchObject({requestId:id,preset:'live-research-test',presentation:'agent'});
 expect(m.refresh).toHaveBeenCalledOnce();expect(m.push).not.toHaveBeenCalled();expect(m.replace).not.toHaveBeenCalled();
});
it.each(['missing','foreign','workspace','unscoped'])('shows an unavailable shell without revealing or starting a %s draft',async kind=>{
 if(kind!=='missing')stageMandateSearch({...input,...(kind==='foreign'?{ownerScope:'foreign'}:kind==='workspace'?{presentation:'workspace' as const}:{ownerScope:undefined})});
 await mount();expect(JSON.stringify(renderer.toJSON())).toContain('Agent workspace unavailable');expect(JSON.stringify(renderer.toJSON())).not.toContain(description);expect(renderer.root.findAllByType('button')).toHaveLength(0);expect(fetch).not.toHaveBeenCalled();
});
it('keeps the frozen body through failure and refresh and retries without regenerating',async()=>{
 stageMandateSearch(input);await mount();
 vi.mocked(fetch).mockImplementation(async url=>String(url)==='/api/acquisition-session'?Response.json({scope:ownerScope}):String(url).includes('?requestId=')?Response.json({status:'missing'}):String(url).endsWith('/generate')?Response.json({brief:emptyBrief()}):new Response('',{status:503}));
 await act(async()=>{start();});const body=readMandateSearch(id)!.requestBody;expect(body).toBeDefined();expect(JSON.stringify(renderer.toJSON())).toContain('Retry');
 await act(()=>renderer.unmount());vi.mocked(fetch).mockClear();await mount();expect(fetch).not.toHaveBeenCalled();accept();await act(async()=>{start();});
 expect(vi.mocked(fetch).mock.calls.map(([url])=>url)).toEqual(['/api/acquisition-session',`/api/acquisition-workflows?requestId=${id}`,'/api/acquisition-workflows']);
 expect(vi.mocked(fetch).mock.calls.at(-1)![1]!.body).toBe(body);expect(m.refresh).toHaveBeenCalledOnce();
});
