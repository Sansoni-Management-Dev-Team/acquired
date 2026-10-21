import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {emptyBrief} from '@/domain/acquisition';
vi.mock('./companies-workspace',()=>({CompaniesWorkspace:({embedded}:{embedded:boolean})=><div>{embedded?'Embedded companies':'Full workspace'}</div>}));
import {AgentSavedResults} from './agent-saved-results';
afterEach(()=>vi.unstubAllGlobals());
it('loads only the saved Companies GET on demand and reuses the embedded workspace',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn().mockResolvedValue(Response.json({mandate:{id:'mandate',brief:emptyBrief()},total:2,rows:[]}));vi.stubGlobal('fetch',fetcher);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(async()=>{tree=create(<AgentSavedResults mandateId="mandate" view="companies" onClose={()=>{}}/>);});expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toBe('/api/mandates/mandate/companies');expect(fetcher.mock.calls[0][1].method).toBeUndefined();expect(JSON.stringify(tree!.toJSON())).toContain('Embedded companies');}finally{if(tree)await act(()=>tree!.unmount());}
});
it('shows and searches saved people without revealing phones or starting outreach',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn().mockResolvedValue(Response.json({contacts:[{id:'a',name:'Alex',company:'Acme',role:'Director',email:'alex@example.test',fictionalised:false,doNotContact:false},{id:'b',name:'Blair',company:'Other',fictionalised:false,doNotContact:true},{id:'fake',name:'Simulation',company:'Demo',fictionalised:true,doNotContact:false}]}));vi.stubGlobal('fetch',fetcher);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(async()=>{tree=create(<AgentSavedResults mandateId="mandate" view="people" onClose={()=>{}}/>);});expect(tree!.root.findAllByType('li')).toHaveLength(2);await act(()=>tree!.root.findByType('input').props.onChange({target:{value:'director'}}));expect(tree!.root.findAllByType('li')).toHaveLength(1);expect(JSON.stringify(tree!.toJSON())).toContain('alex@example.test');expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][0]).toBe('/api/mandates/mandate/campaigns');}finally{if(tree)await act(()=>tree!.unmount());}
});
it('keeps failures inline and retries only the saved read',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(Response.json({contacts:[]}));vi.stubGlobal('fetch',fetcher);const{create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{await act(async()=>{tree=create(<AgentSavedResults mandateId="mandate" view="people" onClose={()=>{}}/>);});expect(tree!.root.findByProps({role:'status'}).findByType('p').children.join('')).toBe('Couldn’t load saved people.');await act(()=>tree!.root.findAllByType('button').find(button=>button.props.children==='Try again')!.props.onClick());expect(JSON.stringify(tree!.toJSON())).toContain('No people saved yet.');expect(fetcher.mock.calls.every(([,options])=>options.method===undefined)).toBe(true);}finally{if(tree)await act(()=>tree!.unmount());}
});
