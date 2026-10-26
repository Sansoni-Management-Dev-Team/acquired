import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyBrief } from '@/domain/acquisition';
const mocks=vi.hoisted(()=>({push:vi.fn(),upsert:vi.fn()}));
vi.mock('next/link',()=>({default:({href,children}:{href:string;children:React.ReactNode})=><a href={href}>{children}</a>}));
vi.mock('./company-discovery-loading',()=>({CompanyDiscoveryLoading:({mandateId,startedJobId}:{mandateId:string;startedJobId?:string})=><div data-testid="real-company-discovery" data-mandate={mandateId} data-job={startedJobId}/> }));
vi.mock('./detail-tooltip',()=>({DetailTooltip:({children}:{children:React.ReactNode})=><>{children}</>}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:mocks.push})}));
vi.mock('@/lib/mandate-cache',()=>({useMandateCache:{getState:()=>({upsert:mocks.upsert})}}));
import { HomeMandateCreate } from './home-mandate-create';
import { AgentModeToggle, AgentPlanReview } from './agent-mode';
import { CompanyPipelineProgress } from './company-pipeline-progress';
const cachedDemo={sourceMandateId:'40000000-0000-4000-8000-000000000001',brief:{...emptyBrief(),name:'Cached demo mandate',naturalLanguage:'Saved commercial laundry companies in Australia.'},companies:12,people:24};
let renderer:ReactTestRenderer;
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',vi.fn());vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(async()=>{if(renderer)await act(()=>renderer.unmount());vi.restoreAllMocks();vi.unstubAllGlobals()});
async function mount(nativeAgentEnabled=false){await act(()=>{renderer=create(<HomeMandateCreate mandates={[]} agentModeEnabled nativeAgentEnabled={nativeAgentEnabled} />)})}
async function review(nativeAgentEnabled=false){await mount(nativeAgentEnabled);await act(()=>renderer.root.findByType(AgentModeToggle).props.onChange(true));await act(()=>renderer.root.findByProps({id:'mandate-description'}).props.onChange({target:{value:'An industrial maintenance company in Queensland.'}}));vi.mocked(fetch).mockResolvedValueOnce(Response.json({brief:{...emptyBrief(),name:'Reviewed draft',naturalLanguage:'An industrial maintenance company in Queensland.'}}));await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}})})}
it('opens native agent chat directly with the saved provisional brief and no research or supervision dispatch',async()=>{
 await mount(true);await act(()=>renderer.root.findByType(AgentModeToggle).props.onChange(true));
 await act(()=>renderer.root.findByProps({id:'mandate-description'}).props.onChange({target:{value:'An industrial maintenance company in Queensland.'}}));
 const brief={...emptyBrief(),name:'Chat review',naturalLanguage:'An industrial maintenance company in Queensland.'};
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({brief})).mockResolvedValueOnce(Response.json({id:'chat-native',revision:'42'}));
 await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}})});
 expect(vi.mocked(fetch).mock.calls.map(([url])=>url)).toEqual(['/api/mandates/generate','/api/mandates/agent']);
 expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toMatchObject({executionMode:'real',brief});
 expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/mandates/chat-native/agent');
 expect(renderer.root.findAllByType(AgentPlanReview)).toHaveLength(0);
});
it('does not show company discovery while preparing the native chat brief',async()=>{
 await mount(true);await act(()=>renderer.root.findByType(AgentModeToggle).props.onChange(true));
 await act(()=>renderer.root.findByProps({id:'mandate-description'}).props.onChange({target:{value:'An industrial maintenance company in Queensland.'}}));
 let resolve!:(value:Response)=>void;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 let submitted!:Promise<void>;await act(()=>{submitted=renderer.root.findByType('form').props.onSubmit({preventDefault(){}});});
 expect(renderer.root.findAllByType(CompanyPipelineProgress)).toHaveLength(0);
 expect(JSON.stringify(renderer.toJSON())).toContain('Preparing your agent workspace');
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({id:'chat-native',revision:'42'}));
 await act(async()=>{resolve(Response.json({brief:{...emptyBrief(),name:'Chat review'}}));await submitted;});
});
it('native Run demo uses the server-selected saved dataset and opens chat without generating or researching',async()=>{
 await mount(true);await act(()=>renderer.root.findByType(AgentModeToggle).props.onChange(true));
 vi.mocked(fetch).mockResolvedValueOnce(Response.json(cachedDemo)).mockResolvedValueOnce(Response.json({id:'demo-chat',revision:'42'}));
 await act(async()=>{renderer.root.findAllByType('button').find(b=>b.children.join('')==='Run demo')!.props.onClick()});
 expect(vi.mocked(fetch).mock.calls.map(([url])=>url)).toEqual(['/api/mandates/demo-data','/api/mandates/agent']);
 expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toMatchObject({executionMode:'demo',demoSourceMandateId:cachedDemo.sourceMandateId,brief:cachedDemo.brief});
 expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/mandates/demo-chat/agent');
});

it('leaves the normal flow selected until the user opts in',async()=>{await mount();expect(renderer.root.findByType(AgentModeToggle).props.enabled).toBe(false);expect(fetch).not.toHaveBeenCalled()});
it('generates a review without saving a mandate or dispatching research',async()=>{await review();expect(fetch).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledWith('/api/mandates/generate',expect.anything());expect(renderer.root.findByType(AgentPlanReview).props.brief.name).toBe('Reviewed draft');expect(mocks.upsert).not.toHaveBeenCalled();expect(mocks.push).not.toHaveBeenCalled()});
it('saves only the reviewed brief then uses the existing research endpoint and opens its agent route',async()=>{await review();vi.mocked(fetch).mockResolvedValueOnce(Response.json({id:'mandate-a'})).mockResolvedValueOnce(Response.json({jobId:'research-a'}));await act(async()=>{renderer.root.findByType(AgentPlanReview).props.onStart()});expect(fetch).toHaveBeenCalledTimes(3);expect(vi.mocked(fetch).mock.calls[1][0]).toBe('/api/mandates');expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).name).toBe('Reviewed draft');expect(vi.mocked(fetch).mock.calls[2][0]).toBe('/api/mandates/mandate-a/research');expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/mandates/mandate-a/agent')});
it('keeps the saved identity on research failure and never creates a duplicate mandate on retry',async()=>{await review();vi.mocked(fetch).mockResolvedValueOnce(Response.json({id:'mandate-a'})).mockResolvedValueOnce(Response.json({error:'Research unavailable'},{status:503}));await act(async()=>{renderer.root.findByType(AgentPlanReview).props.onStart()});expect(renderer.root.findByType(AgentPlanReview).props.saved).toBe(true);expect(renderer.root.findByType(AgentPlanReview).props.error).toBe('Research unavailable');vi.mocked(fetch).mockResolvedValueOnce(Response.json({jobId:'research-a'}));await act(async()=>{renderer.root.findByType(AgentPlanReview).props.onStart()});expect(vi.mocked(fetch).mock.calls.filter(([url])=>url==='/api/mandates')).toHaveLength(1);expect(mocks.push).toHaveBeenCalledOnce()});
it('deduplicates rapid approval clicks before React commits the busy state',async()=>{await review();vi.mocked(fetch).mockResolvedValueOnce(Response.json({id:'mandate-a'})).mockResolvedValueOnce(Response.json({jobId:'research-a'}));const start=renderer.root.findByType(AgentPlanReview).props.onStart;await act(async()=>{start();start()});expect(vi.mocked(fetch).mock.calls.filter(([url])=>url==='/api/mandates')).toHaveLength(1)});
it('reuses the research operation key after an uncertain response',async()=>{await review();vi.mocked(fetch).mockResolvedValueOnce(Response.json({id:'mandate-a'})).mockRejectedValueOnce(new DOMException('Timed out','TimeoutError'));await act(async()=>{renderer.root.findByType(AgentPlanReview).props.onStart()});vi.mocked(fetch).mockResolvedValueOnce(Response.json({jobId:'research-a'}));await act(async()=>{renderer.root.findByType(AgentPlanReview).props.onStart()});const requests=vi.mocked(fetch).mock.calls.filter(([url])=>url==='/api/mandates/mandate-a/research');expect(requests).toHaveLength(2);expect(JSON.parse(requests[0][1]!.body as string).requestId).toBe(JSON.parse(requests[1][1]!.body as string).requestId)});
it('starts research on an HTTP origin where randomUUID is unavailable',async()=>{
 const realCrypto=globalThis.crypto;
 vi.stubGlobal('crypto',{getRandomValues:realCrypto.getRandomValues.bind(realCrypto)});
 await review();
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({id:'mandate-a'})).mockResolvedValueOnce(Response.json({jobId:'research-a'}));
 await act(async()=>{renderer.root.findByType(AgentPlanReview).props.onStart()});
 expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/mandates/mandate-a/agent');
 const request=vi.mocked(fetch).mock.calls.find(([url])=>url==='/api/mandates/mandate-a/research');
 expect(JSON.parse(request![1]!.body as string).requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

it('native creation retries the exact saved request without regenerating or changing its review scope',async()=>{
 await mount(true);await act(()=>renderer.root.findByType(AgentModeToggle).props.onChange(true));
 await act(()=>renderer.root.findByProps({id:'mandate-description'}).props.onChange({target:{value:'An industrial maintenance company in Queensland.'}}));
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({brief:{...emptyBrief(),name:'Provisional scope'}})).mockRejectedValueOnce(new DOMException('Timed out','TimeoutError'));
 await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}})});
 expect(renderer.root.findByProps({id:'mandate-description'}).props.readOnly).toBe(true);
 expect(renderer.root.findByType(AgentModeToggle).props.disabled).toBe(true);
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({id:'mandate-a',revision:'42'}));
 const retry=renderer.root.findByType('form').props.onSubmit;
 await act(async()=>{retry({preventDefault(){}});retry({preventDefault(){}})});
 const saves=vi.mocked(fetch).mock.calls.filter(([url])=>url==='/api/mandates/agent');
 expect(saves).toHaveLength(2);expect(saves[0][1]!.body).toBe(saves[1][1]!.body);
 expect(vi.mocked(fetch).mock.calls.filter(([url])=>url==='/api/mandates/generate')).toHaveLength(1);
 expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/mandates/mandate-a/agent');
 expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/execution')||String(url).endsWith('/research'))).toBe(false);
});
it('keeps a conflicted cached native creation frozen and never starts normal research as fallback',async()=>{
 await mount(true);await act(()=>renderer.root.findByType(AgentModeToggle).props.onChange(true));
 vi.mocked(fetch).mockResolvedValueOnce(Response.json(cachedDemo)).mockResolvedValueOnce(Response.json({error:'Creation conflict'},{status:409}));
 await act(async()=>{renderer.root.findAllByType('button').find(b=>b.children.join('')==='Run demo')!.props.onClick()});
 expect(renderer.root.findByProps({role:'alert'}).children.join('')).toBe('Creation conflict');
 const first=vi.mocked(fetch).mock.calls[1][1]!.body;vi.mocked(fetch).mockResolvedValueOnce(Response.json({error:'Creation conflict'},{status:409}));
 await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}})});
 expect(vi.mocked(fetch).mock.calls.map(([url])=>url)).toEqual(['/api/mandates/demo-data','/api/mandates/agent','/api/mandates/agent']);expect(vi.mocked(fetch).mock.calls[2][1]!.body).toBe(first);expect(mocks.push).not.toHaveBeenCalled();
});

it('Run demo with agent mode off copies cached company and people data without a research request',async()=>{
 await mount(true);vi.mocked(fetch).mockResolvedValueOnce(Response.json(cachedDemo)).mockResolvedValueOnce(Response.json({id:'demo-mandate'}));
 await act(async()=>{renderer.root.findAllByType('button').find(b=>b.children.join('')==='Run demo')!.props.onClick()});
 expect(vi.mocked(fetch).mock.calls.map(([url])=>url)).toEqual(['/api/mandates/demo-data','/api/mandates/demo-data']);expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({cache:'no-store'});
 expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toEqual({requestId:expect.any(String),sourceMandateId:cachedDemo.sourceMandateId});expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/mandates/demo-mandate/companies');
 expect(renderer.root.findAllByProps({'data-testid':'real-company-discovery'})).toHaveLength(0);
});

it('an uncertain normal cached demo retries the same source and request without fetching a new dataset',async()=>{
 await mount(true);vi.mocked(fetch).mockResolvedValueOnce(Response.json(cachedDemo)).mockRejectedValueOnce(new DOMException('Timed out','TimeoutError')).mockResolvedValueOnce(Response.json({error:'Sign in again'},{status:401}));
 await act(async()=>{renderer.root.findAllByType('button').find(b=>b.children.join('')==='Run demo')!.props.onClick()});
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({id:'demo-mandate'}));await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}})});
 const calls=vi.mocked(fetch).mock.calls;expect(calls.map(([url])=>String(url).split('?')[0])).toEqual(['/api/mandates/demo-data','/api/mandates/demo-data','/api/mandates/demo-data','/api/mandates/demo-data']);expect(String(calls[2][0])).toContain('?requestId=');const posts=calls.filter(([,init])=>init?.method==='POST');expect(posts).toHaveLength(2);expect(posts[0][1]!.body).toBe(posts[1][1]!.body);expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/mandates/demo-mandate/companies');
});

it('keeps the native cached demo source and creation request through an uncertain save',async()=>{
 await mount(true);await act(()=>renderer.root.findByType(AgentModeToggle).props.onChange(true));vi.mocked(fetch).mockResolvedValueOnce(Response.json(cachedDemo)).mockRejectedValueOnce(new DOMException('Timed out','TimeoutError')).mockResolvedValueOnce(Response.json({error:'Sign in again'},{status:401}));
 await act(async()=>{renderer.root.findAllByType('button').find(b=>b.children.join('')==='Run demo')!.props.onClick()});vi.mocked(fetch).mockResolvedValueOnce(Response.json({id:'demo-native',revision:'42'}));await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}})});
 const saves=vi.mocked(fetch).mock.calls.filter(([url])=>url==='/api/mandates/agent');expect(saves).toHaveLength(2);expect(saves[0][1]!.body).toBe(saves[1][1]!.body);expect(JSON.parse(saves[0][1]!.body as string)).toMatchObject({executionMode:'demo',demoSourceMandateId:cachedDemo.sourceMandateId});expect(vi.mocked(fetch).mock.calls.filter(([url])=>url==='/api/mandates/demo-data')).toHaveLength(1);expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/mandates/demo-native/agent');
});

it('retains the custom research-only preview review and back flow when native execution is unavailable',async()=>{
 await review(false);expect(renderer.root.findByType(AgentPlanReview).props.demo).toBe(false);await act(()=>renderer.root.findByType(AgentPlanReview).props.onBack());expect(renderer.root.findByProps({id:'mandate-description'})).toBeDefined();
});

it('opens native chat with Continue and explains where progress will appear',async()=>{
 await mount(true);await act(()=>renderer.root.findByType(AgentModeToggle).props.onChange(true));
 expect(renderer.root.findAllByType('button').some(button=>button.children.some(child=>child==='Continue'))).toBe(true);
 await act(()=>renderer.root.findByProps({id:'mandate-description'}).props.onChange({target:{value:'Commercial laundry businesses in Australia.'}}));
 let finish!:(value:Response)=>void;vi.mocked(fetch).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await act(()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}}));
 expect(JSON.stringify(renderer.toJSON())).not.toContain('Review your brief in chat before research begins');
 expect(JSON.stringify(renderer.toJSON())).toContain('Your mandate and research progress will appear in the agent workspace.');
 vi.mocked(fetch).mockResolvedValueOnce(Response.json({id:'fresh-chat',revision:'42',initialResearch:{requestId:'server-launch',status:'queued'}}));
 await act(async()=>{finish(Response.json({brief:{...emptyBrief(),name:'Fresh research'}}));});
 expect(mocks.push).toHaveBeenCalledExactlyOnceWith('/mandates/fresh-chat/agent');
 expect(vi.mocked(fetch).mock.calls.map(([url])=>url)).toEqual(['/api/mandates/generate','/api/mandates/agent']);
});

it('does not fall back to live research when no saved demo dataset is available',async()=>{await mount(true);vi.mocked(fetch).mockResolvedValueOnce(Response.json({error:'No saved company and people data is available.'},{status:404}));await act(async()=>{renderer.root.findAllByType('button').find(b=>b.children.join('')==='Run demo')!.props.onClick()});expect(vi.mocked(fetch).mock.calls.map(([url])=>url)).toEqual(['/api/mandates/demo-data']);expect(renderer.root.findByProps({role:'alert'}).children.join('')).toContain('No saved company');expect(mocks.push).not.toHaveBeenCalled();});

it.each([false,true])('keeps waiting for a valid demo creation that completes after fifteen seconds (native=%s)',async native=>{
 vi.useFakeTimers();
 vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('Timed out','TimeoutError')),ms);return controller.signal;});
 try{
  await mount(true);if(native)await act(()=>renderer.root.findByType(AgentModeToggle).props.onChange(true));
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(cachedDemo)).mockImplementationOnce((_url,init)=>new Promise((resolve,reject)=>{const signal=init?.signal;signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});setTimeout(()=>resolve(Response.json({id:'late-demo',revision:'42'})),20000);}));
  await act(async()=>{renderer.root.findAllByType('button').find(b=>b.children.join('')==='Run demo')!.props.onClick();});
  await act(async()=>{await vi.advanceTimersByTimeAsync(20001);});
  expect(mocks.push).toHaveBeenCalledExactlyOnceWith(native?'/mandates/late-demo/agent':'/mandates/late-demo/companies');
  expect(vi.mocked(fetch).mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
 }finally{vi.useRealTimers();}
});
it.each([false,true])('recovers an already saved demo after its creation response is lost, without resubmitting (native=%s)',async native=>{
 await mount(true);if(native)await act(()=>renderer.root.findByType(AgentModeToggle).props.onChange(true));
 vi.mocked(fetch).mockResolvedValueOnce(Response.json(cachedDemo)).mockRejectedValueOnce(new DOMException('Timed out','TimeoutError')).mockImplementationOnce(async url=>Response.json({status:'ready',id:new URL(String(url),'https://app.test').searchParams.get('requestId'),revision:'42'}));
 await act(async()=>{renderer.root.findAllByType('button').find(b=>b.children.join('')==='Run demo')!.props.onClick();});
 const calls=vi.mocked(fetch).mock.calls,body=JSON.parse(calls[1][1]!.body as string),statusUrl=new URL(String(calls[2][0]),'https://app.test');
 expect(statusUrl.pathname).toBe('/api/mandates/demo-data');expect(statusUrl.searchParams.get('requestId')).toBe(body.requestId);expect(mocks.push).toHaveBeenCalledExactlyOnceWith(native?`/mandates/${body.requestId}/agent`:`/mandates/${body.requestId}/companies`);expect(statusUrl.searchParams.get('sourceMandateId')).toBe(cachedDemo.sourceMandateId);expect(statusUrl.searchParams.get('presentation')).toBe(native?'agent':'workspace');
 expect(calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});

it.each([200,503])('handles an empty demo-data response without exposing a JSON parser failure (status=%s)',async status=>{
 await mount(true);vi.mocked(fetch).mockResolvedValueOnce(new Response('',{status}));
 await act(async()=>{renderer.root.findAllByType('button').find(b=>b.children.join('')==='Run demo')!.props.onClick();});
 const text=JSON.stringify(renderer.toJSON());expect(text).toContain('Could not load saved demo data. Please try again.');expect(text).not.toContain('Unexpected end');expect(mocks.push).not.toHaveBeenCalled();expect(vi.mocked(fetch).mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
});
