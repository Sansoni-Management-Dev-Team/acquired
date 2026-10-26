import React,{StrictMode} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({resume:vi.fn(),router:{replace:vi.fn()}}));
vi.mock('next/navigation',()=>({useRouter:()=>m.router}));
vi.mock('next/link',()=>({default:({href,children}:{href:string;children:React.ReactNode})=><a href={href}>{children}</a>}));
vi.mock('@/lib/mandate-search-launch',()=>({continueMandateSearch:m.resume}));
vi.mock('./company-discovery-loading',()=>({CompanyDiscoveryLoading:({mandateId}:{mandateId:string})=><p>Progress for {mandateId}</p>}));
vi.mock('./company-pipeline-progress',()=>({CompanyPipelineProgress:({detail}:{detail:string})=><p>{detail}</p>}));
import {MandateSearchRun} from './mandate-search-run';
const id='10000000-0000-4000-8000-000000000001';
let renderer:ReactTestRenderer;
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(async()=>{if(renderer)await act(()=>renderer.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();});
it('shows preparation while generation is deferred, then keeps classic presentation on search',async()=>{
 let resolve!:(v:unknown)=>void;m.resume.mockReturnValue(new Promise(r=>{resolve=r;}));
 await act(()=>{renderer=create(<StrictMode><MandateSearchRun mandateId={id}/></StrictMode>);});
 expect(JSON.stringify(renderer.toJSON())).toContain('Preparing your mandate');expect(m.router.replace).not.toHaveBeenCalled();
 await act(async()=>{resolve({id,mandateId:id,preset:'live',presentation:'workspace'});});
 expect(renderer.root.findByType('p').children.join('')).toBe(`Progress for ${id}`);expect(m.router.replace).not.toHaveBeenCalled();
});
it('opens agent presentation after admission even for a research-only run',async()=>{
 m.resume.mockResolvedValue({id,mandateId:id,preset:'live-research-test',presentation:'agent'});
 await act(()=>{renderer=create(<MandateSearchRun mandateId={id}/>);});
 expect(m.router.replace).toHaveBeenCalledExactlyOnceWith(`/mandates/${id}/agent`);
});
it('keeps the original route identity when retrying preparation and never silently starts another run',async()=>{
 m.resume.mockRejectedValueOnce(Error('Receipt temporarily unavailable')).mockResolvedValue(null);
 await act(()=>{renderer=create(<MandateSearchRun mandateId={id}/>);});
 expect(JSON.stringify(renderer.toJSON())).toContain('Receipt temporarily unavailable');
 await act(()=>renderer.root.findByType('button').props.onClick());
 expect(m.resume.mock.calls).toEqual([[id],[id]]);expect(renderer.root.findByType('p').children.join('')).toBe(`Progress for ${id}`);expect(m.router.replace).not.toHaveBeenCalled();
});
