import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('next/link',()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock('@/lib/agent-activity-poller',()=>({startAgentActivityPolling:()=>()=>{}}));
vi.mock('./agent-controls-panel',()=>({AgentControlsPanel:()=> <div>Agent toolbar</div>}));
vi.mock('./agent-review-cards',()=>({AgentReviewCards:()=>null}));
import {AgentWorkspace} from './agent-workspace';
import type {AgentSnapshot} from '@/domain/agent-mode';
const initial:AgentSnapshot={mandate:{id:'56cb6d9e-e530-46a0-a98b-294193049536',name:'A saved mandate',description:'Saved buyer criteria'},scope:'research-only',research:{total:3,queued:0,active:0,complete:3,needsReview:0,cancelled:0},jobs:[],links:{brief:'/saved/brief',companies:'/saved/companies'}};
afterEach(()=>vi.unstubAllGlobals());
it('keeps a typed chat draft when context is opened and closed without starting work',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{
  await act(async()=>{tree=create(<AgentWorkspace initial={initial} conversation={{threadId:'saved-thread',messages:[]}}/>);});
  const input=()=>tree!.root.findByProps({id:'agent-question'});
  await act(async()=>input().props.onChange({target:{value:'Keep this unsent thought'}}));
  const context=()=>tree!.root.findAllByType('button').find(button=>button.props['aria-controls']==='agent-context')!;
  expect(context().props['aria-expanded']).toBe(false);
  await act(async()=>context().props.onClick());expect(context().props['aria-expanded']).toBe(true);
  await act(async()=>context().props.onClick());expect(context().props['aria-expanded']).toBe(false);
  expect(input().props.value).toBe('Keep this unsent thought');expect(fetcher).not.toHaveBeenCalled();
 }finally{if(tree)await act(async()=>tree!.unmount());}
});
it('opens context for an explicit guidance draft without changing the saved conversation',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{
  await act(async()=>{tree=create(<AgentWorkspace initial={initial} learningEnabled conversation={{threadId:'saved-thread',messages:[{id:'message',role:'user',content:'Prefer maintenance businesses'}]}}/>);});
  const useGuidance=tree!.root.findAllByType('button').find(button=>button.props.children==='Use as guidance')!;
  await act(async()=>useGuidance.props.onClick());
  expect(tree!.root.findAllByType('button').find(button=>button.props['aria-controls']==='agent-context')!.props['aria-expanded']).toBe(true);
  expect(tree!.root.findAllByType('textarea').some(textarea=>textarea.props.value==='Prefer maintenance businesses')).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
 }finally{if(tree)await act(async()=>tree!.unmount());}
});
