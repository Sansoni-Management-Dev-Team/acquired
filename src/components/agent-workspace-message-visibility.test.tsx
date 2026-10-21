import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('next/link',()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock('@/lib/agent-activity-poller',()=>({startAgentActivityPolling:()=>()=>{}}));
vi.mock('./agent-controls-panel',()=>({AgentControlsPanel:({children}:{children?:(card:React.ReactNode)=>React.ReactNode})=><>{children?.(null)}</>}));
vi.mock('./agent-review-cards',()=>({AgentReviewCards:()=>null}));
vi.mock('./company-identity-reviews',()=>({CompanyIdentityReviews:()=>null}));
vi.mock('./agent-brief-review',()=>({AgentBriefReview:()=> <div>A tall inline brief review</div>}));
import {AgentWorkspace}from'./agent-workspace';
import{SavedMandateHttpAgent}from'@/lib/agent-http-client';
import type {AgentSnapshot}from'@/domain/agent-mode';
const initial:AgentSnapshot={mandate:{id:'56cb6d9e-e530-46a0-a98b-294193049536',name:'Saved',description:'Saved'},scope:'research-only',research:{total:0,queued:0,active:0,complete:0,needsReview:0,cancelled:0},jobs:[],links:{brief:'/brief',companies:'/companies'}};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('brings sent messages and the saved answer into view above a tall inline review card',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const frames:FrameRequestCallback[]=[];vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{frames.push(fn);return frames.length;});
 const savedMessages=[{id:'saved-question',role:'user' as const,content:'start'},{id:'saved-answer',role:'assistant' as const,content:'Review your brief to continue.'}],scrolled:string[]=[];
 vi.spyOn(SavedMandateHttpAgent.prototype,'runAgent').mockResolvedValue(undefined as never);
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>Response.json(input.endsWith('/reviews')?{batches:[]}:{...initial,conversation:{messages:savedMessages}})));
 const {create,act}=await import('react-test-renderer');let tree:ReturnType<typeof create>|undefined;
 try{
  await act(async()=>{tree=create(<AgentWorkspace initial={initial} conversation={{threadId:'saved',messages:[]}}/>,{createNodeMock:element=>{const props=element.props as Record<string,unknown>;return props['data-chat-message-id']?{scrollIntoView:()=>scrolled.push(String(props['data-chat-message-id']))}:null;}});});
  await act(async()=>tree!.root.findByProps({id:'agent-question'}).props.onChange({target:{value:'start'}}));
  await act(async()=>tree!.root.findByType('form').props.onSubmit({preventDefault(){}}));
  await act(async()=>{for(const frame of frames.splice(0))frame(0);});
  expect(JSON.stringify(tree!.toJSON())).toContain('Review your brief to continue.');
  expect(tree!.root.findAll(node=>typeof node.type==='string'&&node.props['data-chat-message-id']).map(node=>node.props['data-chat-message-id'])).toEqual(['saved-question','saved-answer']);
  expect(scrolled).toContain('saved-answer');
 }finally{if(tree)await act(async()=>tree!.unmount());}
});
